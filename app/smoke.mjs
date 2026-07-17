// Pulse browser smoke — the M1 gate (pulse#1), fixture mode (tokenless,
// deterministic). Requires a prior prod build:
//
//   pnpm build && pnpm smoke
//
// Real-Chrome UA throughout: HeadlessChrome matches the isBot regex and
// would get the blocking document instead of the streaming human path.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT) || 4180;
const BASE = `http://localhost:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function assert(cond, message) {
    if (!cond) {
        throw new Error(`❌ pulse-smoke: ${message}`);
    }
    console.log(`✔ ${message}`);
}

async function waitForServer(url, timeoutMs = 15000) {
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

const server = spawn(
    process.execPath,
    ['--conditions', 'production', 'server.mjs'],
    {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
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

let browser;
try {
    await waitForServer(`${BASE}/`);

    // ---- HTTP-level contract (no browser) ----
    const signedOut = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'user-agent': UA } });
    assert(signedOut.status === 302, 'signed-out / answers a REAL 302');
    assert(signedOut.headers.get('location') === '/login?returnTo=%2F', 'redirect target carries returnTo');
    const missing = await fetch(`${BASE}/definitely-not-a-page`, { headers: { 'user-agent': UA } });
    assert(missing.status === 404, 'unknown routes answer a REAL 404');
    const apiNoAuth = await fetch(`${BASE}/api/github/viewer`);
    assert(apiNoAuth.ok, 'fixtures mode serves the API tokenless');

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
    const cards = await page.locator('[data-repo-grid] .card').count();
    assert(cards >= 10, `repo grid shows the recorded repos (${cards})`);
    assert(await page.locator('.navbar').textContent().then((t) => t.includes('pulse-dev')),
        'navbar shows the signed-in user');

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

    // 5) Client-side nav still works signed in (login page shows signed-in state).
    let docRequests = 0;
    page.on('request', (r) => { if (r.resourceType() === 'document') docRequests++; });
    await page.click('.navbar a[href="/"]');
    await page.waitForTimeout(300);
    assert(docRequests === 0, 'navbar navigation stays client-side');

    // 6) Sign out round-trip.
    await page.click('text=Sign out');
    await page.waitForURL('**/login**', { timeout: 10000 });
    assert(true, 'sign out returns to /login');
    const afterLogout = await fetch(`${BASE}/`, { redirect: 'manual', headers: { 'user-agent': UA, cookie: `pulse_sid=${encodeURIComponent(sid.value)}` } });
    assert(afterLogout.status === 302, 'the old session cookie is dead server-side after logout');

    console.log('pulse-smoke: ALL PASSED');
} finally {
    await browser?.close();
    server.kill('SIGTERM');
}
process.exit(0);
