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

### F11 — @sigx/daisyui ThemeProvider has no SSR story → theme FOUC (R3 · daisyui#51)
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

### F12 — no `@sigx/daisyui` release for core 0.12 (R1 · to file on daisyui)
The core-0.12 upgrade (pulse#18) took core→0.12.0, router→0.9.0,
store→0.9.0, but `@sigx/daisyui` tops out at 0.8.0, whose peers cap at
`>=0.10.0 <0.11.0`. Installing against core 0.12 leaves an unmet-peer
warning on every `pnpm install`. It is only a warning — pnpm still binds
daisyui to the single 0.12.0 copy the app provides, `ThemeProvider` renders
and hydrates fine, and `pnpm why -r @sigx/reactivity` shows one 0.12.0 — so
the app runs, but the ecosystem again can't follow a core release without a
daisyui alignment bump (same lockstep-release gap as F1). Pulse holds
daisyui at 0.8.0 until a 0.12-compatible release ships.

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
