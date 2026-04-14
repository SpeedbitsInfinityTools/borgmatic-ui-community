/**
 * Tests for db-tool-check.js — dispatcher and result structure.
 *
 * These tests verify the public API contracts and structure of the returned
 * objects. Actual tool availability depends on the host, so we test the
 * shape/contract rather than specific presence.
 */

const { checkDbTools, checkMssqlTools, checkAwsTools } = require('../db-tool-check');

describe('checkDbTools dispatcher', () => {
    it('returns MSSQL-shaped result for "mssql"', () => {
        const result = checkDbTools('mssql');
        expect(result).toHaveProperty('ok');
        expect(typeof result.ok).toBe('boolean');
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result).toHaveProperty('sqlcmd');
        expect(result).toHaveProperty('sqlpackage');
        expect(result.sqlcmd).toHaveProperty('found');
        expect(result.sqlcmd).toHaveProperty('path');
        expect(result.sqlpackage).toHaveProperty('found');
        expect(result.sqlpackage).toHaveProperty('path');
    });

    it('returns AWS-shaped result for "aws"', () => {
        const result = checkDbTools('aws');
        expect(result).toHaveProperty('ok');
        expect(typeof result.ok).toBe('boolean');
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result).toHaveProperty('aws');
        expect(result.aws).toHaveProperty('found');
        expect(result.aws).toHaveProperty('path');
    });

    it('returns ok=true with empty errors for unknown types', () => {
        const result = checkDbTools('postgresql');
        expect(result).toEqual({ ok: true, errors: [] });
    });

    it('returns ok=true for unrecognized types', () => {
        expect(checkDbTools('oracle')).toEqual({ ok: true, errors: [] });
        expect(checkDbTools('')).toEqual({ ok: true, errors: [] });
    });
});

describe('checkMssqlTools', () => {
    it('returns consistent ok/errors relationship', () => {
        const result = checkMssqlTools();
        if (result.ok) {
            expect(result.errors).toHaveLength(0);
        } else {
            expect(result.errors.length).toBeGreaterThan(0);
        }
    });

    it('sqlcmd.found matches path presence', () => {
        const result = checkMssqlTools();
        if (result.sqlcmd.found) {
            expect(result.sqlcmd.path).toBeTruthy();
        }
    });

    it('sqlpackage.found matches path presence', () => {
        const result = checkMssqlTools();
        if (result.sqlpackage.found) {
            expect(result.sqlpackage.path).toBeTruthy();
        }
    });
});

describe('checkAwsTools', () => {
    it('returns consistent ok/errors relationship', () => {
        const result = checkAwsTools();
        if (result.ok) {
            expect(result.errors).toHaveLength(0);
            expect(result.aws.found).toBe(true);
        } else {
            expect(result.errors.length).toBeGreaterThan(0);
        }
    });

    it('aws.found matches path presence', () => {
        const result = checkAwsTools();
        if (result.aws.found) {
            expect(result.aws.path).toBeTruthy();
        } else {
            expect(result.aws.path).toBeNull();
        }
    });
});
