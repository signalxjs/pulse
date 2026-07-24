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
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CF = process.argv.includes('--cf');
// Distinct default ports so a node smoke and a cf smoke never collide.
const PORT = Number(process.env.PORT) || (CF ? 4181 : 4180);
const BASE = `http://localhost:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));

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

    // 2) PAT sign-in through the real form (fixtures accepts any token).
    await page.fill('input[type=password]', 'anything');
    await page.click('button[type=submit]');
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });
    assert(true, 'PAT sign-in redirects back to the dashboard');

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
    await page.click('[data-repo-grid] a[href^="/b/"]');
    await page.waitForSelector('[data-board-root]', { timeout: 10000 });
    assert(page.url().includes('/b/'), `repo card links into the board route (${page.url()})`);
    assert(docRequests === 0, 'the lazy board route loads client-side (0 document requests)');
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bodyBg === 'rgb(12, 13, 17)', `body paints bg0 (${bodyBg})`);
    const asideBg = await page.evaluate(() =>
        getComputedStyle(document.querySelector('[data-board-sidebar]')).backgroundColor);
    assert(asideBg === 'rgb(16, 17, 22)', `sidebar paints bg1 (${asideBg})`);
    const sansFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    assert(sansFont.includes('Hanken Grotesk'), `body uses the handoff UI font (${sansFont})`);
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
