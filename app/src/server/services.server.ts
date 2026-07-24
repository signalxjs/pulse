/**
 * The server-side service registry — what server functions reach for at
 * request time. `server.mjs` builds these once at boot (db, migrations,
 * session store, GitHub adapter wiring) and publishes them on
 * `globalThis.__PULSE_SERVER__`; this module is the TYPED accessor over
 * that global. A global rather than DI on purpose: server functions run
 * outside any sigx app context (dev: Vite's module runner; prod: the
 * registry chunk), and `globalThis` is the one seam every module graph
 * shares — the same posture as @sigx/server's own `__SIGX_SERVERFN_*`
 * seams. A worker entry (M-later) sets the same global from its env.
 */
import type { SessionStore } from '@pulse/auth';
import type { ConfigStore } from '@pulse/db';
import type { EtagCache, GitHubClient } from '@pulse/github';

export interface PulseServerServices {
    /** Session store over the app db (signed-cookie sessions). */
    sessions: SessionStore;
    /** Per-repo board configuration over the app db (board_config table). */
    configStore: ConfigStore;
    /** Shared conditional-request cache; null in fixtures mode. */
    etagCache: EtagCache | null;
    /**
     * GitHub client for one token — live client over the shared ETag cache,
     * or the process-shared fixtures client (which ignores the token).
     */
    makeGitHubClient(token: string): GitHubClient;
    /** Explicit fixtures mode (PULSE_FIXTURES=1) — tokenless, deterministic. */
    fixtures: boolean;
    /** The cookie-signing / token-encryption secret. */
    secret: string;
    /**
     * Whether issued cookies carry the Secure attribute — the caller's
     * decision (prod, unless the plain-http localhost opt-out). The
     * `form: true` sign-in server function reads it to mint the session
     * cookie exactly as the `/auth` handler does.
     */
    secureCookies: boolean;
}

declare global {
    // `var` is the form that stamps the type onto globalThis.
    // eslint-disable-next-line no-var
    var __PULSE_SERVER__: PulseServerServices | undefined;
}

/** The boot-time services, or throw — a miss is a wiring bug, not a state. */
export function services(): PulseServerServices {
    const s = globalThis.__PULSE_SERVER__;
    if (!s) {
        throw new Error(
            '[pulse] server services are not initialised — server.mjs sets ' +
            'globalThis.__PULSE_SERVER__ at boot, before any request is served.'
        );
    }
    return s;
}
