/**
 * Board mutations — server functions (rfc-server). Writes carry valibot
 * input schemas (Standard Schema → serverFn's `input`: a rejected wire
 * payload answers 400 before the handler runs) and declare `invalidates`
 * so the cache pack drops the affected read keys on arrival — the keys are
 * built from board/keys.ts, the same module the useData getters use.
 */
import { serverFn, ServerFnError } from '@sigx/server';
import * as v from 'valibot';
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import { GitHubApiError, type GitHubClient, type GitHubIssue } from '@pulse/github';
import { boardKeys } from '../board/keys';
import { STATUS_IDS } from '../board/detect';
import { canRepresent, moveLabels } from '../board/derive';
import { authed, withAuth } from './auth.server';
import { services } from './services.server';

const segment = v.pipe(v.string(), v.regex(/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/));
const labelName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));

/** BoardConfig v1 as the wire accepts it — createdBy is deliberately NOT
 *  client-controlled (the handler stamps/preserves it server-side). */
const BoardConfigInput = v.object({
    version: v.literal(1),
    owner: segment,
    repo: segment,
    statuses: v.pipe(
        v.array(v.object({
            id: v.picklist(STATUS_IDS),
            label: v.nullable(labelName)
        })),
        v.check(
            (statuses) =>
                statuses.length === STATUS_IDS.length &&
                STATUS_IDS.every((id) => statuses.some((s) => s.id === id)),
            'statuses must contain each of the five columns exactly once'
        )
    ),
    priorities: v.object({
        p0: v.nullable(labelName),
        p1: v.nullable(labelName),
        p2: v.nullable(labelName),
        p3: v.nullable(labelName)
    }),
    cycleSource: v.picklist(['milestones', 'none']),
    closeOnDone: v.boolean()
});

/**
 * One GitHub label can drive ONE slot. A label mapped to two status
 * columns (or a status and a priority is fine — different dimensions, but
 * two priorities isn't) makes derivation ambiguous: statusOf/priorityOf
 * short-circuit on the first match and later slots become unreachable.
 */
export function duplicateMapping(config: {
    statuses: { label: string | null }[];
    priorities: Record<string, string | null>;
}): string | null {
    for (const group of [
        config.statuses.map((s) => s.label),
        Object.values(config.priorities)
    ]) {
        const seen = new Set<string>();
        for (const label of group) {
            if (label === null) continue;
            const key = label.toLowerCase();
            if (seen.has(key)) return label;
            seen.add(key);
        }
    }
    return null;
}

/**
 * Create or update a repo's board config. createdBy is preserved across
 * updates and stamped from the session on first save; the config-key
 * invalidation is what lets the post-setup navigation see the new board
 * instead of a cached null (redirect-to-setup loop otherwise).
 */
export const saveBoard = serverFn({
    use: [withAuth],
    input: BoardConfigInput,
    async handler(rq, input): Promise<BoardConfig> {
        const dup = duplicateMapping(input);
        if (dup) {
            throw new ServerFnError(400, `label "${dup}" is mapped to more than one slot`);
        }
        const { user } = authed(rq);
        const { configStore } = services();
        const existing = await configStore.getBoard(input.owner, input.repo);
        const config: BoardConfig = { ...input, createdBy: existing?.createdBy ?? user.login };
        await configStore.putBoard(config);
        return config;
    },
    invalidates: (input) => [boardKeys.config(input.owner, input.repo)]
});

const CreateMissingLabelsInput = v.object({
    owner: segment,
    repo: segment,
    labels: v.pipe(
        v.array(v.object({
            name: labelName,
            /** Hex color WITHOUT the leading '#' (GitHub's label form). */
            color: v.pipe(v.string(), v.regex(/^[0-9a-fA-F]{6}$/)),
            description: v.optional(v.pipe(v.string(), v.maxLength(100)))
        })),
        v.maxLength(20)
    )
});

/**
 * Create the convention labels detection found missing. Races are benign:
 * a 422 "already exists" (someone created it since detection) is treated
 * as success — the label being there is the goal. Returns the names that
 * were actually created (not the 422-skipped ones).
 */
export const createMissingLabels = serverFn({
    use: [withAuth],
    input: CreateMissingLabelsInput,
    async handler(rq, { owner, repo, labels }): Promise<string[]> {
        const { gh } = authed(rq);
        const created: string[] = [];
        for (const label of labels) {
            try {
                await gh.createLabel(owner, repo, label);
                created.push(label.name);
            } catch (err) {
                // Tolerate ONLY the duplicate case — 422 covers other
                // validation failures too (bad color, name too long), and
                // those must surface, not read as success.
                const duplicate = err instanceof GitHubApiError
                    && err.status === 422
                    && /already[_ ]exists/i.test(err.message);
                if (!duplicate) throw err;
            }
        }
        return created;
    },
    invalidates: (input) => [
        boardKeys.labels(input.owner, input.repo),
        boardKeys.detect(input.owner, input.repo)
    ]
});

const MoveIssueInput = v.object({
    owner: segment,
    repo: segment,
    number: v.pipe(v.number(), v.integer(), v.minValue(1)),
    /** The drop column — the status the issue moves to. */
    target: v.picklist(STATUS_IDS)
});

/**
 * The move computation `moveIssue` runs once auth + config are resolved —
 * exported separately so it unit-tests over the fixtures client. Reads the
 * CURRENT issue through the (ETag-cached) client, derives the label/state
 * patch with derive.moveLabels, and applies it in ONE updateIssue PATCH.
 */
export async function applyMove(
    gh: GitHubClient,
    config: BoardConfig,
    owner: string,
    repo: string,
    number: number,
    target: BoardStatusId
): Promise<GitHubIssue> {
    if (!canRepresent(config, target)) {
        throw new ServerFnError(400, `the ${target} column has no mapped label — map one in setup before moving cards there`);
    }
    const issue = await gh.issue(owner, repo, number);
    if (!issue) {
        throw new ServerFnError(404, `issue #${number} does not exist in ${owner}/${repo}`);
    }
    const patch = moveLabels(config, issue.labels.map((l) => l.name), target);
    return gh.updateIssue(owner, repo, number, patch);
}

/**
 * Drag a card to another column: swap the mapped status labels (and
 * close/reopen per the config) in one atomic PATCH. The config comes from
 * the server-side store — never from the client — so a tampered wire
 * payload cannot rewrite the label mapping. Returns the updated issue as
 * GitHub answers it: the caller's optimistic-UI reconcile source.
 */
export const moveIssue = serverFn({
    use: [withAuth],
    input: MoveIssueInput,
    async handler(rq, { owner, repo, number, target }): Promise<GitHubIssue> {
        const { gh } = authed(rq);
        const config = await services().configStore.getBoard(owner, repo);
        if (!config) {
            throw new ServerFnError(404, `no board is configured for ${owner}/${repo}`);
        }
        return applyMove(gh, config, owner, repo, number, target);
    },
    invalidates: (input) => [boardKeys.issues(input.owner, input.repo)]
});
