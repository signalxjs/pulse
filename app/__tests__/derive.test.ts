/**
 * Board derivations (pulse#40) — statusOf / priorityOf / moveLabels /
 * cycles / sprint stats / roadmap slots / chrome lists, matrix-tested
 * against the lumen fixture dataset with a pinned clock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHubIssue, GitHubLabel, GitHubMilestone, GitHubPerson } from '@pulse/github';
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import { detectBoard } from '../src/board/detect';
import {
    statusOf, priorityOf, moveLabels, cyclesFrom, currentCycle, sprintStats,
    roadmapWindowStart, roadmapSlot, labelsFor, peopleFor,
    cardLabels, filterIssues, sortByPriority
} from '../src/board/derive';

// Vitest runs from the repo root (import.meta.url is not a file: URL under
// the happy-dom environment, so resolve from cwd instead).
const fixture = <T>(rel: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), 'packages', 'github', 'fixtures', rel), 'utf-8')) as T;

const issues = fixture<GitHubIssue[]>('issues/lumen/lumen.json');
const labels = fixture<GitHubLabel[]>('labels/lumen/lumen.json');
const milestones = fixture<GitHubMilestone[]>('milestones/lumen/lumen.json');
const collaborators = fixture<GitHubPerson[]>('collaborators/lumen/lumen.json');

/** The config the setup flow would store for lumen (detection-verified in
 *  detect.test.ts) — derivations run over exactly what users get. */
const config: BoardConfig = detectBoard('lumen', 'lumen', labels, milestones).config;

/** Inside the fixtures' Cycle 24 window (Jul 14 – Jul 28 2026, a Friday). */
const NOW = new Date('2026-07-24T12:00:00Z');

/** Synthetic minimal issue for the fallback branches. */
function issue(over: Partial<GitHubIssue>): GitHubIssue {
    return {
        number: 1, title: 't', body: null, state: 'open', isPr: false, draft: false,
        labels: [], assignees: [], milestone: null, comments: 0, author: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        closedAt: null, htmlUrl: 'https://github.com/lumen/lumen/issues/1',
        ...over
    };
}
const withLabels = (...names: string[]) =>
    issue({ labels: names.map((name) => ({ name, color: 'cccccc', description: null })) });

describe('statusOf', () => {
    it('distributes the whole lumen dataset into the expected columns', () => {
        const counts = new Map<BoardStatusId, number>();
        for (const i of issues) {
            const s = statusOf(i, config);
            counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        expect(Object.fromEntries(counts)).toEqual({
            backlog: 6, todo: 4, inprogress: 4, inreview: 4, done: 4
        });
    });

    it('closed wins over a stale status label', () => {
        const i = issue({ state: 'closed', labels: [{ name: 'status: in progress', color: 'cccccc', description: null }] });
        expect(statusOf(i, config)).toBe('done');
    });

    it('matches status labels case-insensitively', () => {
        expect(statusOf(withLabels('Status: In Progress'), config)).toBe('inprogress');
    });

    it('falls back on issue state when no status label is mapped: PR → inreview, issue → todo', () => {
        expect(statusOf(issue({ isPr: true }), config)).toBe('inreview');
        expect(statusOf(issue({}), config)).toBe('todo');
    });

    it('with a label-less config every open issue derives from state alone', () => {
        const bare = detectBoard('o', 'r', [], []).config;
        expect(statusOf(withLabels('status: backlog'), bare)).toBe('todo');
    });
});

describe('priorityOf', () => {
    it('distributes the lumen dataset over P0–P3', () => {
        const counts = new Map<number | null, number>();
        for (const i of issues) {
            const p = priorityOf(i, config);
            counts.set(p, (counts.get(p) ?? 0) + 1);
        }
        expect(counts.get(0)).toBe(3);
        expect(counts.get(1)).toBe(9);
        expect(counts.get(2)).toBe(8);
        expect(counts.get(3)).toBe(2);
        expect(counts.get(null)).toBeUndefined();
    });

    it('answers null for an unlabeled issue and for an unmapped config', () => {
        expect(priorityOf(issue({}), config)).toBeNull();
        const bare = detectBoard('o', 'r', [], []).config;
        expect(priorityOf(withLabels('P0'), bare)).toBeNull();
    });
});

describe('moveLabels', () => {
    const current = ['security', 'bug', 'status: todo', 'P0'];

    it('swaps the mapped status label and keeps everything else', () => {
        expect(moveLabels(config, current, 'inprogress')).toEqual({
            labels: ['security', 'bug', 'P0', 'status: in progress'],
            state: 'open'
        });
    });

    it('moving into done closes the issue when closeOnDone is set', () => {
        expect(moveLabels(config, current, 'done')).toEqual({
            labels: ['security', 'bug', 'P0', 'status: done'],
            state: 'closed'
        });
    });

    it('moving into done leaves state alone when closeOnDone is off', () => {
        const open = { ...config, closeOnDone: false };
        expect(moveLabels(open, current, 'done')).toEqual({
            labels: ['security', 'bug', 'P0', 'status: done']
        });
    });

    it('moving OUT of done reopens (state open) and drops the done label', () => {
        expect(moveLabels(config, ['status: done', 'bug'], 'backlog')).toEqual({
            labels: ['bug', 'status: backlog'],
            state: 'open'
        });
    });

    it('strips mapped labels case-insensitively', () => {
        expect(moveLabels(config, ['Status: Todo'], 'backlog').labels).toEqual(['status: backlog']);
    });

    it('an unmapped target column patches labels only (no status label to add)', () => {
        const bare = detectBoard('o', 'r', [], []).config;
        expect(moveLabels(bare, ['bug'], 'inprogress')).toEqual({ labels: ['bug'], state: 'open' });
    });
});

describe('cycles', () => {
    const cycles = cyclesFrom(milestones, NOW);

    it('orders by due date and derives two-week windows', () => {
        expect(cycles.map((c) => c.title)).toEqual(['Cycle 22', 'Cycle 23', 'Cycle 24', 'Cycle 25', 'v3.0']);
        expect(cycles[2]).toMatchObject({
            number: 24,
            start: '2026-07-14T07:00:00.000Z',
            end: '2026-07-28T07:00:00Z',
            state: 'active',
            done: 2,
            total: 14
        });
    });

    it('derives states from milestone state + window: done, done, active, planned, planned', () => {
        expect(cycles.map((c) => c.state)).toEqual(['done', 'done', 'active', 'planned', 'planned']);
    });

    it('ignores milestones without a due date (not time windows)', () => {
        const noDue: GitHubMilestone = {
            number: 99, title: 'Someday', state: 'open', description: null,
            dueOn: null, openIssues: 1, closedIssues: 0
        };
        expect(cyclesFrom([noDue], NOW)).toEqual([]);
    });

    it('currentCycle picks the active cycle containing now', () => {
        expect(currentCycle(cycles, NOW)?.number).toBe(24);
    });

    it('currentCycle falls back to an overdue active cycle, then the next planned one', () => {
        const after = new Date('2026-09-01T00:00:00Z');
        // By September every open lumen cycle window has started → the last
        // one still counts as active (overdue), never null.
        expect(currentCycle(cyclesFrom(milestones, after), after)).not.toBeNull();
        expect(currentCycle([], NOW)).toBeNull();
    });
});

describe('sprintStats', () => {
    it('summarizes the current lumen cycle', () => {
        const cycles = cyclesFrom(milestones, NOW);
        const cycle = currentCycle(cycles, NOW)!;
        expect(sprintStats(issues, config, cycle)).toEqual({
            scope: 14, inFlight: 8, completed: 2, notStarted: 4, pctComplete: 14
        });
    });

    it('an empty scope is 0% complete (no divide-by-zero)', () => {
        const cycle = cyclesFrom(milestones, NOW)[4]!; // v3.0 — no issues
        expect(sprintStats(issues, config, cycle).pctComplete).toBe(0);
    });
});

describe('roadmap window & slots', () => {
    it('starts the 12-week window on the Monday five weeks back', () => {
        expect(roadmapWindowStart(NOW).toISOString()).toBe('2026-06-15T00:00:00.000Z');
        // A Monday maps to itself minus exactly 35 days.
        expect(roadmapWindowStart(new Date('2026-07-20T09:00:00Z')).toISOString())
            .toBe('2026-06-15T00:00:00.000Z');
    });

    it('slots the lumen cycles into 2-week columns', () => {
        const windowStart = roadmapWindowStart(NOW);
        const slots = cyclesFrom(milestones, NOW).map((c) => roadmapSlot(c, windowStart));
        expect(slots).toEqual([0, 1, 2, 3, 3]);
    });

    it('clamps a still-running cycle from before the window to slot 0, drops fully-past/far-future ones', () => {
        const windowStart = roadmapWindowStart(NOW);
        const mk = (dueOn: string): GitHubMilestone => ({
            number: 1, title: 'c', state: 'open', description: null, dueOn, openIssues: 0, closedIssues: 0
        });
        const [running] = cyclesFrom([mk('2026-06-16T00:00:00Z')], NOW); // starts Jun 2, ends inside window
        expect(roadmapSlot(running!, windowStart)).toBe(0);
        const [past] = cyclesFrom([mk('2026-06-01T00:00:00Z')], NOW); // ended before the window
        expect(roadmapSlot(past!, windowStart)).toBeNull();
        const [future] = cyclesFrom([mk('2026-12-01T00:00:00Z')], NOW); // beyond slot 5
        expect(roadmapSlot(future!, windowStart)).toBeNull();
    });
});

describe('chrome lists', () => {
    it('labelsFor filters the config-mapped labels and counts open issues', () => {
        const list = labelsFor(labels, issues, config);
        expect(list.map((l) => l.name)).toEqual([
            'bug', 'feature', 'performance', 'docs', 'security', 'good first issue', 'enhancement'
        ]);
        const bug = list.find((l) => l.name === 'bug')!;
        expect(bug.count).toBe(6);
        expect(bug.hue).toBeGreaterThanOrEqual(0);
        expect(bug.hue).toBeLessThan(360);
    });

    it('labelsFor without a config keeps every label (setup-time view)', () => {
        expect(labelsFor(labels, issues, null)).toHaveLength(labels.length);
    });

    it('peopleFor derives initials, stable hues and open assignment counts', () => {
        const team = peopleFor(collaborators, issues);
        expect(team.map((p) => [p.name, p.count])).toEqual([
            ['rin', 0], ['mira', 4], ['devon', 3], ['sana', 3], ['lee', 5]
        ]);
        const mira = team.find((p) => p.name === 'mira')!;
        expect(mira.initials).toBe('MI');
        expect(mira.hue).toBeGreaterThanOrEqual(0);
        expect(mira.hue).toBeLessThan(360);
        // Stable across calls — the same login always paints the same hue.
        expect(peopleFor(collaborators, issues).find((p) => p.name === 'mira')!.hue).toBe(mira.hue);
    });

    it('peopleFor splits separator-carrying logins into two-letter monograms', () => {
        const [p] = peopleFor([{ login: 'good-first', avatarUrl: '' }], []);
        expect(p!.initials).toBe('GF');
    });
});

describe('filterIssues (the live view filter — Board and List share it)', () => {
    it('matches a case-insensitive title substring', () => {
        const hits = filterIssues(issues, { query: 'SANITIZE', filterLabel: null });
        expect(hits.map((i) => i.number)).toEqual([511]);
    });

    it('matches an issue-number prefix, with and without the # form', () => {
        const bare = filterIssues(issues, { query: '51', filterLabel: null }).map((i) => i.number);
        expect(bare.sort()).toEqual([511, 513]);
        const hashed = filterIssues(issues, { query: '#51', filterLabel: null }).map((i) => i.number);
        expect(hashed.sort()).toEqual([511, 513]);
        expect(filterIssues(issues, { query: '#513', filterLabel: null }).map((i) => i.number)).toEqual([513]);
    });

    it('filters by the active label name', () => {
        const bugs = filterIssues(issues, { query: '', filterLabel: 'bug' });
        expect(bugs).toHaveLength(8);
        expect(bugs.every((i) => i.labels.some((l) => l.name === 'bug'))).toBe(true);
    });

    it('applies query and label together, and a blank query passes everything', () => {
        const both = filterIssues(issues, { query: 'tooltip', filterLabel: 'bug' });
        expect(both.map((i) => i.number)).toEqual([506]);
        expect(filterIssues(issues, { query: '  ', filterLabel: null })).toHaveLength(issues.length);
    });
});

describe('sortByPriority (card/row order)', () => {
    it('orders priority ascending then number descending across the todo column', () => {
        const todo = issues.filter((i) => statusOf(i, config) === 'todo');
        expect(sortByPriority(todo, config).map((i) => i.number)).toEqual([511, 501, 513, 490]);
    });

    it('puts unprioritized issues last', () => {
        const unprioritized = withLabels('bug');
        const p3 = { ...withLabels('P3'), number: 2 };
        expect(sortByPriority([unprioritized, p3], config).map((i) => i.number)).toEqual([2, 1]);
    });

    it('does not mutate its input', () => {
        const todo = issues.filter((i) => statusOf(i, config) === 'todo');
        const before = todo.map((i) => i.number);
        sortByPriority(todo, config);
        expect(todo.map((i) => i.number)).toEqual(before);
    });
});

describe('cardLabels (the tag pills one card/row renders)', () => {
    it('drops the config-mapped status/priority labels, keeps the tags with real hues', () => {
        const i511 = issues.find((i) => i.number === 511)!;
        const pills = cardLabels(i511, config);
        expect(pills.map((p) => p.name)).toEqual(['security', 'bug']);
        for (const p of pills) {
            expect(p.hue).not.toBeNull();
            expect(p.hue).toBeGreaterThanOrEqual(0);
            expect(p.hue).toBeLessThan(360);
        }
    });

    it('marks achromatic and malformed label colors with a null hue (neutral pill)', () => {
        const grey = issue({ labels: [{ name: 'wontfix', color: 'cccccc', description: null }] });
        expect(cardLabels(grey, config)).toEqual([{ key: 'wontfix', name: 'wontfix', hue: null }]);
        const bad = issue({ labels: [{ name: 'odd', color: 'not-a-hex', description: null }] });
        expect(cardLabels(bad, config)![0]!.hue).toBeNull();
    });

    it('keeps every label when no config exists', () => {
        const i511 = issues.find((i) => i.number === 511)!;
        expect(cardLabels(i511, null).map((p) => p.name))
            .toEqual(['security', 'bug', 'status: todo', 'P0']);
    });
});
