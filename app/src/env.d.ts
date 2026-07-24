/// <reference types="vite/client" />

// Explicit so the ROOT typecheck (which doesn't load vite/client's ambient
// types through app/tsconfig) accepts the entries' side-effect CSS import.
declare module '*.css' {}

// The generated resume delegation-loader bootstrap (side effects only),
// provided by sigxResume() — the client entry's only resume import.
declare module 'virtual:sigx-resume/entry';

// The pack manifests for the entry-server's app factory (resume#413):
// resolved in every build mode, `undefined` under dev (resume runs
// manifest-less there). Only resumeManifest is used here.
declare module 'virtual:sigx-manifests' {
    import type { ResumeManifest } from '@sigx/resume';
    export const resumeManifest: ResumeManifest | undefined;
}
