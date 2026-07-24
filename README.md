<div align="center">

# ● Pulse

**Linear-style planning on top of GitHub — boards, issues, and milestones over the repos you already have. Built on [SignalX](https://sigx.dev).**

</div>

Pulse is a real application and, deliberately, SignalX's scale proving
ground: it wires the WHOLE published stack together — `sigx` core, streaming
SSR (`@sigx/server-renderer`), `@sigx/router` (per core's router-SSR
contract), `@sigx/store`, and `@sigx/cache` — against the GitHub API.
(`@sigx/daisyui` was part of the mix through M1; pulse#39 retired it for a
bespoke dark design system, per the design handoff.) Every framework gap it uncovers is filed on the owning repo and
logged in [`docs/findings.md`](docs/findings.md).

## Layout

| Path | What |
|---|---|
| `app/` | the Pulse application (SSR entries, routes, pages, Express server) |
| `packages/github` | GitHub API client — `live` + `fixtures` adapters, ETag cache (M1) |
| `packages/auth` | GitHub OAuth + PAT sessions (M1) |
| `packages/db` | async SQL seam — `node:sqlite` + Cloudflare D1 drivers, migrations, board-config store (M2) |
| `packages/forms` | Standard-Schema form state (M2) |
| `docs/findings.md` | the running stress-test findings report |

## Develop

```bash
pnpm install
pnpm dev          # Vite middleware + SSR on :4823
pnpm build        # client + server bundles (vite build --app)
pnpm start        # production server over the built output
pnpm typecheck && pnpm lint && pnpm test
```

Requires Node ≥ 24 (`node:sqlite`, via `@pulse/db`, backs sessions and the
ETag cache; schema comes from `app/migrations`).

> Dependency note: `@sigx/*` is consumed at PUBLISHED versions on the
> coherent 0.10 matrix (core 0.10 / router 0.8 / store 0.8 / daisyui 0.8) —
> core 0.11 shipped partially (core#300) and `@sigx/cache@0.10.0` needs a
> pnpm override (core#301). Real-installation friction is part of this
> repo's job.
