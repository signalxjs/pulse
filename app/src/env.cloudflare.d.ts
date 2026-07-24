// Ambient declarations for the Cloudflare entry's build-time virtual
// modules (rfc-deploy §3.2) — resolved by sigx({ ssr }) in the ssr
// environment of the BUNDLED build (vite.config.cloudflare.ts); they throw
// under dev, where the dev handler solves template/assets live. Kept in
// their own file (not env.d.ts) so the node-path type surface is untouched.

// Build-emitted document artifacts: the client build's index.html template
// and the entry's asset preloads, inlined into the worker bundle.
declare module 'virtual:sigx-app' {
    import type { CollectedAssets, ViteManifest } from '@sigx/vite/ssr';
    export const template: string;
    export const assets: CollectedAssets;
    export const manifest: ViteManifest;
}

// The server-fn registry (symbol → lazy import of the wrapped fn) —
// explicitly passed to handleServerFnRequest, never ambient.
declare module 'virtual:sigx-server-fns' {
    export const serverFns: Record<string, () => Promise<unknown>>;
}
