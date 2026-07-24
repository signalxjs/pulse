# Pulse × SignalX — stress-test findings

Pulse doubles as the SignalX "prove it at scale" program (Stage 1). This is
the running findings log: every framework gap hit while building a real app
on the PUBLISHED packages, with the issue/PR it produced. Rules of
engagement (pulse#1): R1 framework bug → issue + fix PR on the owning repo;
R2 missing product → build in `packages/`, propose graduation; R3
ergonomics/docs gap → issue on owning repo; R4 deliberate-design validation
→ measured evidence here, RFC only if the evidence demands.

Verdict section is written at the M3 gate.

## Findings log

### F1 — 0.11.0 release is partial on npm (R1 · core#300)
Setting up against published packages, day one: core five at 0.11.0 but
`@sigx/cache`/`@sigx/vite` still 0.10.0, and `@sigx/resume` **never
published at all** (the known OIDC first-publish gotcha). Pulse pins the
coherent 0.10 matrix (core 0.10 / router 0.8 / store 0.8 / daisyui 0.8) —
exactly what any real user must figure out today. Router/store peer-cap at
`<0.11.0` means the ecosystem can't follow a core release until an
alignment wave; the matrix is fragile without a lockstep-release story.

### F2 — @sigx/cache@0.10.0 uninstallable: `workspace:^` in the published manifest (R1 · core#301)
`npm view @sigx/cache@0.10.0 dependencies` →
`{ '@sigx/reactivity': 'workspace:^', ... }`; any out-of-workspace install
fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. Worked around with
documented `pnpm.overrides`. Suggested: publish-time guard asserting no
`workspace:` specifiers survive packing.
**Resolved in the 0.12 wave:** `@sigx/cache@0.12.0` publishes correct
`^0.12.0` specifiers (`npm view @sigx/cache@0.12.0 dependencies`), so the
`pnpm.overrides` block is gone as of the core-0.12 upgrade (pulse#18).
`pnpm why -r @sigx/reactivity` confirms a single 0.12.0 copy. (The tracking
issue core#301 stays open for the publish-guard follow-up, but the broken
artifact no longer exists on npm.)

### F3 — root `'/'` loses to a `'/*rest'` catch-all (R1 · router#58)
First page load rendered the 404 page. A literal path must outrank a
wildcard for the same URL; it does for every path EXCEPT the zero-segment
root. Worked around by dropping the catch-all route and branching on
`useRoute().matched.length === 0` in the shell. Fix PR to follow against
matcher scoring.
**Resolved in @sigx/router 0.9.0:** the literal `'/'` now outranks the
wildcard for the root URL. As of the core-0.12 upgrade (pulse#18) the real
`'/*rest'` catch-all route is restored and the shell renders `<RouterView />`
directly; verified at runtime — `/` still resolves the home route (302 →
`/login` when signed out) while an unknown path renders NotFound with HTTP
404.

### F4 — Link/RouterLink drops `class`/`style` (R1 · router#30, pre-existing)
Confirmed immediately by the daisyui navbar: `<Link class="btn btn-ghost">`
renders `<a>` with only the active-classes, custom class gone. Every
styled app hits this on its first component.

### F5 — RouterView SSR singleton warning on every request (R1 · router#53, OPEN)
Dev server logs core's injectable-singleton warning per request. With Pulse's
own tokens now named/required (see F6), the residual per-request noise is
RouterView's internal `depth` injectable, which has no per-app provider — the
app can't fix it. Tracked upstream as router#53 ("provide depth per app so
core 0.10's SSR-leak warning doesn't fire on every SSR'd RouterView");
confirmed still reproducing on the 0.10.0 matrix.

### F6 — core's singleton-injectable warning didn't say WHICH injectable (R3 · RESOLVED, core#213 in 0.10.0)
`[sigx] Injectable "sigx:injectable" resolved to a module-global singleton…`
— the token's debug name was the generic default, so the warning couldn't be
traced without grepping. Fixed upstream by core#213 (PR #215, shipped in
sigx 0.10.0): factory-form tokens now carry `Symbol(factory.name)`, and a new
required form `defineInjectable<T>('Name')` throws a named `SIGX202` on a
lookup miss instead of silently minting a process-global singleton shared
across SSR requests. Pulse adopted it (pulse#16): `usePulseApi` is now the
required `defineInjectable<PulseApi>('PulseApi')`, and `useRequestUser` uses a
named factory. The warning the fix added is exactly the one we now see —
proving 0.10.0 carries it.

### F7 — dev-mode `resolve.alias` boilerplate for pnpm layouts (R3 · to file)
A fresh app on pnpm needs the ~16-line `devAliases` map (copied from
core's spa-ssr example) pinning every `@sigx/*` subpath, or the dev-server
module runner resolves duplicate copies of the reactivity engine. End
users should not need to know this — candidate fixes: `sigxPlugin()`
injects the map itself in serve mode, or a `create @sigx` SSR template
carries it.

### F8 — dev handler drops `req` from the app factory (R1 · RESOLVED, core#304 in @sigx/vite 0.13.0)
`createRequestHandler` (prod) supports `app: (url, req)` so SSR can read
the session cookie; `createDevRequestHandler` invoked `factory(url)` —
auth'd apps rendered signed-out in dev. Pulse bridged the session through
AsyncLocalStorage in dev (exactly the pattern rfc-ssr-platform §2.3
promises apps never need). Fixed in @sigx/vite 0.13.0: the dev handler now
calls `factory(url, devReq, platform)`, matching both prod handlers. Pulse
dropped the bridge (pulse#24); note the residual asymmetry — dev forwards
the raw `IncomingMessage` where our prod handler passes a resolved context,
so the factory normalizes both shapes (`ctx` vs a request carrying
`req.pulseCtx`).

### F9 — template .gitignore blanket `*.js`/`*.d.ts` drops source files (R3 · repo-template#22)
Bit twice: `env.d.ts` (CSS-module ambient declaration) silently untracked
→ local-green/CI-red; then an entire JSDoc-typed server package's `src/*.js`
missing from a PR. Negations must be placed AFTER the blanket patterns.

### F10 — ssrState silently no-ops for stores first created outside component resolution (R3 · store#63)
The auth guard resolved the session store before the render; the store's
`ssrState` needs `instance.ssr._ctx` (a component being resolved) and
silently skipped registration — the client hydrated signed-OUT with no
warning. Pattern that works (now in Pulse): pre-render consumers (guards)
read request state via a DI injectable; the store is first touched in the
root component's setup, where the transfer can register. The store should
dev-warn in the no-instance server case. Update: store 0.11.0 (store#71)
ships exactly that dev-warning and its changelog documents Pulse's pattern
as the recommended shape for request state — the workaround graduated into
the blessed pattern. Pulse is on 0.11.0 as of pulse#24.

### F11 — @sigx/daisyui ThemeProvider has no SSR story → theme FOUC (R3 · daisyui#51 · closed for Pulse by pulse#39)
`ThemeProvider` sets `data-theme` client-side only (its setup is guarded by
`typeof document !== 'undefined'`), so under SSR it renders a bare `<div>`
and never themes the document. Every full document load paints daisyUI's
default (light) first, then flips to the real theme on hydration — a visible
flash of unthemed content, most obvious right after sign-in (a full-page
`window.location` redirect renders the signed-in dashboard, which flashes
white before going dark). Pulse#14 works around it with a blocking `<head>`
script that resolves the theme before first paint — but to match what
`ThemeProvider` computes on hydration the app has to duplicate daisyUI
internals (the `daisy-theme` storage key, the `prefers-color-scheme`
fallback order, the default theme name). Suggested upstream: export an
SSR-safe theme-init snippet apps can inline, or let ThemeProvider emit
`data-theme` server-side from a cookie.
**Closed out for Pulse (pulse#39, product decision):** the design handoff made
Pulse dark-only with a bespoke token system, so daisyUI (and ThemeProvider)
retired from the app entirely — the anti-FOUC story collapsed to one static
inline `background:#0c0d11` on `<html>`. The upstream gap (daisyui#51) still
stands for apps that keep ThemeProvider.

### F12 — no `@sigx/daisyui` release for core 0.12 (R1 · to file on daisyui · closed for Pulse by pulse#39)
The core-0.12 upgrade (pulse#18) took core→0.12.0, router→0.9.0,
store→0.9.0, but `@sigx/daisyui` tops out at 0.8.0, whose peers cap at
`>=0.10.0 <0.11.0`. Installing against core 0.12 leaves an unmet-peer
warning on every `pnpm install`. It is only a warning — pnpm still binds
daisyui to the single 0.12.0 copy the app provides, `ThemeProvider` renders
and hydrates fine, and `pnpm why -r @sigx/reactivity` shows one 0.12.0 — so
the app runs, but the ecosystem again can't follow a core release without a
daisyui alignment bump (same lockstep-release gap as F1). Pulse holds
daisyui at 0.8.0 until a 0.12-compatible release ships.
**Closed out for Pulse (pulse#39, product decision):** daisyUI retired from
Pulse with the bespoke design-system PR — the dependency (and the unmet-peer
warning) is gone. The lockstep-release gap remains a daisyui-repo concern.

### F13 — serverFn platform adoption: ambient SSR context held in both modes (R4 · validated, no issue)
The risk-gate question of pulse#34 — does an in-process SSR call resolve
`rq.request` from the ambient scope the document handlers open (rfc-server
§7, core#309) — answers YES in BOTH modes, first try, no fallback needed:

- **Dev** (`node server.mjs`, Vite middleware + `createDevRequestHandler`):
  PAT sign-in → `GET /` with the cookie SSR-renders the fixture repo names
  into the document — `withAuth` read the session cookie off `rq.request`
  during the in-process `viewerRepos()`/`viewerOrgs()` calls. The seam
  crosses the module-runner/Node graph split because both halves ride
  `globalThis` (`__SIGX_SERVERFN_SCOPE__` / `__SIGX_SERVERFN_CONTEXT__`),
  and `sigxServer()` eagerly `ssrLoadModule`s `@sigx/server/node` at
  startup, so the scope is stamped before the first render.
- **Prod** (`vite build --app` + `--conditions production`): same probe,
  same result — `createRequestHandler` opens the scope around the whole
  render, `createServerFnHandler` mounts beside it.

DX notes from the adoption:
- The whole client-side wiring is ZERO config: no `serverPlugin`, no
  transport setup — stubs default to same-origin `/_sigx/fn`, and
  `useData(fn)` keys the cell on the build-stamped stable id, so the SSR
  transfer joins on hydration exactly like the string-keyed form did.
  Replacing the hand-built PulseApi injectable (+ fetch wrapper + Express
  proxy, ~160 lines) with two `serverFn` declarations is the trade the RFC
  promised.
- Registry wiring in prod is two lines: import
  `dist/server/sigx-server-fns.js`, pass its `serverFns` to
  `createServerFnHandler({ functions })`. The chunk is emitted by
  `sigxServer()` with dual keys (content-hashed + stable
  `pulse-app/src/server/repos.server.ts#<name>`); the smoke probes the
  STABLE symbol so it never chases content hashes. Dev needs no mount at
  all — `vite.middlewares` carries the endpoint.
- `ServerFnError(401)` passes the wire verbatim; a thrown `GitHubApiError`
  is masked to the generic 500 envelope in production, as specified — the
  proxy's per-status error mapping (429 rate-limit etc.) is GONE with the
  proxy, so surfacing rate-limit specifics to the client now needs an
  explicit rethrow as `ServerFnError` (fine; deliberate channel).
- Minor bridge: `@pulse/auth`'s `getSession` is structural over
  `{ headers: { cookie } }`, while `rq.request.headers` is a WinterCG
  `Headers` — one `headers.get('cookie')` adapter line in `withAuth`.
- One semantic change to hold: the old proxy's tokenless fallback
  (fixtures / `GITHUB_TOKEN` env) served unauthenticated requests; the
  `withAuth` chain requires a session on every transport, so the smoke's
  "tokenless API" assertion became "unauthenticated fn call answers 401".

### F14 — @sigx/cloudflare adoption: full app on workerd first try; entry hand-written, scaffold unused (R4 · validated, no issue)
Pulse's Cloudflare target (pulse#42) — auth + D1 sessions + serverFns +
streaming documents under real workerd via `wrangler dev --local` — passed
the ENTIRE node smoke assertion set on the first complete run. Adoption
notes on the adapter itself:

- **Scaffold vs hand-written**: the adapter's scaffold-iff-absent posture
  worked as designed — we wrote `src/entry.cloudflare.ts` and
  `wrangler.jsonc` by hand BEFORE the first build (Pulse needs D1 +
  per-isolate service init the scaffold can't know about), and the adapter
  never touched either; its `generate()` drift checks (main / assets dir /
  html_handling substrings) all passed silently. The validate-don't-write
  behavior on an existing config is exactly right for a real app.
- **`collectAssets` is node-locked** (hit at pulse#39's rebase): the worker
  entry needs per-route chunk preloads, and `virtual:sigx-app` helpfully
  exports the client `manifest` — but the traversal helper that turns it
  into preload lists, `collectAssets`, is only exported from
  `@sigx/vite/ssr`, whose module top-level imports `node:fs/promises` and
  `node:path`. Under the workerd-conditioned bundle that graph cannot
  resolve, so Pulse carries a WinterCG port (`app/src/collect-assets.ts`).
  The helper is pure — upstream should export it from a platform-clean
  module (candidate core issue).
- **The `html_handling` gotcha never fired** — but only because the
  starter-config comment chain flows into rfc-deploy and the examples;
  copying the resume example's `"none"` from day one meant the raw outlet
  index.html was never served for `GET /`. The adapter's warn-if-absent
  check is the right guard for people who write the config cold.
- **Virtual-module ergonomics are good**: `virtual:sigx-app` (template +
  assets, inlined from the client build) + `virtual:sigx-server-fns`
  replace the node server's four runtime `readFile`/`import` calls with two
  imports. Cost: the TYPES for both modules are copy-pasted ambient
  declarations from the example's `env.d.ts` (`app/src/env.cloudflare.d.ts`
  here) — `@sigx/vite` could ship them as a referenceable `.d.ts`
  (`/// <reference types="@sigx/vite/virtual" />`-style) instead of asking
  every app to re-declare them. Candidate ergonomics issue on core.
- **Per-isolate init is the one real divergence from node**: server.mjs
  builds services at boot; a worker only sees `env` on a fetch, so
  `__PULSE_SERVER__` is built lazily on the first fetch and cached
  (bindings are stable per isolate). The `services.server.ts` accessor
  needed ZERO changes — `globalThis` really is the seam that survives both
  module graphs, as F13 predicted ("a worker entry sets the same global
  from its env").
- **Migrations split cleanly**: `wrangler d1 migrations apply` and
  `packages/db`'s runner share the `d1_migrations` tracking schema (a
  deliberate day-one choice), so the worker never applies migrations at
  runtime and the two runners agree on what's applied.
- **`wrangler dev --local` tolerates a placeholder `database_id`** —
  local D1 state keys off the binding, so the committed config can carry
  `"TBD-provisioned-in-deploy-pr"` until a deploy PR runs
  `wrangler d1 create`. CI needs `onlyBuiltDependencies: [esbuild, workerd]`
  in `pnpm-workspace.yaml` (pnpm 10 blocks their install scripts, and
  workerd without its postinstall has no binary).
- Bundle shape: the ssr build emits the worker as `entry.cloudflare.js`
  plus one shared `assets/sigx-*.js` chunk (not strictly single-file);
  wrangler dev follows the relative import fine. One benign
  `INEFFECTIVE_DYNAMIC_IMPORT` warning — the fn registry dynamically
  imports `repos.server.ts`, which the Dashboard also imports statically.

## Working notes

- The router-SSR contract (core docs/router-ssr-contract.md) held on first
  contact: async `createApp(url)` + `createMemoryHistory({ initialLocation })`
  + `await router.isReady()` + `useResponse().status(404)` from a page all
  worked as specified, streaming SSR + hydration + client-side nav verified
  in a real browser. Pulse is the first app to implement the contract with
  the real `@sigx/router` (core's spa-ssr example hand-rolls a toy router).
- Contract §3 (guard-driven redirects) also held: the auth guard returns a
  `/login?returnTo=…` location, `route.redirectedFrom` surfaces it, and
  `useResponse().redirect()` turns it into a real HTTP 302 — verified in
  both server modes.
- @sigx/store's `ssrState()` transfer + guard-in-app-context DI both worked
  exactly as documented (the guard resolves the session store before its
  first await, per the router README's async-guard rule).
