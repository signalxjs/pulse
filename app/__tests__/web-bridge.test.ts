/**
 * @vitest-environment node
 *
 * The Express ↔ WinterCG bridge over a real listener: request translation
 * (method, url, headers, buffered body), response write-back (status,
 * multiple set-cookie headers, body), and the null → next() fall-through.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
// @ts-expect-error — plain .mjs module, typed only by inference
import { mountFetchHandler } from '../server/web-bridge.mjs';

let server: Server;
let base: string;

const handler = async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/auth/echo') {
        const headers = new Headers({ 'content-type': 'application/json' });
        headers.append('set-cookie', 'a=1; Path=/');
        headers.append('set-cookie', 'b=2; Path=/');
        return new Response(JSON.stringify({
            body: await request.text(),
            cookie: request.headers.get('cookie'),
            url: url.pathname + url.search
        }), { status: 201, headers });
    }
    return null;
};

beforeAll(async () => {
    const app = express();
    mountFetchHandler(app, '/auth', handler);
    // What the bridge's next() lands on — proves fall-through works.
    app.use((_req, res) => {
        res.status(200).send('fell through');
    });
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
    });
});

describe('mountFetchHandler', () => {
    it('translates the request and writes status, multiple set-cookie headers, and body back', async () => {
        const res = await fetch(`${base}/auth/echo?x=1`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', cookie: 'sid=abc' },
            body: 'hello'
        });
        expect(res.status).toBe(201);
        expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
        expect(await res.json()).toEqual({
            body: 'hello',
            cookie: 'sid=abc',
            url: '/auth/echo?x=1'
        });
    });

    it('calls next() when the handler resolves null', async () => {
        const res = await fetch(`${base}/auth/unknown`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('fell through');
    });

    it('leaves requests outside the mount path untouched', async () => {
        const res = await fetch(`${base}/other`, { method: 'POST', body: 'x' });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('fell through');
    });
});
