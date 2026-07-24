/**
 * Board mutations — server functions (rfc-server). Writes carry valibot
 * input schemas (Standard Schema → serverFn's `input`: a rejected wire
 * payload answers 400 before the handler runs) and declare `invalidates`
 * so the cache pack drops the affected read keys on arrival — the keys are
 * built from board/keys.ts, the same module the useData getters use.
 */
import { serverFn } from '@sigx/server';
import * as v from 'valibot';
import type { BoardConfig } from '@pulse/db';
import { GitHubApiError } from '@pulse/github';
import { boardKeys } from '../board/keys';
import { STATUS_IDS } from '../board/detect';
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
 * Create or update a repo's board config. createdBy is preserved across
 * updates and stamped from the session on first save; the config-key
 * invalidation is what lets the post-setup navigation see the new board
 * instead of a cached null (redirect-to-setup loop otherwise).
 */
export const saveBoard = serverFn({
    use: [withAuth],
    input: BoardConfigInput,
    async handler(rq, input): Promise<BoardConfig> {
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
                // 422 = validation failure; for createLabel that is
                // "already_exists" — tolerate it, rethrow everything else.
                if (!(err instanceof GitHubApiError && err.status === 422)) throw err;
            }
        }
        return created;
    },
    invalidates: (input) => [
        boardKeys.labels(input.owner, input.repo),
        boardKeys.detect(input.owner, input.repo)
    ]
});
