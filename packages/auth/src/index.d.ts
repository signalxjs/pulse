/**
 * @pulse/auth — typed surface. Implementation is JSDoc-typed ESM (it runs
 * under the no-transpiler `app/server.mjs`).
 */
import type { Router, Request } from 'express';
import type { GitHubClient, GitHubUser } from '@pulse/github';

export interface SessionUser extends GitHubUser {}

export interface Session {
    sid: string;
    user: SessionUser;
    /** Decrypted GitHub token for this user (never leaves the server). */
    token: string;
}

export interface SessionStore {
    create(user: SessionUser, token: string): string;
    get(sid: string): Session | null;
    destroy(sid: string): void;
}

/** node:sqlite-backed session store; tokens encrypted at rest (AES-256-GCM). */
export function createSessionStore(options: { dbPath?: string; secret: string }): SessionStore;

export interface AuthRouterOptions {
    sessions: SessionStore;
    secret: string;
    /** Fixtures mode: PAT sign-in accepts anything and grants the fixtures viewer. */
    fixtures: boolean;
    /** Build a GitHub client for a candidate token (PAT validation, OAuth viewer fetch). */
    makeClient(token: string): GitHubClient;
    /** GitHub OAuth app credentials; omit to run PAT-only. */
    oauth?: { clientId: string; clientSecret: string };
    /** OAuth token exchange fetch override (tests). */
    fetch?: typeof fetch;
}

/**
 * Express router: GET /login (OAuth redirect), GET /callback (code
 * exchange), POST /pat (PAT sign-in), POST /logout. Mount under /auth.
 */
export function createAuthRouter(options: AuthRouterOptions): Router;

/** Resolve the request's session from the signed cookie, or null. */
export function getSession(req: Request | { headers: { cookie?: string } }, sessions: SessionStore, secret: string): Session | null;
