/**
 * Session storage — over the PulseDb seam (@pulse/db), GitHub tokens
 * encrypted at rest with AES-256-GCM via WebCrypto (key HKDF-derived from
 * PULSE_SECRET, info 'pulse-session-tokens'; derived once per store, the
 * promise is cached). Session ids are random UUIDs; the cookie layer
 * (cookies.js) signs them so a forged sid never reaches the table. The
 * `sessions` table comes from the shared migrations (`app/migrations`) —
 * apply them before constructing the store; there is no inline DDL here.
 *
 * token_enc format: `base64(iv) + '.' + base64(ciphertext‖tag)` — a
 * 12-byte random IV, then the AES-GCM ciphertext with WebCrypto's
 * appended 16-byte auth tag. Any blob that doesn't decrypt (old scrypt
 * format, rotated secret, corruption) reads as an invalid session: the
 * row is dropped and the user signs in again — never a 500.
 */
import { deriveKey, toBase64, fromBase64 } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * @param {Promise<CryptoKey>} key
 * @param {string} plaintext
 */
async function encrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key, enc.encode(plaintext));
    return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`;
}

/**
 * @param {Promise<CryptoKey>} key
 * @param {string} payload
 * @returns {Promise<string>} — rejects on any malformed/undecryptable blob (callers catch)
 */
async function decrypt(key, payload) {
    const dot = payload.indexOf('.');
    if (dot <= 0) throw new Error('malformed token blob');
    const iv = fromBase64(payload.slice(0, dot));
    const ct = fromBase64(payload.slice(dot + 1));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key, ct);
    return dec.decode(pt);
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
    // Lazy, once per store: the first encrypt/decrypt kicks off derivation
    // and everything else awaits the same promise.
    /** @type {Promise<CryptoKey> | null} */
    let keyPromise = null;
    const key = () => keyPromise ??= deriveKey(
        options.secret, 'pulse-session-tokens', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']
    );
    const db = options.db;
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

    return {
        async create(user, token) {
            // Sweep on write, not just on expired reads — sign-in-and-forget
            // rows must age out even if their sid never comes back.
            await db.run('DELETE FROM sessions WHERE created_at < ?', Date.now() - ttlMs);
            const sid = crypto.randomUUID();
            await db.run(
                'INSERT INTO sessions (sid, token_enc, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                sid, await encrypt(key(), token), user.login, user.name, user.avatarUrl, Date.now()
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
                token = await decrypt(key(), row.token_enc);
            } catch {
                // Corrupt row, old blob format, or rotated secret: an
                // undecryptable session is an invalid session, never a 500.
                // Drop the row.
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
