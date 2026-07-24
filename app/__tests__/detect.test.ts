/**
 * Convention detection (pulse#40) — the pure heuristics behind the setup
 * flow, matrix-tested against the lumen fixture dataset (the recorded repo
 * the smoke drives) plus synthetic synonym/prefix/missing cases.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHubLabel, GitHubMilestone } from '@pulse/github';
import { detectBoard, normalizeLabelName, STATUS_IDS, PRIORITY_IDS } from '../src/board/detect';

// Vitest runs from the repo root (import.meta.url is not a file: URL under
// the happy-dom environment, so resolve from cwd instead).
const fixture = <T>(rel: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), 'packages', 'github', 'fixtures', rel), 'utf-8')) as T;

const lumenLabels = fixture<GitHubLabel[]>('labels/lumen/lumen.json');
const lumenMilestones = fixture<GitHubMilestone[]>('milestones/lumen/lumen.json');

/** A minimal label — detection only reads names. */
const label = (name: string): GitHubLabel => ({ name, color: 'cccccc', description: null });

describe('normalizeLabelName', () => {
    it.each([
        ['Status: In Progress', 'in progress'],
        ['status:todo', 'todo'],
        ['priority: HIGH', 'high'],
        ['prio:p1', 'p1'],
        ['  WIP  ', 'wip'],
        ['bug', 'bug']
    ])('normalizes %j to %j', (raw, normalized) => {
        expect(normalizeLabelName(raw)).toBe(normalized);
    });

    it('strips only ONE prefix (a pathological "status: priority: x" keeps the rest)', () => {
        expect(normalizeLabelName('status: priority: x')).toBe('priority: x');
    });
});

describe('detectBoard — lumen fixtures', () => {
    const det = detectBoard('lumen', 'lumen', lumenLabels, lumenMilestones);

    it('maps every status column to the repo\'s status: labels', () => {
        expect(det.config.statuses).toEqual([
            { id: 'backlog', label: 'status: backlog' },
            { id: 'todo', label: 'status: todo' },
            { id: 'inprogress', label: 'status: in progress' },
            { id: 'inreview', label: 'status: in review' },
            { id: 'done', label: 'status: done' }
        ]);
    });

    it('maps every priority to the P0–P3 labels (original casing preserved)', () => {
        expect(det.config.priorities).toEqual({ p0: 'P0', p1: 'P1', p2: 'P2', p3: 'P3' });
    });

    it('finds nothing missing and proposes milestone cycles', () => {
        expect(det.missing).toEqual([]);
        expect(det.milestoneCount).toBe(5);
        expect(det.config.cycleSource).toBe('milestones');
    });

    it('produces a v1 config for the requested repo with createdBy unstamped', () => {
        expect(det.config.version).toBe(1);
        expect(det.config.owner).toBe('lumen');
        expect(det.config.repo).toBe('lumen');
        expect(det.config.closeOnDone).toBe(true);
        expect(det.config.createdBy).toBeNull();
    });
});

describe('detectBoard — synonym matrix', () => {
    it.each([
        ['icebox', 'backlog'],
        ['Ready', 'todo'],
        ['triage', 'todo'],
        ['wip', 'inprogress'],
        ['in-progress', 'inprogress'],
        ['Doing', 'inprogress'],
        ['needs review', 'inreview'],
        ['Reviewing', 'inreview'],
        ['completed', 'done'],
        ['Complete', 'done']
    ])('label %j fills the %s column', (name, statusId) => {
        const det = detectBoard('o', 'r', [label(name)], []);
        expect(det.config.statuses.find((s) => s.id === statusId)?.label).toBe(name);
    });

    it.each([
        ['urgent', 'p0'],
        ['Critical', 'p0'],
        ['high', 'p1'],
        ['medium', 'p2'],
        ['normal', 'p2'],
        ['low', 'p3']
    ])('label %j fills priority %s', (name, prio) => {
        const det = detectBoard('o', 'r', [label(name)], []);
        expect(det.config.priorities[prio as 'p0' | 'p1' | 'p2' | 'p3']).toBe(name);
    });

    it('matches through the status:/priority: prefixes', () => {
        const det = detectBoard('o', 'r', [label('Status: WIP'), label('priority: urgent')], []);
        expect(det.config.statuses.find((s) => s.id === 'inprogress')?.label).toBe('Status: WIP');
        expect(det.config.priorities.p0).toBe('priority: urgent');
    });

    it('prefers the earlier synonym when several labels compete for one slot', () => {
        const det = detectBoard('o', 'r', [label('ready'), label('todo')], []);
        expect(det.config.statuses.find((s) => s.id === 'todo')?.label).toBe('todo');
    });
});

describe('detectBoard — a bare repo', () => {
    const det = detectBoard('o', 'r', [], []);

    it('leaves every slot unmapped and proposes all nine canonical labels', () => {
        expect(det.config.statuses.every((s) => s.label === null)).toBe(true);
        expect(Object.values(det.config.priorities).every((p) => p === null)).toBe(true);
        expect(det.missing.map((m) => m.name)).toEqual([
            'status: backlog', 'status: todo', 'status: in progress', 'status: in review', 'status: done',
            'P0', 'P1', 'P2', 'P3'
        ]);
    });

    it('tags each missing label with the slot it would fill', () => {
        expect(det.missing.map((m) => m.slot)).toEqual([...STATUS_IDS, ...PRIORITY_IDS]);
    });

    it('proposes GitHub-shaped hex colors (6 digits, no #)', () => {
        for (const m of det.missing) {
            expect(m.color).toMatch(/^[0-9a-f]{6}$/);
        }
    });

    it('proposes no cycles without milestones', () => {
        expect(det.config.cycleSource).toBe('none');
        expect(det.milestoneCount).toBe(0);
    });
});
