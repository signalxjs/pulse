/**
 * moveIssue's core (applyMove) over the REAL fixtures client — the same
 * adapter the smokes drive: read the current issue, derive the label/state
 * patch, apply it in one updateIssue PATCH. The serverFn handler around it
 * only adds auth + the stored-config lookup (exercised by the smoke).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixturesClient } from '@pulse/github/fixtures';
import type { GitHubLabel, GitHubMilestone } from '@pulse/github';
import type { BoardConfig } from '@pulse/db';
import { detectBoard } from '../src/board/detect';
import { applyMove } from '../src/server/mutations.server';

const fixture = <T>(rel: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), 'packages', 'github', 'fixtures', rel), 'utf-8')) as T;

const labels = fixture<GitHubLabel[]>('labels/lumen/lumen.json');
const milestones = fixture<GitHubMilestone[]>('milestones/lumen/lumen.json');

/** The config setup would store for lumen (closeOnDone defaults to true). */
const config: BoardConfig = detectBoard('lumen', 'lumen', labels, milestones).config;

const names = (issue: { labels: { name: string }[] }) => issue.labels.map((l) => l.name);

describe('applyMove (moveIssue core) over the fixtures client', () => {
    it('swaps the status label in ONE PATCH and keeps every other label', async () => {
        const gh = createFixturesClient();
        // #513: open, 'status: todo' + feature/good first issue/P2.
        const updated = await applyMove(gh, config, 'lumen', 'lumen', 513, 'inprogress');
        expect(names(updated)).toContain('status: in progress');
        expect(names(updated)).not.toContain('status: todo');
        expect(names(updated)).toEqual(
            expect.arrayContaining(['feature', 'good first issue', 'P2'])
        );
        expect(updated.state).toBe('open');
        // The write persisted on the adapter — a re-read sees the move.
        const reread = await gh.issue('lumen', 'lumen', 513);
        expect(names(reread!)).toContain('status: in progress');
    });

    it('moving into done closes the issue when closeOnDone is set', async () => {
        const gh = createFixturesClient();
        const updated = await applyMove(gh, config, 'lumen', 'lumen', 513, 'done');
        expect(updated.state).toBe('closed');
        expect(updated.closedAt).not.toBeNull();
        expect(names(updated)).toContain('status: done');
    });

    it('moving into done leaves the issue open when closeOnDone is off', async () => {
        const gh = createFixturesClient();
        const updated = await applyMove(
            gh, { ...config, closeOnDone: false }, 'lumen', 'lumen', 513, 'done'
        );
        expect(updated.state).toBe('open');
        expect(names(updated)).toContain('status: done');
    });

    it('dragging a card OUT of Done reopens the closed issue', async () => {
        const gh = createFixturesClient();
        // #452: closed, 'status: done'.
        const updated = await applyMove(gh, config, 'lumen', 'lumen', 452, 'todo');
        expect(updated.state).toBe('open');
        expect(updated.closedAt).toBeNull();
        expect(names(updated)).toContain('status: todo');
        expect(names(updated)).not.toContain('status: done');
    });

    it('a missing issue answers a 404 error, not a write', async () => {
        const gh = createFixturesClient();
        await expect(applyMove(gh, config, 'lumen', 'lumen', 999999, 'todo'))
            .rejects.toThrow(/does not exist/);
    });
});

describe('canRepresent', () => {
    it('label-mapped columns and state-derivable done/todo accept drops; other unmapped columns do not', async () => {
        const { canRepresent } = await import('../src/board/derive');
        const config = {
            version: 1 as const, owner: 'o', repo: 'r',
            statuses: [
                { id: 'backlog' as const, label: null },
                { id: 'todo' as const, label: null },
                { id: 'inprogress' as const, label: 'status: in progress' },
                { id: 'inreview' as const, label: null },
                { id: 'done' as const, label: null }
            ],
            priorities: { p0: null, p1: null, p2: null, p3: null },
            cycleSource: 'none' as const, closeOnDone: true, createdBy: null
        };
        expect(canRepresent(config, 'inprogress')).toBe(true);
        expect(canRepresent(config, 'done')).toBe(true);
        expect(canRepresent(config, 'todo')).toBe(true);
        expect(canRepresent(config, 'backlog')).toBe(false);
        expect(canRepresent(config, 'inreview')).toBe(false);
        // Unmapped done persists only via closing — closeOnDone off makes
        // the move unrecordable.
        expect(canRepresent({ ...config, closeOnDone: false }, 'done')).toBe(false);
    });
});
