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

### F3 — root `'/'` loses to a `'/*rest'` catch-all (R1 · router#58)
First page load rendered the 404 page. A literal path must outrank a
wildcard for the same URL; it does for every path EXCEPT the zero-segment
root. Worked around by dropping the catch-all route and branching on
`useRoute().matched.length === 0` in the shell. Fix PR to follow against
matcher scoring.

### F4 — Link/RouterLink drops `class`/`style` (R1 · router#30, pre-existing)
Confirmed immediately by the daisyui navbar: `<Link class="btn btn-ghost">`
renders `<a>` with only the active-classes, custom class gone. Every
styled app hits this on its first component.

### F5 — RouterView SSR singleton warning on every request (R1 · router#53, pre-existing)
Dev server logs the core injectable-singleton warning per request. Noise
aside, the warning itself has a DX gap (F6).

### F6 — core's singleton-injectable warning doesn't say WHICH injectable (R3 · to file)
`[sigx] Injectable "sigx:injectable" resolved to a module-global
singleton…` — the token's debug name is the generic default, so the
warning can't be traced to a package without grepping. Injectable tokens
should carry (and the warning should print) their declared name.

### F7 — dev-mode `resolve.alias` boilerplate for pnpm layouts (R3 · to file)
A fresh app on pnpm needs the ~16-line `devAliases` map (copied from
core's spa-ssr example) pinning every `@sigx/*` subpath, or the dev-server
module runner resolves duplicate copies of the reactivity engine. End
users should not need to know this — candidate fixes: `sigxPlugin()`
injects the map itself in serve mode, or a `create @sigx` SSR template
carries it.

### F8 — dev handler drops `req` from the app factory (R1 · core#304)
`createRequestHandler` (prod) supports `app: (url, req)` so SSR can read
the session cookie; `createDevRequestHandler` invokes `factory(url)` —
auth'd apps render signed-out in dev. Pulse bridges the session through
AsyncLocalStorage in dev (exactly the pattern rfc-ssr-platform §2.3
promises apps never need). Drop the bridge when the @sigx/vite fix ships.

### F9 — template .gitignore blanket `*.js`/`*.d.ts` drops source files (R3 · repo-template#22)
Bit twice: `env.d.ts` (CSS-module ambient declaration) silently untracked
→ local-green/CI-red; then an entire JSDoc-typed server package's `src/*.js`
missing from a PR. Negations must be placed AFTER the blanket patterns.

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
