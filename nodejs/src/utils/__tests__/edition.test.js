describe('utils/edition', () => {
    const ORIGINAL_ENV = process.env.EDITION;

    afterEach(() => {
        process.env.EDITION = ORIGINAL_ENV;
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('falls back to community when .edition is missing and EDITION is not commercial', () => {
        process.env.EDITION = 'community';
        jest.doMock('fs', () => ({
            existsSync: jest.fn(() => false),
            readFileSync: jest.fn(),
        }));

        const { getEditionInfo, isFeatureAvailable } = require('../edition');
        const info = getEditionInfo();

        expect(info.edition).toBe('community');
        expect(info.features).toEqual(['standalone', 'client']);
        expect(isFeatureAvailable('git_repos')).toBe(false);
    });

    it('falls back to commercial defaults only when EDITION=commercial', () => {
        process.env.EDITION = 'commercial';
        jest.doMock('fs', () => ({
            existsSync: jest.fn(() => false),
            readFileSync: jest.fn(),
        }));

        const { getEditionInfo, isFeatureAvailable } = require('../edition');
        const info = getEditionInfo();

        expect(info.edition).toBe('commercial');
        expect(info.features).toContain('git_repos');
        expect(info.features).toContain('mssql');
        expect(info.features).toContain('aws_iam');
        expect(isFeatureAvailable('git_repos')).toBe(true);
    });

    it('uses safe fallback when .edition JSON is invalid', () => {
        process.env.EDITION = 'community';
        jest.doMock('fs', () => ({
            existsSync: jest.fn(() => true),
            readFileSync: jest.fn(() => '{invalid json'),
        }));

        const { getEditionInfo } = require('../edition');
        const info = getEditionInfo();

        expect(info.edition).toBe('community');
        expect(info.features).toEqual(['standalone', 'client']);
    });
});
