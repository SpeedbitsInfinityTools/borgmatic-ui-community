jest.mock('../../middleware/auth', () => ({
    authenticateToken: (req, res, next) => next(),
    requireAdmin: (req, res, next) => next(),
}));

const mockIsFeatureAvailable = jest.fn();
jest.mock('../../utils/edition', () => ({
    isFeatureAvailable: (...args) => mockIsFeatureAvailable(...args),
}));

const mockCheckDbTools = jest.fn();
jest.mock('../../utils/db-tool-check', () => ({
    checkDbTools: (...args) => mockCheckDbTools(...args),
}));

function getRouteHandler(router, method, path) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

describe('database-discovery MSSQL feature gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('blocks MSSQL tool-check when mssql feature is unavailable', async () => {
        const router = require('../database-discovery');
        const handler = getRouteHandler(router, 'get', '/tool-check/:dbType');
        mockIsFeatureAvailable.mockReturnValue(false);

        const req = { params: { dbType: 'mssql' } };
        const res = makeRes();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'payment_required',
            feature: 'mssql',
        }));
        expect(mockCheckDbTools).not.toHaveBeenCalled();
    });

    it('allows non-MSSQL tool-check even when mssql feature is unavailable', async () => {
        const router = require('../database-discovery');
        const handler = getRouteHandler(router, 'get', '/tool-check/:dbType');
        mockIsFeatureAvailable.mockReturnValue(false);
        mockCheckDbTools.mockReturnValue({ ok: true, errors: [] });

        const req = { params: { dbType: 'postgresql' } };
        const res = makeRes();
        await handler(req, res);

        expect(res.status).not.toHaveBeenCalledWith(402);
        expect(mockCheckDbTools).toHaveBeenCalledWith('postgresql');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('blocks MSSQL test-connection when feature is unavailable', async () => {
        const router = require('../database-discovery');
        const handler = getRouteHandler(router, 'post', '/test-connection');
        mockIsFeatureAvailable.mockReturnValue(false);

        const req = { body: { type: 'mssql' } };
        const res = makeRes();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'payment_required',
            feature: 'mssql',
        }));
    });

    it('blocks MSSQL list-databases when feature is unavailable', async () => {
        const router = require('../database-discovery');
        const handler = getRouteHandler(router, 'post', '/list-databases');
        mockIsFeatureAvailable.mockReturnValue(false);

        const req = { body: { type: 'mssql' } };
        const res = makeRes();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'payment_required',
            feature: 'mssql',
        }));
    });
});
