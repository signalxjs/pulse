/**
 * Session storage — over the PulseDb seam (@pulse/db), GitHub tokens
 * encrypted at rest with AES-256-GCM (key derived from PULSE_SECRET via
 * scrypt). Session ids are random UUIDs; the cookie layer (cookies.js)
 * signs them so a forged sid never reaches the table. The `sessions` table
 * comes from the shared migrations (`app/migrations`) — apply them before
 * constructing the store; there is no inline DDL here.
 */
import { randomUUID, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

/** @param {string} secret */
function deriveKey(secret) {
    return scryptSync(secret, 'pulse-session-tokens', 32);
}

/**
 * @param {Buffer} key
 * @param {string} plaintext
 */
function encrypt(key, plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * @param {Buffer} key
 * @param {string} payload
 */
function decrypt(key, payload) {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

/**
 * Default server-side TTL — matches the session cookie's default Max-Age
 * (30 days). Overriding ttlMs changes only the SERVER cutoff; the cookie
 * keeps its own Max-Age, and whichever expires first wins.
 */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param {{ db: import('@pulse/db').PulseDb, secret: string, ttlMs?: number }} options
 * @returns {import('./index.js').SessionStore}
 */
export function createSessionStore(options) {
    if (!options?.secret) {
        throw new Error('createSessionStore: a secret is required (set PULSE_SECRET)');
    }
    if (!options.db) {
        throw new Error('createSessionStore: a PulseDb is required (create one and apply the app migrations first)');
    }
    const key = deriveKey(options.secret);
    const db = options.db;
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

    return {
        async create(user, token) {
            // Sweep on write, not just on expired reads — sign-in-and-forget
            // rows must age out even if their sid never comes back.
            await db.run('DELETE FROM sessions WHERE created_at < ?', Date.now() - ttlMs);
            const sid = randomUUID();
            await db.run(
                'INSERT INTO sessions (sid, token_enc, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                sid, encrypt(key, token), user.login, user.name, user.avatarUrl, Date.now()
            );
            return sid;
        },
        async get(sid) {
            const row = /** @type {any} */ (await db.first('SELECT * FROM sessions WHERE sid = ?', sid));
            if (!row) return null;
            // Server-side TTL: a replayed signed cookie dies with the row —
            // the cookie's Max-Age alone is client-enforced only. Expiry
            // also sweeps other stale rows so the table can't grow without
            // bound under sign-in-and-forget usage.
            if (Date.now() - row.created_at > ttlMs) {
                await db.run('DELETE FROM sessions WHERE created_at < ?', Date.now() - ttlMs);
                return null;
            }
            let token;
            try {
                token = decrypt(key, row.token_enc);
            } catch {
                // Corrupt row or rotated secret: an undecryptable session is
                // an invalid session, never a 500. Drop the row.
                await db.run('DELETE FROM sessions WHERE sid = ?', sid);
                return null;
            }
            return {
                sid,
                user: { login: row.login, name: row.name ?? null, avatarUrl: row.avatar_url },
                token
            };
        },
        async destroy(sid) {
            await db.run('DELETE FROM sessions WHERE sid = ?', sid);
        }
    };
}
