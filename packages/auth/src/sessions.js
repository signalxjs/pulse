/**
 * Session storage — node:sqlite, GitHub tokens encrypted at rest with
 * AES-256-GCM (key derived from PULSE_SECRET via scrypt). Session ids are
 * random UUIDs; the cookie layer (cookies.js) signs them so a forged sid
 * never reaches the table.
 */
import { DatabaseSync } from 'node:sqlite';
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
 * @param {{ dbPath?: string, secret: string }} options
 * @returns {import('./index.js').SessionStore}
 */
export function createSessionStore(options) {
    if (!options?.secret) {
        throw new Error('createSessionStore: a secret is required (set PULSE_SECRET)');
    }
    const key = deriveKey(options.secret);
    const db = new DatabaseSync(options.dbPath ?? ':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            token_enc TEXT NOT NULL,
            login TEXT NOT NULL,
            name TEXT,
            avatar_url TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    const insert = db.prepare('INSERT INTO sessions (sid, token_enc, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const select = db.prepare('SELECT * FROM sessions WHERE sid = ?');
    const remove = db.prepare('DELETE FROM sessions WHERE sid = ?');

    return {
        create(user, token) {
            const sid = randomUUID();
            insert.run(sid, encrypt(key, token), user.login, user.name, user.avatarUrl, Date.now());
            return sid;
        },
        get(sid) {
            const row = /** @type {any} */ (select.get(sid));
            if (!row) return null;
            return {
                sid,
                user: { login: row.login, name: row.name ?? null, avatarUrl: row.avatar_url },
                token: decrypt(key, row.token_enc)
            };
        },
        destroy(sid) {
            remove.run(sid);
        }
    };
}
