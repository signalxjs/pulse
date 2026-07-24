/**
 * WinterCG-clean port of `collectAssets` from `@sigx/vite/ssr` — same
 * traversal, same output shape. The worker entry needs it to compute
 * per-route chunk preloads from the `manifest` that `virtual:sigx-app`
 * exports, but the upstream helper lives in a module that imports
 * `node:fs`/`node:path` at top level, which the workerd-conditioned bundle
 * cannot resolve (findings F14: the pure helper should live in a
 * platform-clean module upstream). `server.mjs` (node) keeps importing the
 * original; if the upstream signature changes, the typecheck on this port
 * flags it.
 */

interface ManifestChunk {
    file: string;
    css?: string[];
    imports?: string[];
    isEntry?: boolean;
}

export type ViteManifest = Record<string, ManifestChunk>;

export interface CollectedAssets {
    modulepreload: string[];
    stylesheets: string[];
}

export function collectAssets(manifest: ViteManifest, entries: string[], base = '/'): CollectedAssets {
    const modulepreload: string[] = [];
    const stylesheets: string[] = [];
    const seenChunks = new Set<string>();
    const seenUrls = new Set<string>();
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const push = (list: string[], file: string) => {
        const url = prefix + file;
        if (seenUrls.has(url)) return;
        seenUrls.add(url);
        list.push(url);
    };
    const visit = (id: string) => {
        if (seenChunks.has(id)) return;
        seenChunks.add(id);
        const chunk = manifest[id];
        if (!chunk) return;
        push(modulepreload, chunk.file);
        for (const css of chunk.css ?? []) push(stylesheets, css);
        for (const dep of chunk.imports ?? []) visit(dep);
    };
    for (const entry of entries) visit(entry);
    return { modulepreload, stylesheets };
}
