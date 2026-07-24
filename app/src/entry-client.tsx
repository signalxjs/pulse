import { defineApp } from 'sigx';
import { cachePlugin } from '@sigx/cache';
import { ssrClientPlugin } from '@sigx/server-renderer/client';
import { App } from './App';
import { createClientRouter } from './routes';
import './styles.css';
// The resume delegation loader (pulse#57 coexist mode): one capture-phase
// document listener per resume event, wiring nothing until the first
// interaction with a resume boundary (our `*.resume.tsx` login form). The
// normal 'auto' hydration walk below hydrates the shell and SKIPS those
// boundaries (`hydrate: 'never'`, set by the SERVER resume plugin); this
// loader wakes them on first interaction.
//
// Deliberately NOT `app.use(resumePlugin())` here: the client half of the
// resume pack calls `provideHydrateDefaults({ boundaries: 'explicit' })`,
// which turns OFF the root walk so ONLY boundary-table entries hydrate —
// the islands/app-less posture. In THIS app that would leave the whole
// shell (sign-out, router Links) dead. Coexist keeps the 'auto' walk; the
// server plugin's `hydrate: 'never'` boundaries + this loader are all the
// client needs. See docs/findings.md F16.
import 'virtual:sigx-resume/entry';

// One app + router for the page, initialised from the current URL so the
// first client render matches the server's HTML. Data needs no client-side
// wiring: server-fn imports arrive as typed fetch stubs (default transport,
// same-origin /_sigx/fn) — there is no api provide anymore.
const app = defineApp(<App />);
app.use(cachePlugin());
const router = createClientRouter();
app.use(router);

async function start() {
    // Settle the initial navigation (guards + any lazy route components)
    // BEFORE the hydration walk — server-rendered content must hydrate
    // against the real matched component (router-SSR contract §2).
    await router.isReady();
    app.use(ssrClientPlugin).hydrate!('#app');
}

void start();
