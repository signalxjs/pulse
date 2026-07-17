import { defineApp } from 'sigx';
import { cachePlugin } from '@sigx/cache';
import { ssrClientPlugin } from '@sigx/server-renderer/client';
import { App } from './App';
import { createClientRouter } from './routes';
import './styles.css';

// One app + router for the page, initialised from the current URL so the
// first client render matches the server's HTML.
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
