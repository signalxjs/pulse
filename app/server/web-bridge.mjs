// Express ↔ WinterCG bridge: mounts a `(Request) => Promise<Response | null>`
// fetch handler (e.g. @pulse/auth's createAuthHandler) on an Express app.
// The handler stays runtime-agnostic — this file is the only Node/Express
// coupling, and it lives in the app, not the package.

/**
 * @param {import('express').Express} app
 * @param {string} path mount point — only requests under it are bridged
 *   (and body-buffered); the Request is built from originalUrl, so the
 *   handler sees the full path including the mount.
 * @param {(request: Request) => Promise<Response | null>} handler
 */
export function mountFetchHandler(app, path, handler) {
    app.use(path, async (req, res, next) => {
        try {
            const url = `${req.protocol}://${req.headers.host ?? 'localhost'}${req.originalUrl}`;
            const headers = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
                if (Array.isArray(value)) for (const v of value) headers.append(name, v);
                else if (value !== undefined) headers.set(name, value);
            }
            let body;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                body = Buffer.concat(chunks);
            }
            const response = await handler(new Request(url, { method: req.method, headers, body }));
            if (!response) {
                next();
                return;
            }
            res.status(response.status);
            // set-cookie is the one header that must not be comma-joined.
            for (const cookie of response.headers.getSetCookie()) res.append('set-cookie', cookie);
            response.headers.forEach((value, name) => {
                if (name !== 'set-cookie') res.set(name, value);
            });
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
            next(err);
        }
    });
}
