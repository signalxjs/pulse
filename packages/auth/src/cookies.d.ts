/** Typed surface for the cookie internals (deep-imported by tests). */
export const SESSION_COOKIE: string;
export const STATE_COOKIE: string;
export function sign(value: string, secret: string): Promise<string>;
export function verify(signed: string | undefined, secret: string): Promise<string | null>;
export function readCookie(source: string | null | undefined | { headers: { cookie?: string } }, name: string): string | undefined;
export function cookieHeader(name: string, value: string, opts?: { maxAge?: number; clear?: boolean; secure?: boolean }): string;
