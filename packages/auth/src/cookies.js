/**
 * Signed-cookie helpers — HMAC-SHA256 over the value, base64url, constant
 * time verification. HttpOnly + SameSite=Lax always; Secure outside dev.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'pulse_sid';
export const STATE_COOKIE = 'pulse_oauth';

/**
 * @param {string} value
 * @param {string} secret
 */
export function sign(value, secret) {
    const mac = createHmac('sha256', secret).update(value).digest('base64url');
    return `${value}.${mac}`;
}

/**
 * @param {string | undefined} signed
 * @param {string} secret
 * @returns {string | null}
 */
export function verify(signed, secret) {
    if (!signed) return null;
    const dot = signed.lastIndexOf('.');
    if (dot <= 0) return null;
    const value = signed.slice(0, dot);
    const mac = Buffer.from(signed.slice(dot + 1));
    const expected = Buffer.from(createHmac('sha256', secret).update(value).digest('base64url'));
    if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
    return value;
}

/**
 * @param {{ headers: { cookie?: string } }} req
 * @param {string} name
 */
export function readCookie(req, name) {
    const header = req.headers.cookie;
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
 * @param {{ maxAge?: number, clear?: boolean }} [opts]
 */
export function cookieHeader(name, value, opts = {}) {
    // Secure in production — except when explicitly opted out for plain-http
    // localhost (CI smokes, local prod testing): a Secure cookie over http
    // is silently dropped by every client.
    const secure = process.env.NODE_ENV === 'production' && process.env.PULSE_INSECURE_COOKIES !== '1'
        ? '; Secure'
        : '';
    const maxAge = opts.clear ? 0 : (opts.maxAge ?? 60 * 60 * 24 * 30);
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}
