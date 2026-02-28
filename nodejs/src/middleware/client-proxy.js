/**
 * Client Proxy Middleware - Community Edition Stub
 */

async function clientProxyMiddleware(req, res, next) {
    // In Community edition, there's no proxying
    return next();
}

module.exports = clientProxyMiddleware;
