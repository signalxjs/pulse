/// <reference types="vite/client" />

// Explicit so the ROOT typecheck (which doesn't load vite/client's ambient
// types through app/tsconfig) accepts the entries' side-effect CSS import.
declare module '*.css' {}

// Dev-only bridge: createDevRequestHandler drops the app factory's second
// argument (core#304), so server.mjs exposes the request context through
// AsyncLocalStorage behind this global. Remove with the core fix.
// eslint-disable-next-line no-var
declare var __PULSE_DEV_CTX__: (() => import('./entry-server').RequestContext | null) | undefined;
