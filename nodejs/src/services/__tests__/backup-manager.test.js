/**
 * Unit tests for BackupManager — validation, script generation, metadata round-trip.
 *
 * We mock the config module so the constructor doesn't need real filesystem paths.
 */

jest.mock('../../config', () => ({
    configDir: '/tmp/test-borgmatic-config',
}));
jest.mock('../retention-manager', () => ({}));
jest.mock('../config-parser', () => ({}));

// Module exports a singleton instance; use it directly
const bm = require('../backup-manager');

// ---------------------------------------------------------------------------
// _shellSingleQuote
// ---------------------------------------------------------------------------
describe('_shellSingleQuote', () => {
    it('wraps a normal string in single quotes', () => {
        expect(bm._shellSingleQuote('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes', () => {
        expect(bm._shellSingleQuote("it's")).toBe("'it'\"'\"'s'");
    });

    it('handles empty string', () => {
        expect(bm._shellSingleQuote('')).toBe("''");
    });

    it('handles null / undefined', () => {
        expect(bm._shellSingleQuote(null)).toBe("''");
        expect(bm._shellSingleQuote(undefined)).toBe("''");
    });

    it('converts numbers to string', () => {
        expect(bm._shellSingleQuote(5432)).toBe("'5432'");
    });
});

// ---------------------------------------------------------------------------
// _validateHookDbInputs
// ---------------------------------------------------------------------------
describe('_validateHookDbInputs', () => {
    const validPg = {
        type: 'postgresql',
        database_name: 'mydb',
        hostname: 'db.example.com',
        port: 5432,
        username: 'admin',
    };

    describe('supported types', () => {
        it.each(['postgresql', 'mysql', 'mariadb', 'mongodb'])('accepts %s', (type) => {
            const result = bm._validateHookDbInputs({ ...validPg, type, database_name: 'test' });
            expect(result.dbName).toBe('test');
        });

        it.each(['sqlite', 'mssql', 'unknown', ''])('rejects unsupported type: %s', (type) => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, type })
            ).toThrow(/Unsupported database type/);
        });

        it('rejects null/undefined source', () => {
            expect(() => bm._validateHookDbInputs(null)).toThrow(/Unsupported/);
            expect(() => bm._validateHookDbInputs(undefined)).toThrow(/Unsupported/);
        });
    });

    describe('database_name', () => {
        it('accepts "all"', () => {
            const r = bm._validateHookDbInputs({ ...validPg, database_name: 'all' });
            expect(r.dbName).toBe('all');
        });

        it('rejects empty name', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, database_name: '' })
            ).toThrow(/database name is required/);
        });

        it('rejects special characters', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, database_name: 'db; DROP TABLE' })
            ).toThrow(/Invalid.*database name/);
        });

        it('allows dots, underscores, dashes', () => {
            const r = bm._validateHookDbInputs({ ...validPg, database_name: 'my_db-v2.0' });
            expect(r.dbName).toBe('my_db-v2.0');
        });
    });

    describe('hostname', () => {
        it('defaults to localhost when missing', () => {
            const r = bm._validateHookDbInputs({ ...validPg, hostname: undefined });
            expect(r.host).toBe('localhost');
        });

        it('uses host.docker.internal when is_host_database is set', () => {
            const r = bm._validateHookDbInputs({ ...validPg, is_host_database: true });
            expect(r.host).toBe('host.docker.internal');
        });

        it('rejects hostname with spaces', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, hostname: 'bad host' })
            ).toThrow(/Invalid.*hostname/);
        });
    });

    describe('port', () => {
        it('uses type-specific default when missing', () => {
            const r = bm._validateHookDbInputs({ ...validPg, port: undefined });
            expect(r.port).toBe(5432);
        });

        it('falls back to default port for 0 (falsy)', () => {
            const r = bm._validateHookDbInputs({ ...validPg, port: 0 });
            expect(r.port).toBe(5432);
        });

        it('rejects port > 65535', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, port: 70000 })
            ).toThrow(/Invalid.*port/);
        });

        it('rejects non-integer port', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, port: 3.14 })
            ).toThrow(/Invalid.*port/);
        });
    });

    describe('username', () => {
        it('allows empty username', () => {
            const r = bm._validateHookDbInputs({ ...validPg, username: '' });
            expect(r.user).toBe('');
        });

        it('allows email-like usernames', () => {
            const r = bm._validateHookDbInputs({ ...validPg, username: 'user@domain.com' });
            expect(r.user).toBe('user@domain.com');
        });

        it('rejects username with shell metacharacters', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, username: 'user;rm -rf /' })
            ).toThrow(/Invalid.*username/);
        });
    });

    describe('auth_method', () => {
        it('defaults to password', () => {
            const r = bm._validateHookDbInputs(validPg);
            expect(r.authMethod).toBe('password');
        });

        it('accepts aws_iam with valid region and username', () => {
            const r = bm._validateHookDbInputs({
                ...validPg,
                auth_method: 'aws_iam',
                aws_region: 'us-east-1',
                username: 'iam_user',
            });
            expect(r.authMethod).toBe('aws_iam');
            expect(r.awsRegion).toBe('us-east-1');
        });

        it('rejects unknown auth method', () => {
            expect(() =>
                bm._validateHookDbInputs({ ...validPg, auth_method: 'kerberos' })
            ).toThrow(/Invalid auth method/);
        });

        it('rejects aws_iam for mongodb', () => {
            expect(() =>
                bm._validateHookDbInputs({
                    type: 'mongodb',
                    database_name: 'test',
                    auth_method: 'aws_iam',
                    aws_region: 'us-east-1',
                    username: 'user',
                })
            ).toThrow(/AWS IAM.*not supported.*mongodb/);
        });

        it('requires region for aws_iam', () => {
            expect(() =>
                bm._validateHookDbInputs({
                    ...validPg,
                    auth_method: 'aws_iam',
                    username: 'iam_user',
                    aws_region: '',
                })
            ).toThrow(/AWS Region is required/);
        });

        it('rejects invalid region format', () => {
            expect(() =>
                bm._validateHookDbInputs({
                    ...validPg,
                    auth_method: 'aws_iam',
                    username: 'iam_user',
                    aws_region: 'INVALID',
                })
            ).toThrow(/Invalid AWS Region format/);
        });

        it('requires username for aws_iam', () => {
            expect(() =>
                bm._validateHookDbInputs({
                    ...validPg,
                    auth_method: 'aws_iam',
                    aws_region: 'us-west-2',
                    username: '',
                })
            ).toThrow(/Database username is required.*IAM/);
        });

        it('rejects postgresql aws_iam when ssl_mode is disable', () => {
            expect(() =>
                bm._validateHookDbInputs({
                    ...validPg,
                    auth_method: 'aws_iam',
                    aws_region: 'us-east-1',
                    username: 'iam_user',
                    ssl_mode: 'disable',
                })
            ).toThrow(/requires TLS.*ssl_mode=disable/i);
        });

        it('accepts postgresql aws_iam with ssl_mode require', () => {
            const r = bm._validateHookDbInputs({
                ...validPg,
                auth_method: 'aws_iam',
                aws_region: 'us-east-1',
                username: 'iam_user',
                ssl_mode: 'require',
            });
            expect(r.authMethod).toBe('aws_iam');
            expect(r.awsRegion).toBe('us-east-1');
        });
    });
});

// ---------------------------------------------------------------------------
// _validateMssqlInputs
// ---------------------------------------------------------------------------
describe('_validateMssqlInputs', () => {
    const validMssql = {
        database_name: 'mydb',
        hostname: 'sql.example.com',
        port: 1433,
        username: 'sa',
        password: 'secret',
    };

    it('returns validated fields for valid SQL auth input', () => {
        const r = bm._validateMssqlInputs(validMssql);
        expect(r.dbName).toBe('mydb');
        expect(r.host).toBe('sql.example.com');
        expect(r.user).toBe('sa');
        expect(r.port).toBe(1433);
        expect(r.encrypt).toBe('true');
        expect(r.auth_method).toBe('sql');
    });

    it('accepts "all" as database name', () => {
        const r = bm._validateMssqlInputs({ ...validMssql, database_name: 'all' });
        expect(r.dbName).toBe('all');
    });

    it('rejects empty database name', () => {
        expect(() =>
            bm._validateMssqlInputs({ ...validMssql, database_name: '' })
        ).toThrow(/MSSQL database name is required/);
    });

    it('rejects database name with invalid chars', () => {
        expect(() =>
            bm._validateMssqlInputs({ ...validMssql, database_name: 'db; DROP' })
        ).toThrow(/Invalid MSSQL database name/);
    });

    it('defaults hostname to localhost', () => {
        const r = bm._validateMssqlInputs({ ...validMssql, hostname: undefined });
        expect(r.host).toBe('localhost');
    });

    it('uses host.docker.internal for host databases', () => {
        const r = bm._validateMssqlInputs({ ...validMssql, is_host_database: true });
        expect(r.host).toBe('host.docker.internal');
    });

    it('defaults port to 1433', () => {
        const r = bm._validateMssqlInputs({ ...validMssql, port: undefined });
        expect(r.port).toBe(1433);
    });

    it('falls back to 1433 for port 0 (falsy)', () => {
        const r = bm._validateMssqlInputs({ ...validMssql, port: 0 });
        expect(r.port).toBe(1433);
    });

    it('rejects out-of-range port', () => {
        expect(() =>
            bm._validateMssqlInputs({ ...validMssql, port: 99999 })
        ).toThrow(/Invalid MSSQL port/);
    });

    describe('encrypt mode', () => {
        it.each(['true', 'false', 'strict'])('accepts encrypt=%s', (mode) => {
            const r = bm._validateMssqlInputs({ ...validMssql, encrypt: mode });
            expect(r.encrypt).toBe(mode);
        });

        it('rejects invalid encrypt mode', () => {
            expect(() =>
                bm._validateMssqlInputs({ ...validMssql, encrypt: 'maybe' })
            ).toThrow(/Invalid MSSQL encrypt mode/);
        });
    });

    describe('auth methods', () => {
        it('accepts ad_password', () => {
            const r = bm._validateMssqlInputs({ ...validMssql, auth_method: 'ad_password' });
            expect(r.auth_method).toBe('ad_password');
        });

        it('rejects unknown auth method', () => {
            expect(() =>
                bm._validateMssqlInputs({ ...validMssql, auth_method: 'oauth' })
            ).toThrow(/Invalid MSSQL auth method/);
        });

        it('service principal requires client_id', () => {
            expect(() =>
                bm._validateMssqlInputs({
                    ...validMssql,
                    auth_method: 'service_principal',
                    client_id: '',
                    tenant_id: 'abc-123',
                })
            ).toThrow(/Client ID/);
        });

        it('service principal requires tenant_id', () => {
            expect(() =>
                bm._validateMssqlInputs({
                    ...validMssql,
                    auth_method: 'service_principal',
                    client_id: 'abc-123',
                    tenant_id: '',
                })
            ).toThrow(/Tenant ID/);
        });

        it('service principal with valid GUIDs succeeds', () => {
            const r = bm._validateMssqlInputs({
                ...validMssql,
                auth_method: 'service_principal',
                client_id: '12345678-abcd-efgh-ijkl-000000000000',
                tenant_id: '87654321-dcba-hgfe-lkji-111111111111',
            });
            expect(r.auth_method).toBe('service_principal');
            expect(r.client_id).toBe('12345678-abcd-efgh-ijkl-000000000000');
        });
    });

    describe('instance', () => {
        it('allows empty instance', () => {
            const r = bm._validateMssqlInputs(validMssql);
            expect(r.instance).toBe('');
        });

        it('accepts valid instance name', () => {
            const r = bm._validateMssqlInputs({ ...validMssql, instance: 'SQLEXPRESS' });
            expect(r.instance).toBe('SQLEXPRESS');
        });

        it('rejects instance with invalid chars', () => {
            expect(() =>
                bm._validateMssqlInputs({ ...validMssql, instance: 'bad instance' })
            ).toThrow(/Invalid MSSQL instance name/);
        });
    });
});

// ---------------------------------------------------------------------------
// generateDbDumpScript
// ---------------------------------------------------------------------------
describe('generateDbDumpScript', () => {
    const tempDir = '/tmp/borgmatic_db_dumps_backup_test123';

    describe('PostgreSQL', () => {
        const pgSource = {
            type: 'postgresql',
            database_name: 'appdb',
            hostname: 'pg.example.com',
            port: 5432,
            username: 'pguser',
            password: 's3cret',
        };

        it('generates a valid single-DB dump script', () => {
            const script = bm.generateDbDumpScript(pgSource, null, tempDir);
            expect(script).toMatch(/^#!\/bin\/sh/);
            expect(script).toContain('set -eu');
            expect(script).toContain('BORGMATIC_UI_DB_META_B64:');
            expect(script).toContain('pg_dump');
            expect(script).toContain('-d');
            expect(script).toContain('appdb');
            expect(script).toContain('PGPASSFILE');
        });

        it('generates pg_dumpall for "all"', () => {
            const script = bm.generateDbDumpScript({ ...pgSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('pg_dumpall');
            expect(script).not.toContain('pg_dump -');
        });

        it('sets PGSSLMODE when ssl_mode is provided', () => {
            const script = bm.generateDbDumpScript({ ...pgSource, ssl_mode: 'require' }, null, tempDir);
            expect(script).toContain("PGSSLMODE='require'");
        });

        it('uses env var for password when passEnvVar is given', () => {
            const script = bm.generateDbDumpScript(pgSource, 'PG_PASS_42', tempDir);
            expect(script).toContain('printenv PG_PASS_42');
            expect(script).not.toContain('s3cret');
        });

        it('does not leak password literally when using env var', () => {
            const script = bm.generateDbDumpScript(pgSource, 'PG_PASS', tempDir);
            expect(script).not.toContain('s3cret');
        });
    });

    describe('PostgreSQL with AWS IAM', () => {
        const pgIam = {
            type: 'postgresql',
            database_name: 'appdb',
            hostname: 'mydb.abc123.us-east-1.rds.amazonaws.com',
            port: 5432,
            username: 'iam_user',
            auth_method: 'aws_iam',
            aws_region: 'us-east-1',
        };

        it('generates IAM token command', () => {
            const script = bm.generateDbDumpScript(pgIam, null, tempDir);
            expect(script).toContain('aws rds generate-db-auth-token');
            expect(script).toContain('--region');
            expect(script).toContain('us-east-1');
        });

        it('forces PGSSLMODE for IAM auth', () => {
            const script = bm.generateDbDumpScript(pgIam, null, tempDir);
            expect(script).toContain('PGSSLMODE');
        });

        it('includes aws-cli availability check', () => {
            const script = bm.generateDbDumpScript(pgIam, null, tempDir);
            expect(script).toContain('command -v aws');
        });

        it('does not use env var password for IAM', () => {
            const script = bm.generateDbDumpScript(pgIam, 'SOME_PASS', tempDir);
            expect(script).not.toContain('printenv SOME_PASS');
            expect(script).toContain('aws rds generate-db-auth-token');
        });
    });

    describe('MySQL', () => {
        const mysqlSource = {
            type: 'mysql',
            database_name: 'shopdb',
            hostname: 'mysql.local',
            port: 3306,
            username: 'root',
            password: 'pass',
        };

        it('uses mysqldump for mysql type', () => {
            const script = bm.generateDbDumpScript(mysqlSource, null, tempDir);
            expect(script).toContain('mysqldump');
            expect(script).toContain('MYSQL_PWD=');
            expect(script).toContain('--single-transaction');
        });

        it('uses --all-databases for "all"', () => {
            const script = bm.generateDbDumpScript({ ...mysqlSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('--all-databases');
        });

        it('adds --skip-ssl when tls=false', () => {
            const script = bm.generateDbDumpScript({ ...mysqlSource, tls: false }, null, tempDir);
            expect(script).toContain('--skip-ssl');
        });

        it('does not add --skip-ssl by default', () => {
            const script = bm.generateDbDumpScript(mysqlSource, null, tempDir);
            expect(script).not.toContain('--skip-ssl');
        });
    });

    describe('MySQL with AWS IAM', () => {
        const mysqlIam = {
            type: 'mysql',
            database_name: 'shopdb',
            hostname: 'mydb.abc123.us-west-2.rds.amazonaws.com',
            port: 3306,
            username: 'iam_user',
            auth_method: 'aws_iam',
            aws_region: 'us-west-2',
        };

        it('generates IAM token and forces --ssl', () => {
            const script = bm.generateDbDumpScript(mysqlIam, null, tempDir);
            expect(script).toContain('aws rds generate-db-auth-token');
            expect(script).toContain('--ssl');
            expect(script).not.toContain('--skip-ssl');
        });
    });

    describe('MariaDB', () => {
        const mariaSource = {
            type: 'mariadb',
            database_name: 'crm',
            hostname: 'maria.local',
            port: 3306,
            username: 'root',
            password: 'pass',
        };

        it('uses mariadb-dump command', () => {
            const script = bm.generateDbDumpScript(mariaSource, null, tempDir);
            expect(script).toContain('mariadb-dump');
            expect(script).not.toContain('mysqldump');
        });

        it('supports AWS IAM auth', () => {
            const script = bm.generateDbDumpScript({
                ...mariaSource,
                auth_method: 'aws_iam',
                aws_region: 'eu-west-1',
                username: 'iam_user',
            }, null, tempDir);
            expect(script).toContain('aws rds generate-db-auth-token');
            expect(script).toContain('--ssl');
        });
    });

    describe('MongoDB', () => {
        const mongoSource = {
            type: 'mongodb',
            database_name: 'analytics',
            hostname: 'mongo.local',
            port: 27017,
            username: 'mongouser',
            password: 'pass',
        };

        it('uses mongodump', () => {
            const script = bm.generateDbDumpScript(mongoSource, null, tempDir);
            expect(script).toContain('mongodump');
            expect(script).toContain('--db=');
        });

        it('uses --archive for all DBs', () => {
            const script = bm.generateDbDumpScript({ ...mongoSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('mongodump');
            expect(script).toContain('--archive=');
            expect(script).not.toContain('--db=');
        });

        it('adds --tls when tls=true', () => {
            const script = bm.generateDbDumpScript({ ...mongoSource, tls: true }, null, tempDir);
            expect(script).toContain('--tls');
        });

        it('omits --tls when not set', () => {
            const script = bm.generateDbDumpScript(mongoSource, null, tempDir);
            expect(script).not.toContain('--tls');
        });

        it('includes authenticationDatabase', () => {
            const script = bm.generateDbDumpScript(mongoSource, null, tempDir);
            expect(script).toContain('--authenticationDatabase=');
        });
    });

    describe('metadata round-trip', () => {
        it('embeds base64 metadata that decodes correctly', () => {
            const source = {
                type: 'postgresql',
                database_name: 'roundtrip_db',
                hostname: 'pg.test',
                port: 5432,
                username: 'admin',
                password: 'pw',
                ssl_mode: 'verify-full',
                auth_method: 'password',
            };
            const script = bm.generateDbDumpScript(source, null, tempDir);
            const match = script.match(/BORGMATIC_UI_DB_META_B64:([A-Za-z0-9+/=]+)/);
            expect(match).toBeTruthy();
            const decoded = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
            expect(decoded.type).toBe('postgresql');
            expect(decoded.database_name).toBe('roundtrip_db');
            expect(decoded.ssl_mode).toBe('verify-full');
            expect(decoded.auth_method).toBe('password');
        });

        it('includes aws_region in metadata for IAM auth', () => {
            const source = {
                type: 'mysql',
                database_name: 'iamdb',
                hostname: 'rds.test',
                port: 3306,
                username: 'iam_user',
                auth_method: 'aws_iam',
                aws_region: 'ap-southeast-1',
            };
            const script = bm.generateDbDumpScript(source, null, tempDir);
            const match = script.match(/BORGMATIC_UI_DB_META_B64:([A-Za-z0-9+/=]+)/);
            const decoded = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
            expect(decoded.auth_method).toBe('aws_iam');
            expect(decoded.aws_region).toBe('ap-southeast-1');
        });
    });

    it('rejects unsupported type', () => {
        expect(() =>
            bm.generateDbDumpScript({ type: 'oracle', database_name: 'x' }, null, tempDir)
        ).toThrow();
    });
});

// ---------------------------------------------------------------------------
// generateMssqlDumpScript
// ---------------------------------------------------------------------------
describe('generateMssqlDumpScript', () => {
    const tempDir = '/tmp/borgmatic_mssql_dumps_backup_test';

    const sqlSource = {
        database_name: 'SalesDB',
        hostname: 'mssql.example.com',
        port: 1433,
        username: 'sa',
        password: 'StrongPass1!',
    };

    describe('SQL Authentication', () => {
        it('generates a single-DB export script', () => {
            const script = bm.generateMssqlDumpScript(sqlSource, null, tempDir);
            expect(script).toMatch(/^#!\/bin\/sh/);
            expect(script).toContain('set -eu');
            expect(script).toContain('BORGMATIC_UI_MSSQL_META_B64:');
            expect(script).toContain('sqlpackage');
            expect(script).toContain('SalesDB');
            expect(script).toContain('/Action:Export');
        });

        it('generates an all-databases script with sqlcmd listing', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('SQLCMD_BIN');
            expect(script).toContain('sys.databases');
            expect(script).toContain('while IFS=');
        });

        it('uses SourceUser for SQL auth', () => {
            const script = bm.generateMssqlDumpScript(sqlSource, null, tempDir);
            expect(script).toContain('/SourceUser:');
            expect(script).not.toContain('/scs:');
        });
    });

    describe('AD Password Authentication', () => {
        const adSource = {
            ...sqlSource,
            auth_method: 'ad_password',
            username: 'user@company.com',
        };

        it('uses connection string with Active Directory Password', () => {
            const script = bm.generateMssqlDumpScript(adSource, null, tempDir);
            expect(script).toContain('Active Directory Password');
            expect(script).toContain('/scs:');
        });

        it('uses ActiveDirectoryPassword for sqlcmd in all-DB mode', () => {
            const script = bm.generateMssqlDumpScript({ ...adSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('--authentication-method ActiveDirectoryPassword');
        });
    });

    describe('Service Principal Authentication', () => {
        const spSource = {
            ...sqlSource,
            auth_method: 'service_principal',
            client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            tenant_id: '11111111-2222-3333-4444-555555555555',
        };

        it('uses connection string with Service Principal', () => {
            const script = bm.generateMssqlDumpScript(spSource, null, tempDir);
            expect(script).toContain('Active Directory Service Principal');
            expect(script).toContain('/scs:');
        });

        it('includes tenant-id for sqlcmd in all-DB mode', () => {
            const script = bm.generateMssqlDumpScript({ ...spSource, database_name: 'all' }, null, tempDir);
            expect(script).toContain('--tenant-id');
            expect(script).toContain('11111111-2222-3333-4444-555555555555');
        });
    });

    describe('encrypt and trust cert', () => {
        it('maps encrypt=true to True for sqlpackage', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, encrypt: 'true' }, null, tempDir);
            expect(script).toContain('SourceEncryptConnection:True');
        });

        it('maps encrypt=false to False', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, encrypt: 'false' }, null, tempDir);
            expect(script).toContain('SourceEncryptConnection:False');
        });

        it('maps encrypt=strict to Strict', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, encrypt: 'strict' }, null, tempDir);
            expect(script).toContain('SourceEncryptConnection:Strict');
        });

        it('sets TrustServerCertificate when trustServerCert=true', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, trustServerCert: true }, null, tempDir);
            expect(script).toContain('TrustServerCertificate:True');
        });
    });

    describe('named instance', () => {
        it('includes instance in server name', () => {
            const script = bm.generateMssqlDumpScript({ ...sqlSource, instance: 'SQLEXPRESS' }, null, tempDir);
            expect(script).toContain('SQLEXPRESS');
        });
    });

    describe('password env var', () => {
        it('uses printenv when passEnvVar is provided', () => {
            const script = bm.generateMssqlDumpScript(sqlSource, 'MSSQL_PASS', tempDir);
            expect(script).toContain('printenv MSSQL_PASS');
            expect(script).not.toContain('StrongPass1!');
        });
    });

    describe('metadata round-trip', () => {
        it('embeds decodable MSSQL metadata', () => {
            const script = bm.generateMssqlDumpScript(sqlSource, null, tempDir);
            const match = script.match(/BORGMATIC_UI_MSSQL_META_B64:([A-Za-z0-9+/=]+)/);
            expect(match).toBeTruthy();
            const decoded = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
            expect(decoded.type).toBe('mssql');
            expect(decoded.database_name).toBe('SalesDB');
            expect(decoded.auth_method).toBe('sql');
        });
    });
});

// ---------------------------------------------------------------------------
// _extractDbDumpSourcesFromHooks — round-trip with generateDbDumpScript
// ---------------------------------------------------------------------------
describe('_extractDbDumpSourcesFromHooks', () => {
    it('extracts postgresql source from generated script', () => {
        const source = {
            type: 'postgresql',
            database_name: 'myapp',
            hostname: 'pg.local',
            port: 5432,
            username: 'admin',
            password: 'secret',
            ssl_mode: 'require',
        };
        const script = bm.generateDbDumpScript(source, 'PG_PASS', '/tmp/test');
        const config = { commands: [{ before: 'action', when: ['create'], run: [script] }] };
        const extracted = bm._extractDbDumpSourcesFromHooks(config);

        expect(extracted).toHaveLength(1);
        const ex = extracted[0];
        expect(ex.type).toBe('postgresql');
        expect(ex.database_name).toBe('myapp');
        expect(ex.hostname).toBe('pg.local');
        expect(ex.port).toBe(5432);
        expect(ex.username).toBe('admin');
        expect(ex.ssl_mode).toBe('require');
        expect(ex.auth_method).toBe('password');
        expect(ex.dump_method).toBe('local');
        expect(ex.password).toBe('${PG_PASS}');
    });

    it('extracts AWS IAM fields from generated script', () => {
        const source = {
            type: 'mysql',
            database_name: 'shopdb',
            hostname: 'rds.test.us-east-1.rds.amazonaws.com',
            port: 3306,
            username: 'iam_user',
            auth_method: 'aws_iam',
            aws_region: 'us-east-1',
        };
        const script = bm.generateDbDumpScript(source, null, '/tmp/test');
        const config = { commands: [{ run: [script] }] };
        const extracted = bm._extractDbDumpSourcesFromHooks(config);

        expect(extracted).toHaveLength(1);
        expect(extracted[0].auth_method).toBe('aws_iam');
        expect(extracted[0].aws_region).toBe('us-east-1');
    });

    it('extracts multiple sources from multiple hooks', () => {
        const pgScript = bm.generateDbDumpScript({
            type: 'postgresql', database_name: 'db1', hostname: 'pg', port: 5432, username: 'u', password: 'p',
        }, null, '/tmp/t1');
        const mysqlScript = bm.generateDbDumpScript({
            type: 'mysql', database_name: 'db2', hostname: 'mysql', port: 3306, username: 'u', password: 'p',
        }, null, '/tmp/t2');
        const config = { commands: [{ run: [pgScript] }, { run: [mysqlScript] }] };
        const extracted = bm._extractDbDumpSourcesFromHooks(config);

        expect(extracted).toHaveLength(2);
        expect(extracted[0].type).toBe('postgresql');
        expect(extracted[1].type).toBe('mysql');
    });

    it('ignores malformed base64 metadata', () => {
        const config = {
            commands: [{
                run: ['#!/bin/sh\n# BORGMATIC_UI_DB_META_B64:not_valid_base64!!!'],
            }],
        };
        const extracted = bm._extractDbDumpSourcesFromHooks(config);
        expect(extracted).toHaveLength(0);
    });

    it('ignores hooks without marker', () => {
        const config = {
            commands: [{ run: ['#!/bin/sh\necho hello'] }],
        };
        const extracted = bm._extractDbDumpSourcesFromHooks(config);
        expect(extracted).toHaveLength(0);
    });

    it('returns empty for config without commands', () => {
        expect(bm._extractDbDumpSourcesFromHooks({})).toEqual([]);
        expect(bm._extractDbDumpSourcesFromHooks({ commands: [] })).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// _extractGitRepoSourcesFromHooks
// ---------------------------------------------------------------------------
describe('_extractGitRepoSourcesFromHooks', () => {
    it('extracts git repo metadata from hooks', () => {
        const meta = {
            type: 'git_repos',
            platform: 'github',
            organization: 'myorg',
            scope: 'organization',
            backup_type: 'mirror',
            target_dir: '/backup/git/myorg',
        };
        const b64 = Buffer.from(JSON.stringify(meta)).toString('base64');
        const config = {
            commands: [{
                run: [`#!/bin/sh\n# BORGMATIC_UI_GIT_META_B64:${b64}\necho backup`],
            }],
        };
        const extracted = bm._extractGitRepoSourcesFromHooks(config);
        expect(extracted).toHaveLength(1);
        expect(extracted[0].platform).toBe('github');
        expect(extracted[0].organization).toBe('myorg');
    });

    it('ignores malformed base64', () => {
        const config = {
            commands: [{
                run: ['#!/bin/sh\n# BORGMATIC_UI_GIT_META_B64:BROKEN!!!\necho x'],
            }],
        };
        expect(bm._extractGitRepoSourcesFromHooks(config)).toEqual([]);
    });

    it('ignores non-git metadata', () => {
        const meta = { type: 'something_else', platform: 'github' };
        const b64 = Buffer.from(JSON.stringify(meta)).toString('base64');
        const config = {
            commands: [{ run: [`# BORGMATIC_UI_GIT_META_B64:${b64}`] }],
        };
        expect(bm._extractGitRepoSourcesFromHooks(config)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// getSourcesSummary
// ---------------------------------------------------------------------------
describe('getSourcesSummary', () => {
    it('extracts local source directories', () => {
        const config = { source_directories: ['/home/user/docs', '/var/data'] };
        const sources = bm.getSourcesSummary(config);
        const locals = sources.filter(s => s.type === 'local');
        expect(locals).toHaveLength(2);
        expect(locals[0].path).toBe('/home/user/docs');
    });

    it('excludes dump temp directories from local sources', () => {
        const config = {
            source_directories: [
                '/home/data',
                '/tmp/borgmatic_db_dumps_backup_abc123',
                '/tmp/borgmatic_mssql_dumps_backup_xyz',
            ],
        };
        const sources = bm.getSourcesSummary(config);
        const locals = sources.filter(s => s.type === 'local');
        expect(locals).toHaveLength(1);
        expect(locals[0].path).toBe('/home/data');
    });

    it('extracts native borgmatic DB hooks', () => {
        const config = {
            source_directories: [],
            postgresql_databases: [
                { name: 'testdb', hostname: 'localhost', port: 5432, username: 'pg' },
            ],
        };
        const sources = bm.getSourcesSummary(config);
        const dbs = sources.filter(s => s.type === 'postgresql');
        expect(dbs).toHaveLength(1);
        expect(dbs[0].dump_method).toBe('native');
        expect(dbs[0].database_name).toBe('testdb');
    });

    it('extracts dump-script hook sources with auth_method', () => {
        const source = {
            type: 'mysql',
            database_name: 'iamdb',
            hostname: 'rds.test',
            port: 3306,
            username: 'iam_user',
            auth_method: 'aws_iam',
            aws_region: 'us-east-1',
        };
        const script = bm.generateDbDumpScript(source, null, '/tmp/test_dump');
        const config = {
            source_directories: ['/tmp/test_dump'],
            commands: [{ before: 'action', when: ['create'], run: [script] }],
        };
        const sources = bm.getSourcesSummary(config);
        const dbs = sources.filter(s => s.type === 'mysql');
        expect(dbs).toHaveLength(1);
        expect(dbs[0].auth_method).toBe('aws_iam');
        expect(dbs[0].aws_region).toBe('us-east-1');
        expect(dbs[0].dump_method).toBe('local');
    });

    it('handles config with location prefix (old format)', () => {
        const config = {
            location: {
                source_directories: ['/old/path'],
            },
        };
        const sources = bm.getSourcesSummary(config);
        expect(sources.filter(s => s.type === 'local')).toHaveLength(1);
    });
});
