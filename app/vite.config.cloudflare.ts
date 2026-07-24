// The Cloudflare build (rfc-deploy §4.2): same app, same plugins — the
// adapter swaps the server build from externalized-Node to a fully bundled
// workerd-conditioned worker. Separate outDirs so `dist/` (node) and
// `dist-cf/` (worker) coexist from one checkout:
//
//     pnpm build:cloudflare   →  vite build --app -c vite.config.cloudflare.ts
//     pnpm smoke:cf           →  the same Playwright smoke over wrangler dev
//
// No dev aliases and no ssr.noExternal here on purpose: those exist for the
// DEV server's module runner (vite.config.ts documents why); the bundled
// worker build is one module graph by construction.
import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { sigxServer } from '@sigx/vite/server';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@sigx/cloudflare';

export default defineConfig({
    plugins: [
        sigx({
            ssr: {
                entry: 'src/entry-server.tsx',
                clientOutDir: 'dist-cf/client',
                serverOutDir: 'dist-cf/server',
                adapter: cloudflare()
            }
        }),
        sigxServer(),
        tailwindcss()
    ],
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    }
});
