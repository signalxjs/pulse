/**
 * createIssue's core (applyCreate) over the REAL fixtures client — the
 * applyMove pattern: slot ids in, config-mapped labels out, one create
 * (plus the closing PATCH only when the target column closes issues).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixturesClient } from '@pulse/github/fixtures';
import type { GitHubLabel, GitHubMilestone } from '@pulse/github';
import type { BoardConfig } from '@pulse/db';
import { detectBoard } from '../src/board/detect';
import { applyCreate } from '../src/server/mutations.server';

const fixture = <T>(rel: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), 'packages', 'github', 'fixtures', rel), 'utf-8')) as T;

const labels = fixture<GitHubLabel[]>('labels/lumen/lumen.json');
const milestones = fixture<GitHubMilestone[]>('milestones/lumen/lumen.json');

/** The config setup would store for lumen (closeOnDone defaults to true). */
const config: BoardConfig = detectBoard('lumen', 'lumen', labels, milestones).config;

const names = (issue: { labels: { name: string }[] }) => issue.labels.map((l) => l.name);

describe('applyCreate (createIssue core) over the fixtures client', () => {
    it('maps priority + status slots to the config labels', async () => {
        const gh = createFixturesClient();
        const issue = await applyCreate(gh, config, {
            owner: 'lumen', repo: 'lumen', title: 'A fresh issue', body: 'Details.',
            priority: 'p1', status: 'todo'
        });
        expect(issue.number).toBeGreaterThan(513); // past the fixture max
        expect(issue.state).toBe('open');
        expect(issue.body).toBe('Details.');
        expect(names(issue)).toEqual(expect.arrayContaining(['P1', 'status: todo']));
        // The write persisted on the adapter — a re-read sees it.
        const reread = await gh.issue('lumen', 'lumen', issue.number);
        expect(reread?.title).toBe('A fresh issue');
    });

    it('creates label-less when neither slot is picked', async () => {
        const gh = createFixturesClient();
        const issue = await applyCreate(gh, config, {
            owner: 'lumen', repo: 'lumen', title: 'Bare', priority: null, status: null
        });
        expect(names(issue)).toEqual([]);
        expect(issue.body).toBeNull();
    });

    it('a done placement closes the fresh issue when closeOnDone is set', async () => {
        const gh = createFixturesClient();
        const issue = await applyCreate(gh, config, {
            owner: 'lumen', repo: 'lumen', title: 'Born done', status: 'done'
        });
        expect(issue.state).toBe('closed');
        expect(issue.closedAt).not.toBeNull();
        expect(names(issue)).toContain('status: done');
    });

    it('rejects a column that cannot persist a placement (unmapped backlog)', async () => {
        const gh = createFixturesClient();
        const unmapped: BoardConfig = {
            ...config,
            statuses: config.statuses.map((s) => (s.id === 'backlog' ? { ...s, label: null } : s))
        };
        await expect(applyCreate(gh, unmapped, {
            owner: 'lumen', repo: 'lumen', title: 'Nowhere to stand', status: 'backlog'
        })).rejects.toThrow(/no mapped label/);
    });

    it('skips an UNMAPPED priority slot instead of inventing a label', async () => {
        const gh = createFixturesClient();
        const noP2: BoardConfig = { ...config, priorities: { ...config.priorities, p2: null } };
        const issue = await applyCreate(gh, noP2, {
            owner: 'lumen', repo: 'lumen', title: 'No P2 mapping', priority: 'p2', status: 'todo'
        });
        expect(names(issue)).toEqual(['status: todo']);
    });
});
