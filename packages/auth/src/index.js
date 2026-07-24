/**
 * @pulse/auth — GitHub sign-in for Pulse: OAuth web flow with CSRF state,
 * PAT fallback for dev, sessions over the PulseDb seam (@pulse/db) with
 * tokens encrypted at rest, signed HttpOnly cookies. Server-only,
 * JSDoc-typed ESM (runs under the no-transpiler `app/server.mjs`); types
 * in `index.d.ts`.
 */

export { createSessionStore } from './sessions.js';
export { createAuthHandler, getSession } from './handler.js';
export { SESSION_COOKIE } from './cookies.js';
