import { defineInjectable } from 'sigx';
import type { SessionUser } from './session';

export interface PulseRepo {
    owner: string;
    name: string;
    fullName: string;
    description: string | null;
    private: boolean;
    openIssues: number;
    updatedAt: string;
}

export interface PulseOrg {
    login: string;
    avatarUrl: string;
    description: string | null;
}

/**
 * The data seam: ONE interface, provided per environment. The server
 * provides a direct GitHub-client wrapper (per-request token, ETag cache);
 * the client provides fetch('/api/github/…') wrappers. Components only ever
 * see this — useData fetchers stay isomorphic.
 */
export interface PulseApi {
    viewer(): Promise<SessionUser>;
    viewerOrgs(): Promise<PulseOrg[]>;
    viewerRepos(): Promise<PulseRepo[]>;
    ownerRepos(owner: string): Promise<PulseRepo[]>;
    repo(owner: string, name: string): Promise<PulseRepo | null>;
}

export const usePulseApi = defineInjectable<PulseApi>(() => {
    throw new Error('usePulseApi() called without a provider — each entry provides its environment implementation.');
});

/** The client-side implementation: same-origin /api/github endpoints. */
export class PulseApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'PulseApiError';
    }
}

export function createFetchApi(): PulseApi {
    async function call<T>(path: string): Promise<T> {
        const res = await fetch(`/api/github${path}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new PulseApiError(body.error ?? `request failed (${res.status})`, res.status);
        }
        return res.json() as Promise<T>;
    }
    return {
        viewer: () => call('/viewer'),
        viewerOrgs: () => call('/viewer/orgs'),
        viewerRepos: () => call('/viewer/repos'),
        ownerRepos: (owner) => call(`/owners/${encodeURIComponent(owner)}/repos`),
        repo: async (owner, name) => {
            try {
                return await call(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
            } catch (err) {
                // Not-found is a VALUE; auth/server/network failures throw.
                if (err instanceof PulseApiError && err.status === 404) return null;
                throw err;
            }
        }
    };
}
