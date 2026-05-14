/**
 * Client Proxy Middleware
 *
 * Bridges HTTP requests from the director's UI to a remote client over the existing
 * authenticated socket.io tunnel. Activated on requests carrying the X-Remote-Client-ID
 * header — set by the frontend api interceptor when a remote session is active.
 *
 * Wire diagram (one request):
 *
 *   browser → director-express (auth here) → this middleware → director-server.sendCommandToClient
 *                                                                          │
 *                                                                          ▼
 *                                                           client-socket  ╲
 *                                                                          ▼
 *                                                       client-server.api:proxy handler
 *                                                                          │
 *                                                                          ▼
 *                                                              client-express (handles request)
 *                                                                          │
 *                                                                          ▼
 *                                       response  ◀── socket.io ───  {status, headers, body}
 *
 * The original auth header from the browser is NOT forwarded — JWT secrets differ between
 * director and client. The client mints its own admin JWT for the inner call and trusts
 * the request because it arrived over its authenticated director socket.
 *
 * Paths that should always run locally on the director (login, identity, director-only
 * routes, SSE) bypass this middleware via the EXCLUDED list.
 */

const authService = require('../services/auth');
const sessionManager = require('../services/session-manager');
const directorServer = require('../services/director-server');

// Paths that must always be served by the director itself, even while the user is
// "in" a remote session. Things the director needs to know about itself (auth,
// identity, mode), director-only admin surfaces, and SSE streams that don't fit
// through the request/response RPC. Kept in sync with the frontend's EXCLUDED_PATHS
// in services/api.ts — if you change one, change the other.
const LOCAL_ONLY_PREFIXES = [
    '/auth/',
    '/identity/',
    '/director/',
    '/system-config/',
    '/events/',
];

// Per-request timeout for tunneled calls. Generous enough for most read endpoints; very
// long-running operations (manual backup, restore) are already async on the client.
const PROXY_TIMEOUT_MS = parseInt(process.env.DIRECTOR_PROXY_TIMEOUT_MS, 10) || 60000;

function shouldBypass(originalUrl) {
    // originalUrl on the /api mount looks like '/auth/login', '/backups', etc.
    return LOCAL_ONLY_PREFIXES.some(p => originalUrl.startsWith(p));
}

async function clientProxyMiddleware(req, res, next) {
    const targetClientId = req.headers['x-remote-client-id'];

    // No remote session active for this request → run locally on the director.
    if (!targetClientId) return next();

    // Don't proxy our own internal proxy traffic (defensive: prevents infinite loops if a
    // misconfigured client's UI ever forwards X-Remote-Client-ID back to its own director).
    if (req.headers['x-internal-proxy'] === 'true') return next();

    // Some surfaces must always run on the director itself.
    if (shouldBypass(req.originalUrl.replace(/^\/api/, ''))) {
        return next();
    }

    // Authenticate the user on the director BEFORE we cost a round-trip to the client.
    // We don't reuse the route-level auth middleware here because the proxy runs before
    // the route stack, but we apply the same JWT/session checks.
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            return res.status(401).json({ detail: 'Could not validate credentials', error: 'No token provided' });
        }
        const decoded = authService.verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ detail: 'Could not validate credentials', error: 'Invalid token' });
        }
        if (!sessionManager.isSessionValid(token)) {
            return res.status(401).json({ detail: 'Session expired due to inactivity', error: 'Session expired', session_expired: true });
        }
        // Keep auth behavior aligned with middleware/auth.js to avoid privilege drift.
        const user = await authService.getUserProfile(decoded.sub);
        if (!user) {
            return res.status(401).json({ detail: 'Could not validate credentials', error: 'User not found' });
        }
        if (!user.is_active) {
            return res.status(400).json({ detail: 'Inactive user', error: 'User account is disabled' });
        }
        sessionManager.updateActivity(token);
    } catch (e) {
        return res.status(401).json({ detail: 'Could not validate credentials', error: 'Authentication failed' });
    }

    // Forward via socket.io to the connected client.
    try {
        const envelope = await directorServer.sendCommandToClient(
            targetClientId,
            'api:proxy',
            {
                method: req.method,
                // Use originalUrl to preserve the /api prefix and any query string, since
                // the client's express expects the full path.
                path: req.originalUrl,
                headers: req.headers,
                body: req.body
            },
            PROXY_TIMEOUT_MS
        );

        // sendCommandToClient wraps successful responses as { success, data }
        // where `data` is what the client's command handler returned. Unwrap once
        // here, but tolerate either shape so we don't break if the wire format
        // is ever flattened.
        const result = (envelope && envelope.success === true && envelope.data !== undefined)
            ? envelope.data
            : envelope;

        // Replay the client's response. We trust the client's status/headers/body — but
        // strip hop-by-hop and transport-controlled headers that node would mismanage if
        // we tried to relay them verbatim.
        const HOP_BY_HOP = new Set([
            'connection', 'keep-alive', 'transfer-encoding', 'content-length',
            'content-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
            'set-cookie'
        ]);
        if (result?.headers && typeof result.headers === 'object') {
            for (const [k, v] of Object.entries(result.headers)) {
                if (HOP_BY_HOP.has(k.toLowerCase())) continue;
                if (v == null) continue;
                try { res.setHeader(k, v); } catch (_) { /* invalid header name from client; skip */ }
            }
        }
        res.status(result?.status || 502);
        if (result?.isBase64) {
            res.end(Buffer.from(result.body || '', 'base64'));
        } else {
            // body is already a string (text/json/etc.) — send as-is.
            res.end(result?.body ?? '');
        }
    } catch (err) {
        // Distinguish "client not connected" from generic failures so the UI can react.
        const message = err?.message || String(err);
        const isOffline = /not connected|not authenticated/i.test(message);
        const isTimeout = /timeout/i.test(message);
        const status = isOffline ? 503 : isTimeout ? 504 : 502;
        console.warn(`🔌 Proxy → ${targetClientId} failed (${status}): ${message}`);
        return res.status(status).json({
            success: false,
            detail: isOffline
                ? 'The remote client is not currently connected to the director.'
                : isTimeout
                    ? 'The remote client did not respond in time. It may be busy or its link is unstable.'
                    : `Bad gateway: ${message}`,
            error: 'remote_client_unreachable',
            client_id: targetClientId
        });
    }
}

module.exports = clientProxyMiddleware;
