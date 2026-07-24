/// <reference types="vite/client" />

// Explicit so the ROOT typecheck (which doesn't load vite/client's ambient
// types through app/tsconfig) accepts the entries' side-effect CSS import.
declare module '*.css' {}
