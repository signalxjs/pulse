import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { sigxServer } from '@sigx/vite/server';
import { sigxResume } from '@sigx/vite/resume';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string, sub = 'dist/index.js') =>
    resolve(__dirname, 'node_modules', name, sub);

// DEV ONLY: pin every @sigx/* package and its subpaths to one canonical
// location in this app's node_modules — pnpm's symlinked layout can
// otherwise make the dev-server module runner resolve multiple copies of
// the reactivity engine (single-copy is a hard requirement). The map must
// NOT apply to builds: the orchestrated SSR build externalizes the @sigx
// family from the server bundle so it shares one module graph with the
// production request handler. (Pattern from core's examples/spa-ssr —
// candidate ergonomics finding: apps should not need to know this.)
const devAliases = {
    'sigx/jsx-runtime': pkg('sigx', 'dist/sigx.js'),
    'sigx/jsx-dev-runtime': pkg('sigx', 'dist/sigx.js'),
    'sigx/internals': pkg('sigx', 'dist/internals.js'),
    'sigx': pkg('sigx', 'dist/sigx.js'),
    '@sigx/runtime-core/internals': pkg('@sigx/runtime-core', 'dist/internals.js'),
    '@sigx/runtime-core': pkg('@sigx/runtime-core'),
    '@sigx/runtime-dom/platform': pkg('@sigx/runtime-dom', 'dist/platform.js'),
    '@sigx/runtime-dom/internals': pkg('@sigx/runtime-dom', 'dist/internals.js'),
    '@sigx/runtime-dom': pkg('@sigx/runtime-dom'),
    '@sigx/reactivity/internals': pkg('@sigx/reactivity', 'dist/internals.js'),
    '@sigx/reactivity': pkg('@sigx/reactivity'),
    '@sigx/server-renderer/server': pkg('@sigx/server-renderer', 'dist/server/index.js'),
    '@sigx/server-renderer/client': pkg('@sigx/server-renderer', 'dist/client/index.js'),
    '@sigx/server-renderer/node': pkg('@sigx/server-renderer', 'dist/node.js'),
    '@sigx/server-renderer': pkg('@sigx/server-renderer'),
    // Resume: server half rides the entry-server app factory; the client
    // half (delegation loader + QRL runtime) lazy-loads on first
    // interaction. Same single-copy pin as the rest of the @sigx family.
    '@sigx/resume/server': pkg('@sigx/resume', 'dist/server/index.js'),
    '@sigx/resume/client': pkg('@sigx/resume', 'dist/client/index.js'),
    '@sigx/resume/loader': pkg('@sigx/resume', 'dist/loader/index.js'),
    '@sigx/resume': pkg('@sigx/resume', 'dist/index.js')
};

export default defineConfig(({ command }) => ({
    // sigxServer(): *.server.ts modules become fetch stubs in the client
    // build, the SSR build emits the fn registry (dist/server/
    // sigx-server-fns.js), and dev gets the /_sigx/fn endpoint middleware.
    // sigxResume(): extracts resume-module (`*.resume.tsx`) event handlers
    // into lazily-imported QRL chunks and stamps their components with
    // `__resumeId` — inert for every non-resume component (the board renders
    // and hydrates exactly as before). Sibling to sigxServer(), after sigx().
    plugins: [sigx({ ssr: { entry: 'src/entry-server.tsx' } }), sigxResume(), sigxServer(), tailwindcss()],
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    ...(command === 'serve' && {
        resolve: { alias: devAliases },
        ssr: { noExternal: ['sigx', '@sigx/server-renderer', '@sigx/resume', '@sigx/router', '@sigx/store'] }
    })
}));
