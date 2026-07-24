/**
 * @vitest-environment node
 *
 * The extracted PAT sign-in primitive (pulse#57) — the shared path behind
 * both the `/auth/pat` JSON route and the `form: true` `submitPat` server
 * function. Driven directly (no HTTP), so the token→viewer→session→cookie
 * behaviour is pinned once, independent of either transport.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { createSessionStore, signInWithPat, SignInError, getSession, type SessionStore } from '@pulse/auth';
import { createSqliteDb } from '@pulse/db/sqlite';
import { applyMigrations } from '@pulse/db/migrate';
import { SESSION_COOKIE } from '../src/cookies.js';

const USER = { login: 'octo', name: null, avatarUrl: 'https://a/u' };
const SECRET = 'test-secret';

/** A GitHub-client factory whose viewer() resolves, or throws a chosen status. */
function client(viewer: () => Promise<typeof USER>) {
    return (() => ({ viewer })) as unknown as Parameters<typeof signInWithPat>[0]['makeClient'];
}
const ok = client(async () => USER);

let sessions: SessionStore;

beforeAll(async () => {
    const db = createSqliteDb();
    await applyMigrations(db, join(process.cwd(), 'app', 'migrations'));
    sessions = createSessionStore({ db, secret: SECRET });
});

describe('signInWithPat', () => {
    it('signs in with a valid token and returns a session cookie + user', async () => {
        const { cookie, user } = await signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: 'ghp_abc'
        });
        expect(user.login).toBe('octo');
        expect(cookie).toContain(SESSION_COOKIE);
        // The cookie resolves to a real stored session carrying the raw token.
        expect((await getSession(cookie.split(';')[0], sessions, SECRET))?.token).toBe('ghp_abc');
    });

    it('trims the token before use', async () => {
        const { cookie } = await signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: '  ghp_padded  '
        });
        expect((await getSession(cookie.split(';')[0], sessions, SECRET))?.token).toBe('ghp_padded');
    });

    it('throws a 400 SignInError on an empty token outside fixtures mode', async () => {
        await expect(signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: '   '
        })).rejects.toMatchObject({ status: 400 });
        await expect(signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: ''
        })).rejects.toBeInstanceOf(SignInError);
    });

    it('fixtures mode signs in tokenless and never stores the raw input', async () => {
        const { cookie } = await signInWithPat({
            sessions, secret: SECRET, fixtures: true, makeClient: ok, token: 'ignored'
        });
        expect((await getSession(cookie.split(';')[0], sessions, SECRET))?.token).toBe('fixtures');
    });

    it('maps a 401 from the viewer fetch to a 401 SignInError (invalid token)', async () => {
        const unauthorized = client(async () => { throw Object.assign(new Error('nope'), { status: 401 }); });
        await expect(signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: unauthorized, token: 'ghp_bad'
        })).rejects.toMatchObject({ status: 401, message: 'invalid token' });
    });

    it('maps any other viewer error to a 502 SignInError', async () => {
        const boom = client(async () => { throw new Error('network down'); });
        await expect(signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: boom, token: 'ghp_x'
        })).rejects.toMatchObject({ status: 502, message: 'sign-in failed' });
    });

    it('sets the Secure attribute only when secureCookies is enabled', async () => {
        const insecure = await signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: 'ghp_1'
        });
        expect(insecure.cookie).not.toContain('Secure');
        const secure = await signInWithPat({
            sessions, secret: SECRET, fixtures: false, makeClient: ok, token: 'ghp_2', secureCookies: true
        });
        expect(secure.cookie).toContain('; Secure');
    });
});
