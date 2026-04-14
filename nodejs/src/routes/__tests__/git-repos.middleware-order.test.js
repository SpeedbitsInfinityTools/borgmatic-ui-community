const authMw = (req, res, next) => next();
const adminMw = (req, res, next) => next();
const featureMw = (req, res, next) => next();
const mockRequireFeatureSpy = jest.fn(() => featureMw);

jest.mock('../../middleware/auth', () => ({
    authenticateToken: authMw,
    requireAdmin: adminMw,
}));

jest.mock('../../middleware/feature-gate', () => ({
    requireFeature: (...args) => mockRequireFeatureSpy(...args),
}));

describe('git-repos route middleware order', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('registers auth and admin middleware before feature gate', () => {
        const router = require('../git-repos');
        const topLevelUses = router.stack.filter((l) => !l.route);

        expect(mockRequireFeatureSpy).toHaveBeenCalledWith('git_repos');
        expect(topLevelUses[0].handle).toBe(authMw);
        expect(topLevelUses[1].handle).toBe(adminMw);
        expect(topLevelUses[2].handle).toBe(featureMw);
    });
});
