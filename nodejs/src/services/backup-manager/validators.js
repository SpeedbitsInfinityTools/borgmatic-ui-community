/**
 * Input validation and shell-quoting utilities for backup-manager.
 * All functions are pure (no filesystem or instance state).
 */

const DEFAULT_PORTS = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, mssql: 1433 };

function getDefaultPort(dbType) {
    return DEFAULT_PORTS[dbType] || 5432;
}

function shellSingleQuote(value) {
    return `'${String(value ?? '').replace(/'/g, `'\"'\"'`)}'`;
}

function validateMssqlInputs(dbSource) {
    const identifierRegex = /^[A-Za-z0-9_-]+$/;
    const hostRegex = /^[A-Za-z0-9.-]+$/;
    const userRegex = /^[A-Za-z0-9_.@\\-]+$/;
    const instanceRegex = /^[A-Za-z0-9_-]+$/;
    const guidRegex = /^[A-Za-z0-9-]+$/;

    const dbName = String(dbSource.database_name || '').trim();
    if (!dbName) throw new Error('MSSQL database name is required');
    if (dbName !== 'all' && !identifierRegex.test(dbName)) {
        throw new Error('Invalid MSSQL database name. Allowed: letters, numbers, underscore, dash');
    }

    const host = dbSource.is_host_database ? 'host.docker.internal' : String(dbSource.hostname || 'localhost');
    if (!hostRegex.test(host)) {
        throw new Error('Invalid MSSQL hostname');
    }

    const user = String(dbSource.username || 'sa').trim();
    if (!userRegex.test(user)) {
        throw new Error('Invalid MSSQL username');
    }

    const rawPort = Number(dbSource.port || 1433);
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
        throw new Error('Invalid MSSQL port');
    }

    const instance = dbSource.instance ? String(dbSource.instance).trim() : '';
    if (instance && !instanceRegex.test(instance)) {
        throw new Error('Invalid MSSQL instance name');
    }

    const encrypt = dbSource.encrypt ? String(dbSource.encrypt) : 'true';
    if (!['true', 'false', 'strict'].includes(encrypt)) {
        throw new Error('Invalid MSSQL encrypt mode');
    }

    const auth_method = dbSource.auth_method || 'sql';
    if (!['sql', 'ad_password', 'service_principal'].includes(auth_method)) {
        throw new Error('Invalid MSSQL auth method');
    }

    let client_id = '';
    let tenant_id = '';
    if (auth_method === 'service_principal') {
        client_id = String(dbSource.client_id || '').trim();
        if (!client_id || !guidRegex.test(client_id)) {
            throw new Error('Service Principal requires a valid Client ID (Application ID)');
        }
        tenant_id = String(dbSource.tenant_id || '').trim();
        if (!tenant_id || !guidRegex.test(tenant_id)) {
            throw new Error('Service Principal requires a valid Tenant ID');
        }
    }

    return { dbName, host, user, port: rawPort, instance, encrypt, auth_method, client_id, tenant_id };
}

function validateHookDbInputs(dbSource) {
    const supported = ['mariadb', 'mysql', 'postgresql', 'mongodb'];
    if (!supported.includes(dbSource?.type)) {
        throw new Error(`Unsupported database type: ${dbSource?.type || 'unknown'}`);
    }

    const dbName = String(dbSource.database_name || '').trim();
    if (!dbName) {
        throw new Error(`${dbSource.type} database name is required`);
    }
    if (dbName !== 'all' && !/^[A-Za-z0-9_.-]+$/.test(dbName)) {
        throw new Error(`Invalid ${dbSource.type} database name`);
    }

    const host = dbSource.is_host_database ? 'host.docker.internal' : String(dbSource.hostname || 'localhost').trim();
    if (!/^[A-Za-z0-9.-]+$/.test(host)) {
        throw new Error(`Invalid ${dbSource.type} hostname`);
    }

    const rawPort = Number(dbSource.port || getDefaultPort(dbSource.type));
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
        throw new Error(`Invalid ${dbSource.type} port`);
    }

    const username = String(dbSource.username || '').trim();
    if (username && !/^[A-Za-z0-9_.@\\-]+$/.test(username)) {
        throw new Error(`Invalid ${dbSource.type} username`);
    }

    const authDb = String(dbSource.authentication_database || 'admin').trim();
    if (dbSource.type === 'mongodb' && authDb && !/^[A-Za-z0-9_.-]+$/.test(authDb)) {
        throw new Error('Invalid mongodb authentication database name');
    }

    const authMethod = dbSource.auth_method || 'password';
    if (!['password', 'aws_iam'].includes(authMethod)) {
        throw new Error(`Invalid auth method for ${dbSource.type}: ${authMethod}`);
    }
    if (authMethod === 'aws_iam' && !['postgresql', 'mysql', 'mariadb'].includes(dbSource.type)) {
        throw new Error(`AWS IAM authentication is not supported for ${dbSource.type}`);
    }

    let awsRegion = '';
    if (authMethod === 'aws_iam') {
        awsRegion = String(dbSource.aws_region || '').trim();
        if (!awsRegion) {
            throw new Error('AWS Region is required when using IAM authentication');
        }
        if (!/^[a-z]{2}(-[a-z]+-\d+)?$/.test(awsRegion)) {
            throw new Error('Invalid AWS Region format (e.g. us-east-1)');
        }
        if (!username) {
            throw new Error('Database username is required for AWS IAM authentication (the IAM-mapped DB user)');
        }
    }

    return { dbName, host, user: username, port: rawPort, authDb, authMethod, awsRegion };
}

module.exports = {
    getDefaultPort,
    shellSingleQuote,
    validateMssqlInputs,
    validateHookDbInputs,
};
