/**
 * Internal WebCrypto helpers — HKDF-SHA256 key derivation from the app
 * secret, plus Buffer-free base64 codecs. Pure `globalThis.crypto`
 * (Node ≥ 20, Cloudflare Workers, browsers) — no `node:crypto` anywhere.
 *
 * Why HKDF and not scrypt/PBKDF2: PULSE_SECRET is a high-entropy server
 * secret, not a human password, so KDF hardness buys nothing (and scrypt
 * doesn't exist in WebCrypto; PBKDF2 hits Workers' iteration cap). HKDF
 * expands the one secret into independent per-purpose keys via `info`.
 */

const enc = new TextEncoder();

/**
 * Fixed application salt — domain-separates Pulse's HKDF output from any
 * other system that might derive keys from the same secret.
 */
const APP_SALT = enc.encode('pulse-auth-hkdf-v1');

/**
 * Derive a per-purpose key from the app secret. Callers cache the promise
 * (derivation is cheap but not free — once per store/secret is plenty).
 *
 * @param {string} secret
 * @param {string} info - per-purpose label, e.g. 'pulse-cookie-hmac' or 'pulse-session-tokens'
 * @param {HmacKeyGenParams | AesKeyGenParams} algorithm
 * @param {KeyUsage[]} usages
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(secret, info, algorithm, usages) {
    const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: APP_SALT, info: enc.encode(info) },
        material,
        algorithm,
        false,
        usages
    );
}

// base64 codecs without Buffer — btoa/atob are globals on Node ≥ 16,
// Workers, and browsers alike.

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

/**
 * @param {string} text
 * @returns {Uint8Array} — throws on malformed input (callers catch)
 */
export function fromBase64(text) {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** @param {Uint8Array} bytes */
export function toBase64Url(bytes) {
    return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} text
 * @returns {Uint8Array} — throws on malformed input (callers catch)
 */
export function fromBase64Url(text) {
    return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));
}
