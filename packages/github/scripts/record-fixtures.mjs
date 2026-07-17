// Refresh the committed fixtures from the live GitHub API.
//
//   GITHUB_TOKEN=$(gh auth token) node packages/github/scripts/record-fixtures.mjs
//
// Public signalxjs data is recorded as-is (already-mapped client shapes,
// which is exactly what the fixtures adapter serves back). The viewer and
// org membership are SYNTHETIC — fixtures must not embed anyone's identity.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveClient } from '../src/index.js';

const token = process.env.GITHUB_TOKEN;
if (!token) {
    console.error('GITHUB_TOKEN required (e.g. GITHUB_TOKEN=$(gh auth token))');
    process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const gh = createLiveClient({ token });

const write = (rel, data) => {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
    console.log('wrote', rel);
};

// Synthetic identity — deterministic, nobody's real account.
write('viewer.json', {
    login: 'pulse-dev',
    name: 'Pulse Developer',
    avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4'
});
write('viewer-orgs.json', [
    { login: 'signalxjs', avatarUrl: 'https://avatars.githubusercontent.com/u/230127961?v=4', description: 'SignalX — fine-grained reactive UI' }
]);

const signalxRepos = await gh.ownerRepos('signalxjs');
write('viewer-repos.json', signalxRepos);
write(join('owner-repos', 'signalxjs.json'), signalxRepos);
write(join('repo', 'signalxjs', 'core.json'), await gh.repo('signalxjs', 'core'));
write(join('repo', 'signalxjs', 'pulse.json'), await gh.repo('signalxjs', 'pulse'));
console.log('done');
