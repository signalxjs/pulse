// Pulse browser smoke — the M1 gate (pulse#1), fixture mode (tokenless,
// deterministic). ONE assertion set, two servers ("serves identically" is
// the exit criterion, rfc-deploy §6):
//
//   pnpm build            && pnpm smoke       # node: dist/ over server.mjs
//   pnpm build:cloudflare && pnpm smoke:cf    # workerd: dist-cf/ over wrangler dev
//
// The --cf mode applies the D1 migrations --local first (wrangler and
// packages/db's runner track the same d1_migrations table), then spawns
// `wrangler dev` over the built worker — real workerd, real assets config.
//
// Real-Chrome UA throughout: HeadlessChrome matches the isBot regex and
// would get the blocking document instead of the streaming human path.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CF = process.argv.includes('--cf');
// Distinct default ports so a node smoke and a cf smoke never collide.
const PORT = Number(process.env.PORT) || (CF ? 4181 : 4180);
const BASE = `http://localhost:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Expected Roadmap/Sprint/Backlog numbers, computed from the fixture
 * dataset by re-implementing derive.ts's rules (status labels → columns,
 * milestone → cycle, currentCycle pick) against the KNOWN lumen conventions
 * (`status: …` labels + `P0–P3`) that the smoke's setup saves — the numbers
 * are computed, not hard-coded, because the sprint/backlog assertions run
 * AFTER the 5d drag
 * (#513 Todo → In Progress persists in the fixtures overlay) and the
 * current-cycle pick depends on the real clock.
 */
function expectedViewNumbers() {
    const fx = (rel) => JSON.parse(readFileSync(new URL(`../packages/github/fixtures/${rel}`, import.meta.url), 'utf-8'));
    const DAY = 86_400_000;
    const statusLabels = {
        'status: backlog': 'backlog', 'status: todo': 'todo',
        'status: in progress': 'inprogress', 'status: in review': 'inreview', 'status: done': 'done'
    };
    // The 5d drag moved #513 into In Progress — apply it to the disk data.
    const dragged = { 513: 'inprogress' };
    const statusOf = (i) => {
        // Mirror derive.statusOf's precedence: closed → done wins over any
        // label (and over a drag override) so the expectations stay aligned
        // if a fixture ever has a closed, dragged, or mislabeled issue.
        if (i.state === 'closed') return 'done';
        if (dragged[i.number]) return dragged[i.number];
        for (const l of i.labels) {
            const s = statusLabels[l.name.toLowerCase()];
            if (s) return s;
        }
        return i.isPr ? 'inreview' : 'todo';
    };
    const prioOf = (i) => {
        for (const l of i.labels) {
            const m = /^p([0-3])$/i.exec(l.name);
            if (m) return Number(m[1]);
        }
        return 4;
    };
    const issues = fx('issues/lumen/lumen.json');
    const now = Date.now();
    const cycles = fx('milestones/lumen/lumen.json')
        .filter((m) => m.dueOn !== null)
        .sort((a, b) => Date.parse(a.dueOn) - Date.parse(b.dueOn))
        .map((m) => ({
            number: m.number,
            end: Date.parse(m.dueOn),
            start: Date.parse(m.dueOn) - 14 * DAY,
            state: m.state === 'closed' ? 'done' : Date.parse(m.dueOn) - 14 * DAY <= now ? 'active' : 'planned',
            total: m.openIssues + m.closedIssues
        }));
    // Per-cycle roadmap bar/marker expectations over the rolling window.
    const windowStart = new Date(now);
    windowStart.setUTCHours(0, 0, 0, 0);
    windowStart.setUTCDate(windowStart.getUTCDate() - ((windowStart.getUTCDay() + 6) % 7) - 35);
    const roadmap = cycles.map((c) => {
        const inCycle = issues.filter((i) => i.milestone?.number === c.number);
        const done = inCycle.filter((i) => statusOf(i) === 'done').length;
        const slot = Math.floor((c.start - windowStart.getTime()) / (14 * DAY));
        const frac = (c.end - windowStart.getTime()) / (12 * 7 * DAY);
        return {
            number: c.number,
            marker: c.total === 0,
            inWindow: c.total === 0
                ? frac >= 0 && frac <= 1
                : (slot >= 0 && slot < 6) || (slot < 0 && c.end > windowStart.getTime()),
            label: inCycle.length > 0 ? `${done}/${inCycle.length}` : 'planned'
        };
    });
    // The sprint's cycle: active-and-inside-window, else overdue active,
    // else next planned (derive.currentCycle).
    const cur = cycles.find((c) => c.state === 'active' && now <= c.end)
        ?? cycles.find((c) => c.state === 'active')
        ?? cycles.find((c) => c.state === 'planned');
    const scoped = issues.filter((i) => i.milestone?.number === cur.number);
    const by = (s) => scoped.filter((i) => s.includes(statusOf(i)));
    const sprint = {
        scope: scoped.length,
        inFlight: by(['inprogress', 'inreview']).length,
        completed: by(['done']).length,
        notStarted: by(['backlog', 'todo']).length,
        pct: scoped.length === 0 ? 0 : Math.round((by(['done']).length / scoped.length) * 100),
        firstFocus: by(['inprogress', 'inreview'])
            .sort((a, b) => (prioOf(a) - prioOf(b)) || (b.number - a.number))[0]?.number,
        upNext: by(['todo']).length
    };
    const unstarted = issues
        .filter((i) => ['backlog', 'todo'].includes(statusOf(i)))
        .sort((a, b) => (prioOf(a) - prioOf(b)) || (b.number - a.number));
    return { roadmap, cycleCount: cycles.length, sprint, backlog: { count: unstarted.length, first: unstarted[0]?.number } };
}

function assert(cond, message) {
    if (!cond) {
        throw new Error(`❌ pulse-smoke: ${message}`);
    }
    console.log(`✔ ${message}`);
}

async function waitForServer(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status > 0) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`❌ pulse-smoke: server did not come up on ${url}`);
}

function startNodeServer() {
    return spawn(
        process.execPath,
        ['--conditions', 'production', 'server.mjs'],
        {
            cwd: APP_DIR,
            env: {
                ...process.env,
                NODE_ENV: 'production',
                PORT: String(PORT),
                PULSE_FIXTURES: '1',
                PULSE_SECRET: 'smoke-secret',
                PULSE_INSECURE_COOKIES: '1'
            },
            // Inherit server output — CI failures need the startup logs.
            stdio: 'inherit'
        }
    );
}

function startWorkerd() {
    const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
    // Deterministic every run: wrangler --local persists D1 state across
    // runs (.wrangler/state), so a previous smoke's saved board config
    // would break the setup-redirect assertions. Start from nothing.
    rmSync(new URL('.wrangler/state', import.meta.url), { recursive: true, force: true });
    // Schema first: the worker never applies migrations itself (wrangler
    // owns the schema on this target). --local writes .wrangler/state, the
    // same store `wrangler dev` reads below.
    const migrate = spawnSync(
        'pnpm',
        ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'pulse', '--local'],
        { cwd: APP_DIR, env, stdio: 'inherit' }
    );
    if (migrate.status !== 0) {
        throw new Error('❌ pulse-smoke: wrangler d1 migrations apply --local failed');
    }
    return spawn(
        'pnpm',
        [
            'exec', 'wrangler', 'dev', '--local', '--port', String(PORT),
            // Workers read config vars, not process env — same trio the
            // node smoke exports.
            '--var', 'PULSE_FIXTURES:1',
            '--var', 'PULSE_SECRET:smoke-secret',
            '--var', 'PULSE_INSECURE_COOKIES:1'
        ],
        { cwd: APP_DIR, env, stdio: 'inherit' }
    );
}

const server = CF ? startWorkerd() : startNodeServer();

let browser;
try {
    // Generous in cf mode: wrangler's first run may still download workerd.
    await waitForServer(`${BASE}/`, CF ? 120000 : 15000);

    // ---- HTTP-level contract (no browser) ----
    const signedOut = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'user-agent': UA } });
    assert(signedOut.status === 302, 'signed-out / answers a REAL 302');
    assert(signedOut.headers.get('location') === '/login?returnTo=%2F', 'redirect target carries returnTo');
    const missing = await fetch(`${BASE}/definitely-not-a-page`, { headers: { 'user-agent': UA } });
    assert(missing.status === 404, 'unknown routes answer a REAL 404');
    // The /api/github proxy is RETIRED (pulse#34) — data rides server
    // functions. Unauthenticated calls answer the withAuth guard's 401
    // (probed via the deploy-durable STABLE symbol, never the content hash).
    const proxyGone = await fetch(`${BASE}/api/github/viewer`, { headers: { 'user-agent': UA } });
    assert(proxyGone.status === 404, 'the retired /api/github proxy no longer answers');
    const fnNoAuth = await fetch(
        `${BASE}/_sigx/fn/${encodeURIComponent('pulse-app/src/server/repos.server.ts#viewerRepos')}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ args: [] })
        }
    );
    assert(fnNoAuth.status === 401, 'an unauthenticated server-fn call answers the guard\'s 401');

    // ---- Browser flow ----
    browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: UA });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));

    // 1) Signed out: / lands on the login page.
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    assert(page.url().includes('/login'), 'browser lands on /login when signed out');

    // 1b) The PAT form is a resume boundary carrying a NATIVE `form: true`
    // action (pulse#57): submitting works with JS off / before the loader
    // arrives. The build stamps action="/_sigx/fn/<symbol>" + method=post
    // onto the same <form> that also carries the resume delegation attr.
    const formAction = await page.getAttribute('form', 'action');
    const formMethod = (await page.getAttribute('form', 'method'))?.toLowerCase();
    assert(
        typeof formAction === 'string' && formAction.includes('/_sigx/fn/') && formAction.includes('submitPat') && formMethod === 'post',
        `the PAT form carries the native form:true action (${formAction} ${formMethod})`
    );
    assert(await page.getAttribute('form', 'data-sigx-on:submit') !== null,
        'the PAT form is a resume boundary (carries the delegation submit QRL)');

    // 2) PAT sign-in through the real form (fixtures accepts any token). With
    // JS on this exercises the resume path: the delegation loader wakes the
    // boundary on submit and calls submitPat as RPC, which redirects.
    await page.fill('input[type=password]', 'anything');
    await page.click('button[type=submit]');
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });
    assert(true, 'PAT sign-in through the resume form redirects back to the dashboard');

    // 3) The dashboard renders REAL data (fixtures = recorded signalxjs org).
    await page.waitForSelector('[data-repo-grid]', { timeout: 10000 });
    // Repo cards are router Links into the board (Link doesn't forward
    // data-* attributes, so target the href shape).
    const cards = await page.locator('[data-repo-grid] a[href^="/b/"]').count();
    assert(cards >= 10, `repo grid shows the recorded repos (${cards})`);
    assert(await page.locator('[data-app-header]').textContent().then((t) => t.includes('pulse-dev')),
        'app header shows the signed-in user');

    // 4) SSR-first-paint: a fresh signed-in document CONTAINS the data — no
    // client fetch needed for first render (useData SSR transfer).
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === 'pulse_sid');
    assert(Boolean(sid), 'session cookie is set');
    const ssrDoc = await fetch(`${BASE}/`, {
        headers: { 'user-agent': UA, cookie: `pulse_sid=${encodeURIComponent(sid.value)}` }
    }).then((r) => r.text());
    assert(ssrDoc.includes('core') && ssrDoc.includes('open issues'), 'repo data is SSR-rendered into the document');
    assert(ssrDoc.includes('store:session'), 'session store slice transfers in the SSR blob');

    // 4b) Anti-FOUC (pulse#14 → pulse#39): Pulse is dark-only now, so the
    // pre-paint theming is one static inline background on <html> — no
    // daisyUI theme-resolution script may remain in the document.
    assert(/<html[^>]*style="[^"]*background:\s*#0c0d11/.test(ssrDoc),
        'the document ships the static dark background inline on <html> (never paints unthemed)');
    assert(!ssrDoc.includes('daisy-theme') && !ssrDoc.includes('data-theme'),
        'the daisyUI FOUC script and data-theme are gone (daisyUI retired)');

    // 4c) Board route (pulse#39): the signed-in planner shell SSRs with the
    // chrome, and the lazy route chunk is preloaded in the document head.
    const boardDoc = await fetch(`${BASE}/b/lumen/lumen`, {
        headers: { 'user-agent': UA, cookie: `pulse_sid=${encodeURIComponent(sid.value)}` }
    }).then((r) => r.text());
    assert(boardDoc.includes('data-board-root') && boardDoc.includes('data-board-sidebar'),
        'the board route SSRs the planner chrome (root + sidebar)');
    assert(boardDoc.includes('lumen/lumen') && boardDoc.includes('Planning workspace'),
        'board chrome carries the repo breadcrumb and brand');
    assert(/rel="modulepreload"[^>]*BoardPage/.test(boardDoc) || /BoardPage[^>]*rel="modulepreload"/.test(boardDoc),
        'the lazy BoardPage chunk is modulepreloaded in the board document (collectAssets wiring)');
    const badView = await fetch(`${BASE}/b/lumen/lumen/not-a-view`, {
        redirect: 'manual',
        headers: { 'user-agent': UA, cookie: `pulse_sid=${encodeURIComponent(sid.value)}` }
    });
    assert(badView.status === 404, 'an invalid :view answers a REAL 404');

    // 5) Client-side nav: /login → / through a real Link, URL changes with
    // ZERO document requests.
    await page.goto(`${BASE}/login`, { waitUntil: 'load' });
    let docRequests = 0;
    let fnRequests = 0;
    page.on('request', (r) => {
        if (r.resourceType() === 'document') docRequests++;
        if (r.url().includes('/_sigx/fn/')) fnRequests++;
    });
    await page.waitForSelector('text=go to the dashboard', { timeout: 10000 });
    await page.click('text=go to the dashboard');
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });
    await page.waitForSelector('[data-repo-grid]', { timeout: 10000 });
    assert(docRequests === 0, 'Link navigation to the dashboard stays client-side (URL changed, 0 document requests)');
    // The dashboard's data on a CLIENT-SIDE nav comes through the server-fn
    // stubs — the typed fetch swap the client build performs (pulse#34).
    assert(fnRequests >= 1, `client-side nav fetches data through the server-fn stubs (${fnRequests} calls)`);

    // 5b) Repo card → board: a real Link into the LAZY route, still zero
    // document requests (the chunk arrives as a script), and the design
    // tokens are actually applied (computed colors, not just class names).
    // An unconfigured repo now guards into the setup flow (pulse#40) — the
    // planner chrome stays up, the content area is the setup form.
    await page.click('[data-repo-grid] a[href^="/b/"]');
    await page.waitForSelector('[data-board-root]', { timeout: 10000 });
    assert(page.url().includes('/b/'), `repo card links into the board route (${page.url()})`);
    assert(docRequests === 0, 'the lazy board route loads client-side (0 document requests)');
    await page.waitForURL('**/setup', { timeout: 10000 });
    assert(true, 'an unconfigured board redirects into the setup flow');
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bodyBg === 'rgb(12, 13, 17)', `body paints bg0 (${bodyBg})`);
    const asideBg = await page.evaluate(() =>
        getComputedStyle(document.querySelector('[data-board-sidebar]')).backgroundColor);
    assert(asideBg === 'rgb(16, 17, 22)', `sidebar paints bg1 (${asideBg})`);
    const sansFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    assert(sansFont.includes('Hanken Grotesk'), `body uses the handoff UI font (${sansFont})`);

    // 5c) The setup flow end-to-end on the recorded lumen/lumen repo
    // (pulse#40): detection prefills the mapping form from the repo's
    // `status: *` / P0–P3 label conventions, Save stores the BoardConfig,
    // and the board comes back with REAL per-status column counts.
    await page.goto(`${BASE}/b/lumen/lumen`, { waitUntil: 'load' });
    await page.waitForURL('**/b/lumen/lumen/setup', { timeout: 10000 });
    await page.waitForSelector('[data-status-select="todo"]', { timeout: 10000 });
    const todoMapping = await page.inputValue('[data-status-select="todo"]');
    assert(todoMapping === 'status: todo', `detection prefills the Todo column mapping (${todoMapping})`);
    const p0Mapping = await page.inputValue('[data-priority-select="p0"]');
    assert(p0Mapping === 'P0', `detection prefills the P0 priority mapping (${p0Mapping})`);
    const milestoneNote = await page.locator('[data-milestone-count]').textContent();
    assert(milestoneNote.includes('5 milestones'), `the cycle toggle carries the milestone count (${milestoneNote.trim()})`);
    assert(await page.locator('[data-missing-label]').count() === 0,
        'lumen carries every convention label — nothing offered for creation');
    await page.click('[data-setup-save]');
    await page.waitForURL(`${BASE}/b/lumen/lumen`, { timeout: 10000 });
    // The board now derives real counts from the issue working set
    // (fixtures: 6 backlog / 4 todo / 4 in progress / 4 in review / 4 done).
    await page.waitForFunction(() =>
        document.querySelector('[data-column="todo"] [data-column-count]')?.textContent === '4',
    { timeout: 10000 });
    const countOf = (col) => page.locator(`[data-column="${col}"] [data-column-count]`).textContent();
    assert(await countOf('backlog') === '6', 'Backlog column counts the labeled fixtures issues');
    assert(await countOf('inprogress') === '4', 'In Progress column count is derived from status labels');
    assert(await countOf('done') === '4', 'Done column counts the closed fixtures issues');
    const sidebarText = await page.locator('[data-board-sidebar]').textContent();
    assert(sidebarText.includes('good first issue'), 'sidebar lists the repo tag labels (live boardLabels)');
    assert(sidebarText.includes('mira'), 'sidebar lists the team (live boardPeople)');

    // 5d) Board cards + drag-and-drop (pulse#51). Real cards render into
    // the columns, priority-sorted; a native HTML5 drag persists through
    // the moveIssue mutation (fixtures overlay), surviving a reload.
    await page.waitForSelector('[data-column="todo"] [data-card="511"]', { timeout: 10000 });
    assert(await page.locator('[data-column="todo"] [data-card]').count() === 4,
        'the Todo column renders its four cards');
    const firstTodo = await page.locator('[data-column="todo"] [data-card]').first().getAttribute('data-card');
    assert(firstTodo === '511', `cards sort P0-first inside the column (top of Todo is #511, got #${firstTodo})`);
    const card511 = await page.locator('[data-card="511"]').textContent();
    assert(card511.includes('Sanitize href scheme in Link component'), 'card #511 carries its title');
    assert(card511.includes('P0') && card511.includes('security') && card511.includes('bug'),
        'card #511 carries the P0 chip and its tag pills (mapped labels stay hidden)');
    const backlogCard = await page.locator('[data-column="backlog"] [data-card="503"]').textContent();
    assert(backlogCard.includes('Support RTL layout in Dialog'), 'backlog renders card #503');
    // The drag: #513 Todo → In Progress. Playwright performs a real HTML5
    // drag in Chromium; the optimistic mutate moves the card immediately
    // and moveIssue persists the label swap on the shared fixtures client.
    await page.dragAndDrop('[data-card="513"]', '[data-column="inprogress"] [data-drop-list]');
    await page.waitForSelector('[data-column="inprogress"] [data-card="513"]', { timeout: 10000 });
    assert(await countOf('todo') === '3' && await countOf('inprogress') === '5',
        'dragging #513 Todo → In Progress updates both column counts');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-column="inprogress"] [data-card="513"]', { timeout: 10000 });
    assert(await countOf('todo') === '3',
        'the move PERSISTED: a fresh document still shows #513 in In Progress');

    // 5e) List view (pulse#51): status-grouped rows under sticky headers.
    await page.goto(`${BASE}/b/lumen/lumen/list`, { waitUntil: 'load' });
    await page.waitForSelector('[data-list-view]', { timeout: 10000 });
    const listGroups = await page.locator('[data-list-group]').count();
    assert(listGroups >= 1 && listGroups <= 5,
        `the list view renders its non-empty status groups (${listGroups})`);
    assert(await page.locator('[data-list-group="todo"] [data-list-row="511"]').count() === 1,
        'row #511 sits in the Todo group');
    const headerPos = await page.evaluate(() =>
        getComputedStyle(document.querySelector('[data-list-group="todo"]').firstElementChild).position);
    assert(headerPos === 'sticky', `group headers are sticky over bg0 (${headerPos})`);

    // 5f) The live filter narrows BOTH views (query matches title or
    // #number; shared helper — asserted per-view here).
    await page.fill('[data-board-header] input', '#503');
    await page.waitForFunction(() => document.querySelectorAll('[data-list-row]').length === 1, { timeout: 10000 });
    assert(await page.locator('[data-list-row="503"]').count() === 1, 'query "#503" narrows the list to that row');
    await page.click('[data-board-sidebar] a[href="/b/lumen/lumen"]');
    await page.waitForSelector('[data-column="backlog"] [data-card="503"]', { timeout: 10000 });
    assert(await page.locator('[data-card]').count() === 1, 'the query carries into the board view (one card)');
    await page.fill('[data-board-header] input', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-card]').length > 1, { timeout: 10000 });

    // 5g) Roadmap view (pulse#53): one row per cycle over the rolling
    // 12-week window; bar labels count the working set (post-drag), the
    // issue-less v3.0 milestone renders as the narrow marker. Expected
    // numbers are DERIVED from the fixture json (see expectedViewNumbers).
    const expected = expectedViewNumbers();
    await page.goto(`${BASE}/b/lumen/lumen/roadmap`, { waitUntil: 'load' });
    await page.waitForSelector('[data-roadmap-view]', { timeout: 10000 });
    await page.waitForSelector('[data-roadmap-row]', { timeout: 10000 });
    assert(await page.locator('[data-roadmap-row]').count() === expected.cycleCount,
        `roadmap renders one row per lumen cycle (${expected.cycleCount})`);
    for (const c of expected.roadmap) {
        if (c.marker) {
            assert(await page.locator(`[data-roadmap-marker="${c.number}"]`).count() === (c.inWindow ? 1 : 0),
                `milestone ${c.number} renders as the narrow marker, never a bar${c.inWindow ? '' : ' (outside the window)'}`);
            assert(await page.locator(`[data-roadmap-bar="${c.number}"]`).count() === 0,
                `milestone ${c.number} renders no cycle bar`);
        } else if (c.inWindow) {
            const label = (await page.locator(`[data-roadmap-bar="${c.number}"]`).textContent()).trim();
            assert(label === c.label, `cycle ${c.number} bar reads its working-set label (${c.label}, got "${label}")`);
        } else {
            assert(await page.locator(`[data-roadmap-bar="${c.number}"]`).count() === 0,
                `cycle ${c.number} lies outside the window — no bar`);
        }
    }

    // 5h) Sprint view: current-cycle stats from the fixtures (post-drag:
    // #513 counts as in flight), lanes priority-sorted.
    await page.goto(`${BASE}/b/lumen/lumen/sprint`, { waitUntil: 'load' });
    await page.waitForSelector('[data-sprint-view]', { timeout: 10000 });
    const stat = (id) => page.locator(`[data-sprint-stat="${id}"]`).textContent();
    assert(await stat('scope') === String(expected.sprint.scope),
        `sprint scope counts the current cycle's issues (${expected.sprint.scope})`);
    assert(await stat('inflight') === String(expected.sprint.inFlight),
        `in flight = in progress + in review (${expected.sprint.inFlight}, includes the dragged #513)`);
    assert(await stat('completed') === String(expected.sprint.completed),
        `completed counts the done issues (${expected.sprint.completed})`);
    assert(await stat('notstarted') === String(expected.sprint.notStarted),
        `not started counts backlog + todo (${expected.sprint.notStarted})`);
    assert((await page.locator('[data-sprint-pct]').textContent()).trim() === `${expected.sprint.pct}% complete`,
        `the summary reads ${expected.sprint.pct}% complete`);
    assert((await page.locator('[data-sprint-days-left]').textContent()).includes('days left'),
        'the days-left pill renders');
    assert(await page.locator('[data-sprint-lane="focus"] [data-sprint-row]').count() === expected.sprint.inFlight,
        `the In focus lane lists every in-flight issue (${expected.sprint.inFlight})`);
    assert(await page.locator('[data-sprint-lane="next"] [data-sprint-row]').count() === expected.sprint.upNext,
        `the Up next lane lists the todo issues (${expected.sprint.upNext})`);
    const firstFocus = await page.locator('[data-sprint-lane="focus"] [data-sprint-row]').first()
        .getAttribute('data-sprint-row');
    assert(firstFocus === String(expected.sprint.firstFocus),
        `In focus sorts by priority (#${expected.sprint.firstFocus} first, got #${firstFocus})`);

    // 5i) Backlog view: flat unstarted list, priority-sorted, mono status
    // column.
    await page.goto(`${BASE}/b/lumen/lumen/backlog`, { waitUntil: 'load' });
    await page.waitForSelector('[data-backlog-view]', { timeout: 10000 });
    const backlogHeader = (await page.locator('[data-backlog-count]').textContent()).trim();
    assert(backlogHeader === `${expected.backlog.count} unstarted issues · sorted by priority`,
        `backlog header counts backlog+todo (${expected.backlog.count})`);
    assert(await page.locator('[data-backlog-row]').count() === expected.backlog.count,
        `backlog renders all ${expected.backlog.count} unstarted rows`);
    const firstBacklog = await page.locator('[data-backlog-row]').first().getAttribute('data-backlog-row');
    assert(firstBacklog === String(expected.backlog.first),
        `backlog sorts by priority (#${expected.backlog.first} first, got #${firstBacklog})`);
    const firstRowText = await page.locator(`[data-backlog-row="${firstBacklog}"]`).textContent();
    assert(firstRowText.includes('P0') && firstRowText.includes('Todo'),
        'the top backlog row carries its P0 chip and mono status name');

    // Setup revisited WITH a config: no redirect away, prefilled from it.
    await page.goto(`${BASE}/b/lumen/lumen/setup`, { waitUntil: 'load' });
    await page.waitForSelector('[data-status-select="done"]', { timeout: 10000 });
    assert(await page.inputValue('[data-status-select="done"]') === 'status: done',
        'revisiting setup prefills from the stored config');

    // Back to the dashboard for the sign-out flow below.
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForSelector('[data-repo-grid]', { timeout: 10000 });

    // 6) Sign out round-trip.
    await page.waitForSelector('text=Sign out', { timeout: 10000 });
    await page.click('text=Sign out');
    await page.waitForURL('**/login**', { timeout: 10000 });
    assert(true, 'sign out returns to /login');
    const afterLogout = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'user-agent': UA, cookie: `pulse_sid=${encodeURIComponent(sid.value)}` } });
    assert(afterLogout.status === 302, 'the old session cookie is dead server-side after logout');

    console.log(`pulse-smoke${CF ? ' (workerd)' : ''}: ALL PASSED`);
} finally {
    await browser?.close();
    // kill() throws ESRCH on an already-exited child (startup failure) —
    // never let teardown mask the real assertion error.
    const tryKill = (signal) => { try { server.kill(signal); } catch { /* already gone */ } };
    tryKill('SIGTERM');
    // wrangler shuts workerd down on SIGTERM — wait for it (bounded), then
    // force-kill, so a lingering child can never wedge CI.
    await new Promise((resolve) => {
        // Already dead (startup failure) → 'exit' has fired; resolve now
        // instead of eating the full grace timeout.
        if (server.exitCode !== null || server.signalCode !== null) {
            resolve();
            return;
        }
        const force = setTimeout(() => {
            tryKill('SIGKILL');
            resolve();
        }, 5000);
        server.once('exit', () => {
            clearTimeout(force);
            resolve();
        });
    });
}
process.exit(0);
