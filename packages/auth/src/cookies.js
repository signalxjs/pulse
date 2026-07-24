/**
 * Signed-cookie helpers — HMAC-SHA256 over the value via WebCrypto
 * (`crypto.subtle`), base64url signature, constant-time verification
 * through `subtle.verify`. Wire format: `<value>.<base64url mac>`.
 * The HMAC key is HKDF-derived from the secret (info 'pulse-cookie-hmac')
 * and cached per secret. HttpOnly + SameSite=Lax always; Secure is the
 * caller's decision (`secure` option) — no env sniffing in this package.
 */
import { deriveKey, toBase64Url, fromBase64Url } from './crypto.js';

export const SESSION_COOKIE = 'pulse_sid';
export const STATE_COOKIE = 'pulse_oauth';

const enc = new TextEncoder();

/** @type {Map<string, Promise<CryptoKey>>} */
const hmacKeys = new Map();

/** @param {string} secret */
function hmacKey(secret) {
    let key = hmacKeys.get(secret);
    if (!key) {
        key = deriveKey(secret, 'pulse-cookie-hmac', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign', 'verify']);
        hmacKeys.set(secret, key);
    }
    return key;
}

/**
 * @param {string} value
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function sign(value, secret) {
    const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(value));
    return `${value}.${toBase64Url(new Uint8Array(mac))}`;
}

/**
 * @param {string | undefined} signed
 * @param {string} secret
 * @returns {Promise<string | null>}
 */
export async function verify(signed, secret) {
    if (!signed) return null;
    const dot = signed.lastIndexOf('.');
    if (dot <= 0) return null;
    const value = signed.slice(0, dot);
    let mac;
    try {
        mac = fromBase64Url(signed.slice(dot + 1));
    } catch {
        // Malformed base64 = no signature, never a 500.
        return null;
    }
    // subtle.verify is the spec's constant-time comparison — never compare
    // MACs with === (and Cloudflare's subtle.timingSafeEqual is non-standard).
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac, enc.encode(value));
    return ok ? value : null;
}

/**
 * @param {string | null | undefined | { headers: { cookie?: string } }} source
 *   Raw `cookie` header value (WinterCG: `request.headers.get('cookie')`) or
 *   a structural request ({ headers: { cookie } } — Express, SSR entries).
 * @param {string} name
 */
export function readCookie(source, name) {
    const header = typeof source === 'string' ? source : source?.headers?.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) {
            try {
                return decodeURIComponent(part.slice(eq + 1).trim());
            } catch {
                // Malformed percent-encoding = no cookie, never a 500.
                return undefined;
            }
        }
    }
    return undefined;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge?: number, clear?: boolean, secure?: boolean }} [opts]
 */
export function cookieHeader(name, value, opts = {}) {
    // Secure is the caller's decision (server.mjs computes it from its
    // environment): a Secure cookie over plain http is silently dropped by
    // every client, so plain-http localhost (CI smokes, local prod
    // testing) must be able to opt out.
    const secure = opts.secure ? '; Secure' : '';
    const maxAge = opts.clear ? 0 : (opts.maxAge ?? 60 * 60 * 24 * 30);
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}
