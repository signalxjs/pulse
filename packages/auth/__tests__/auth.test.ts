/**
 * @pulse/auth — session storage (encryption at rest), signed cookies, and
 * the request→session resolution path the proxy and SSR entries rely on.
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore, getSession } from '@pulse/auth';
import { sign, verify, cookieHeader, SESSION_COOKIE } from '../src/cookies.js';

const USER = { login: 'octo', name: 'Octo Cat', avatarUrl: 'https://a/u' };

describe('session store', () => {
    it('round-trips a session with the token encrypted at rest', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const path = join(tmpdir(), `pulse-auth-atrest-${process.pid}.db`);
        const sessions = createSessionStore({ dbPath: path, secret: 's3cret' });
        const sid = sessions.create(USER, 'ghp_supersecret');

        const session = sessions.get(sid);
        expect(session?.user).toEqual(USER);
        expect(session?.token).toBe('ghp_supersecret');

        // REAL at-rest check: read the raw row — the stored token_enc must
        // not contain the plaintext token.
        const raw = new DatabaseSync(path);
        const row = raw.prepare('SELECT token_enc FROM sessions WHERE sid = ?').get(sid) as { token_enc: string };
        expect(row.token_enc).not.toContain('ghp_supersecret');
        expect(row.token_enc.length).toBeGreaterThan(20);
        raw.close();
    });

    it('destroy() invalidates the sid', () => {
        const sessions = createSessionStore({ secret: 's3cret' });
        const sid = sessions.create(USER, 't');
        sessions.destroy(sid);
        expect(sessions.get(sid)).toBeNull();
    });

    it('expired sessions are dead server-side', () => {
        const sessions = createSessionStore({ secret: 's3cret', ttlMs: -1 });
        const sid = sessions.create(USER, 't');
        expect(sessions.get(sid)).toBeNull();
    });

    it('an undecryptable row is an invalid session, not a throw', () => {
        // Same DB file, different secret — simulates secret rotation.
        const path = join(tmpdir(), `pulse-auth-test-${process.pid}.db`);
        const first = createSessionStore({ dbPath: path, secret: 'old' });
        const sid = first.create(USER, 'tok');
        const rotated = createSessionStore({ dbPath: path, secret: 'new' });
        expect(rotated.get(sid)).toBeNull();
    });

    it('requires a secret', () => {
        expect(() => createSessionStore({ secret: '' })).toThrow(/secret/);
    });
});

describe('signed cookies', () => {
    it('verify() accepts its own signature and rejects tampering', () => {
        const signed = sign('abc-123', 'k');
        expect(verify(signed, 'k')).toBe('abc-123');
        expect(verify(signed + 'x', 'k')).toBeNull();
        expect(verify('abc-124.' + signed.split('.')[1], 'k')).toBeNull();
        expect(verify(signed, 'other-key')).toBeNull();
        expect(verify(undefined, 'k')).toBeNull();
    });

    it('malformed percent-encoding reads as an absent cookie, not a throw', async () => {
        const { readCookie } = await import('../src/cookies.js');
        const req = { headers: { cookie: 'pulse_sid=%E0%A4' } };
        expect(readCookie(req, 'pulse_sid')).toBeUndefined();
    });

    it('cookieHeader is HttpOnly + SameSite=Lax and clearable', () => {
        const header = cookieHeader('a', 'b');
        expect(header).toContain('HttpOnly');
        expect(header).toContain('SameSite=Lax');
        expect(cookieHeader('a', '', { clear: true })).toContain('Max-Age=0');
    });
});

describe('getSession', () => {
    it('resolves a signed cookie to the stored session', () => {
        const secret = 'k';
        const sessions = createSessionStore({ secret });
        const sid = sessions.create(USER, 'tok');
        const req = { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sign(sid, secret))}` } };
        expect(getSession(req, sessions, secret)?.user.login).toBe('octo');
    });

    it('rejects unsigned or forged sids', () => {
        const secret = 'k';
        const sessions = createSessionStore({ secret });
        const sid = sessions.create(USER, 'tok');
        expect(getSession({ headers: { cookie: `${SESSION_COOKIE}=${sid}` } }, sessions, secret)).toBeNull();
        expect(getSession({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sign(sid, 'wrong'))}` } }, sessions, secret)).toBeNull();
        expect(getSession({ headers: {} }, sessions, secret)).toBeNull();
    });
});
