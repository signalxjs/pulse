import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { sigxServer } from '@sigx/vite/server';
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
    '@sigx/server-renderer': pkg('@sigx/server-renderer')
};

export default defineConfig(({ command }) => ({
    // sigxServer(): *.server.ts modules become fetch stubs in the client
    // build, the SSR build emits the fn registry (dist/server/
    // sigx-server-fns.js), and dev gets the /_sigx/fn endpoint middleware.
    plugins: [sigx({ ssr: { entry: 'src/entry-server.tsx' } }), sigxServer(), tailwindcss()],
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    ...(command === 'serve' && {
        resolve: { alias: devAliases },
        ssr: { noExternal: ['sigx', '@sigx/server-renderer', '@sigx/router', '@sigx/store'] }
    })
}));
