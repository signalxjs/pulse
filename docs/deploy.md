# Deploying Pulse to Cloudflare Workers

Pulse deploys continuously: every merge to `main` runs
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which
builds the workerd bundle (`pnpm --filter pulse-app build:cloudflare`),
applies pending D1 migrations, and then deploys the worker. This document is
the **one-time provisioning runbook** an operator follows before the first
deploy, plus notes on how the pipeline behaves and how to roll back.

Everything below runs from a checkout of this repo with dependencies
installed (`pnpm install`). `wrangler` is a dev dependency of `app/`, so run
it as `pnpm exec wrangler …` from the `app/` directory. Steps 1–4 need a
wrangler authenticated against the target Cloudflare account — `pnpm exec
wrangler login` (OAuth) is the simplest.

## 1. Create the D1 database

```sh
cd app
pnpm exec wrangler d1 create pulse
```

The command prints the new database's UUID. Paste it into
[`app/wrangler.jsonc`](../app/wrangler.jsonc) as
`d1_databases[0].database_id` and commit that change — the deploy workflow
reads the id from the checked-in config. (The current checked-in id is the
already-provisioned production database; repeat this step only when
provisioning a fresh environment.)

Local flows (`wrangler dev --local`, `d1 migrations apply --local`,
`pnpm smoke:cf`) never read `database_id`; they key local state off the
binding/name, so whatever id is committed stays inert for them.

## 2. Apply migrations to the remote database

```sh
cd app
pnpm exec wrangler d1 migrations apply pulse --remote
```

Applies every file in `app/migrations/` in file-name order and records them
in wrangler's `d1_migrations` table. The deploy workflow runs this same
command on every deploy, so after provisioning you never do it by hand again.

## 3. Set the worker secrets

`PULSE_SECRET` signs and encrypts sessions and is **required** — the worker
refuses to start without it. Use a fresh high-entropy value:

```sh
cd app
openssl rand -base64 32 | pnpm exec wrangler secret put PULSE_SECRET
```

(Or run `pnpm exec wrangler secret put PULSE_SECRET` and paste a value from
`openssl rand -base64 32`.)

**Optional — GitHub OAuth sign-in.** PAT-only sign-in works with no further
setup; skip this if that's enough. To offer "Sign in with GitHub":

1. Create a GitHub OAuth app (GitHub → Settings → Developer settings →
   OAuth Apps → *New OAuth App*) with:
   - Homepage URL: `https://<worker>.workers.dev`
   - Authorization callback URL:
     `https://<worker>.workers.dev/auth/callback`

   where `<worker>` is `pulse.<your-account-subdomain>` (the URL
   `wrangler deploy` prints). Use a **production-only** OAuth app — the dev
   one has a localhost callback.
2. Set the client id and secret on the worker:

   ```sh
   cd app
   pnpm exec wrangler secret put PULSE_OAUTH_CLIENT_ID
   pnpm exec wrangler secret put PULSE_OAUTH_CLIENT_SECRET
   ```

Both must be set for OAuth to be offered; setting only one logs a warning
and falls back to PAT-only.

## 4. First deploy (local, OAuth-authed wrangler)

The very first deploy is done locally so it runs under your interactive
`wrangler login` auth (and so you can verify before wiring up CI):

```sh
pnpm --filter pulse-app build:cloudflare
cd app
pnpm exec wrangler deploy
```

Then verify against the printed `workers.dev` URL: signed-out requests to
`/` 302 to the sign-in page, PAT sign-in works, and a board route renders
over the real D1 database.

## 5. GitHub Actions secrets (continuous deploy)

The workflow authenticates with an API token, not your OAuth login. In the
Cloudflare dashboard (My Profile → API Tokens → *Create Token*), start from
the **Edit Cloudflare Workers** template and set the permissions to:

- **Workers Scripts: Edit**
- **D1: Edit**
- **Account Settings: Read**

scoped to the target account. Then, in the GitHub repo
(Settings → Secrets and variables → Actions), add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token created above |
| `CLOUDFLARE_ACCOUNT_ID` | the account id (dashboard → Workers & Pages overview, right column) |

The account id deliberately lives only in this secret — `wrangler.jsonc`
has no `account_id`, so local dev and CI can't target the wrong account by
accident.

The job runs in the `production` GitHub environment; if you want approval
gates or extra protection rules, configure them on that environment.

## How the pipeline behaves

- **Trigger:** every push to `main` (i.e. every merged PR), plus manual
  `workflow_dispatch` runs from the Actions tab.
- **Order:** build → `d1 migrations apply pulse --remote` → `wrangler
  deploy`. Migrations land first, so there is a window where the *old*
  worker runs against the *new* schema. That is safe because migrations
  are **additive-only** (new tables/columns/indexes; never dropping or
  renaming what the live code reads) — keep that rule when adding files to
  `app/migrations/` (see the `@pulse/db` notes in `AGENTS.md`).
- **Serialization:** the `deploy-production` concurrency group with
  `cancel-in-progress: false` means deploys queue instead of racing or
  being killed between the migrate and deploy steps.

## Rollback

- **Worker only** (bad code, schema unchanged):
  `cd app && pnpm exec wrangler rollback` reverts to the previous worker
  version.
- **Redeploy a known-good commit:** revert (or fix-forward) on `main` and
  let the pipeline run, or trigger `workflow_dispatch` on the deploy
  workflow from a commit already on `main`.
- Migrations are additive-only and are **not** rolled back; a bad migration
  is fixed by a follow-up migration.
