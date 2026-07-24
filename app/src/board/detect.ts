/**
 * Convention detection — the pure heart of the setup flow (pulse#40). A
 * repo's existing labels/milestones are matched against common planning
 * conventions (`status: in progress`, `wip`, `P0`, `priority: high`, …) to
 * propose a prefilled BoardConfig, plus the canonical labels worth creating
 * for anything unmatched. Pure functions over @pulse/github shapes — the
 * server fn (board.server.ts#detectConventions) is a thin fetch-and-call,
 * so the whole heuristic matrix is unit-testable against the fixtures.
 */
import type { BoardConfig, BoardPriorities, BoardStatusId } from '@pulse/db';
import type { GitHubLabel, GitHubMilestone } from '@pulse/github';
import { oklchToHex } from './colors';

/** Prefixes stripped before synonym matching (`status: todo` → `todo`). */
const PREFIXES = ['status:', 'priority:', 'prio:'];

/** Lowercase, trim, strip one convention prefix — the comparable form. */
export function normalizeLabelName(name: string): string {
    let n = name.trim().toLowerCase();
    for (const prefix of PREFIXES) {
        if (n.startsWith(prefix)) {
            n = n.slice(prefix.length).trim();
            break;
        }
    }
    return n;
}

/** Synonym sets per status column, in normalized form. Order within a set
 *  is preference order when several labels normalize into the same set. */
const STATUS_SYNONYMS: Record<BoardStatusId, readonly string[]> = {
    backlog: ['backlog', 'icebox'],
    todo: ['todo', 'to do', 'ready', 'triage'],
    inprogress: ['in progress', 'in-progress', 'wip', 'doing'],
    inreview: ['in review', 'review', 'needs review', 'reviewing'],
    done: ['done', 'complete', 'completed', 'closed']
};

const PRIORITY_SYNONYMS: Record<keyof BoardPriorities, readonly string[]> = {
    p0: ['p0', 'urgent', 'critical'],
    p1: ['p1', 'high'],
    p2: ['p2', 'medium', 'normal'],
    p3: ['p3', 'low']
};

/** Column order — also the config's statuses order. */
export const STATUS_IDS: readonly BoardStatusId[] = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
export const PRIORITY_IDS: readonly (keyof BoardPriorities)[] = ['p0', 'p1', 'p2', 'p3'];

/** The grey hex for hue-less conventions (design token --tf). */
const GREY = '5f6472';

/** Design hues → GitHub label hex via the label dot formula
 *  `oklch(0.62 0.14 <hue>)` (handoff §Design Tokens; colors.labelStyle). */
const hex = (hue: number) => oklchToHex(0.62, 0.14, hue);

/** Canonical label to create per unmapped status (design status hues). */
const CANONICAL_STATUS_LABELS: Record<BoardStatusId, { name: string; color: string; description: string }> = {
    backlog: { name: 'status: backlog', color: GREY, description: 'Planner status: Backlog' },
    todo: { name: 'status: todo', color: hex(250), description: 'Planner status: Todo' },
    inprogress: { name: 'status: in progress', color: hex(65), description: 'Planner status: In Progress' },
    inreview: { name: 'status: in review', color: hex(210), description: 'Planner status: In Review' },
    done: { name: 'status: done', color: hex(150), description: 'Planner status: Done' }
};

/** Canonical label to create per unmapped priority (design P0–P3 hues). */
const CANONICAL_PRIORITY_LABELS: Record<keyof BoardPriorities, { name: string; color: string; description: string }> = {
    p0: { name: 'P0', color: hex(25), description: 'Priority: urgent' },
    p1: { name: 'P1', color: hex(65), description: 'Priority: high' },
    p2: { name: 'P2', color: hex(250), description: 'Priority: medium' },
    p3: { name: 'P3', color: GREY, description: 'Priority: low' }
};

/** A convention label the repo does not have yet, ready for createLabel. */
export interface MissingLabel {
    name: string;
    /** Hex color WITHOUT the leading '#' (GitHub's label form). */
    color: string;
    description: string;
    /** Which config slot this label would fill once created — the setup
     *  form maps the slot to the created name on save. */
    slot: BoardStatusId | keyof BoardPriorities;
}

/** What detection proposes: a ready-to-save config + the gaps. */
export interface DetectedConventions {
    /** Prefilled BoardConfig proposal (v1; createdBy left null — the save
     *  mutation stamps the session user). */
    config: BoardConfig;
    /** Canonical labels for every status/priority with no matching label. */
    missing: MissingLabel[];
    /** Total milestones on the repo — the cycle-source toggle's evidence. */
    milestoneCount: number;
}

/** First repo label whose normalized name lands in `synonyms` — preferring
 *  earlier synonyms (exact convention beats a loose one). */
function matchLabel(labels: readonly GitHubLabel[], synonyms: readonly string[]): string | null {
    for (const syn of synonyms) {
        const hit = labels.find((l) => normalizeLabelName(l.name) === syn);
        if (hit) return hit.name;
    }
    return null;
}

/**
 * Detect the repo's planning conventions and propose a BoardConfig.
 * Milestones drive the cycle-source proposal: any milestone at all makes
 * `milestones` the default (the setup form lets the user opt out).
 */
export function detectBoard(
    owner: string,
    repo: string,
    labels: readonly GitHubLabel[],
    milestones: readonly GitHubMilestone[]
): DetectedConventions {
    const missing: MissingLabel[] = [];

    const statuses = STATUS_IDS.map((id) => {
        const label = matchLabel(labels, STATUS_SYNONYMS[id]);
        if (label === null) missing.push({ ...CANONICAL_STATUS_LABELS[id], slot: id });
        return { id, label };
    });

    const priorities = { p0: null, p1: null, p2: null, p3: null } as BoardPriorities;
    for (const id of PRIORITY_IDS) {
        const label = matchLabel(labels, PRIORITY_SYNONYMS[id]);
        if (label === null) missing.push({ ...CANONICAL_PRIORITY_LABELS[id], slot: id });
        priorities[id] = label;
    }

    return {
        config: {
            version: 1,
            owner,
            repo,
            statuses,
            priorities,
            cycleSource: milestones.length > 0 ? 'milestones' : 'none',
            closeOnDone: true,
            createdBy: null
        },
        missing,
        milestoneCount: milestones.length
    };
}
