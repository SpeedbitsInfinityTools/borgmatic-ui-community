/**
 * Generate shell scripts for database dump hooks.
 * Produces self-contained shell scripts with embedded Base64 metadata
 * for round-trip config extraction.
 */

const { validateMssqlInputs, validateHookDbInputs, shellSingleQuote } = require('./validators');

/**
 * Generate MSSQL dump script using sqlpackage for .bacpac export.
 */
function generateMssqlDumpScript(dbSource, passEnvVar, tempDir) {
    const validated = validateMssqlInputs(dbSource);
    const hostname = validated.host;
    const port = validated.port;
    const authMethod = validated.auth_method;

    const serverName = validated.instance
        ? `${hostname},${port}\\\\${validated.instance}`
        : `${hostname},${port}`;

    const sqlcmdServer = validated.instance
        ? `${hostname},${port}\\\\${validated.instance}`
        : `${hostname},${port}`;

    const encryptValue = validated.encrypt === 'true' ? 'True' 
        : validated.encrypt === 'false' ? 'False' 
        : 'Strict';
    const trustCertValue = dbSource.trustServerCert ? 'True' : 'False';

    const sqlcmdEncryptMode = validated.encrypt === 'false' ? 'disable' : validated.encrypt;
    const sqlcmdEncryptFlag = `-N ${sqlcmdEncryptMode}`;
    const sqlcmdTrustCert = dbSource.trustServerCert ? '-C' : '';

    const passwordRefQuoted = '"$DB_PASS"';

    let sqlcmdAuthArgs;
    if (authMethod === 'ad_password') {
        sqlcmdAuthArgs = `--authentication-method ActiveDirectoryPassword -U "${validated.user}" -P ${passwordRefQuoted}`;
    } else if (authMethod === 'service_principal') {
        sqlcmdAuthArgs = `--authentication-method ActiveDirectoryServicePrincipal -U "${validated.client_id}" -P ${passwordRefQuoted} --tenant-id "${validated.tenant_id}"`;
    } else {
        sqlcmdAuthArgs = `-U "${validated.user}" -P ${passwordRefQuoted}`;
    }

    let sqlpackageAuthArgs;
    if (authMethod === 'ad_password') {
        const connStr = `Server=tcp:${serverName};Authentication=Active Directory Password;User ID=${validated.user};Encrypt=${encryptValue};TrustServerCertificate=${trustCertValue}`;
        sqlpackageAuthArgs = { useConnectionString: true, connStrTemplate: connStr };
    } else if (authMethod === 'service_principal') {
        const connStr = `Server=tcp:${serverName};Authentication=Active Directory Service Principal;User ID=${validated.client_id};Encrypt=${encryptValue};TrustServerCertificate=${trustCertValue}`;
        sqlpackageAuthArgs = { useConnectionString: true, connStrTemplate: connStr };
    } else {
        sqlpackageAuthArgs = { useConnectionString: false };
    }

    const sqlcmdResolver = `SQLCMD_BIN="$(command -v sqlcmd 2>/dev/null || true)"; if [ -z "$SQLCMD_BIN" ]; then for _sc in /opt/mssql-tools18/bin/sqlcmd /opt/mssql-tools/bin/sqlcmd /usr/local/bin/sqlcmd "$HOME/.local/bin/sqlcmd"; do [ -x "$_sc" ] && SQLCMD_BIN="$_sc" && break; done; fi; if [ -z "$SQLCMD_BIN" ]; then echo "sqlcmd not found"; exit 1; fi`;

    const sqlpackageResolver = `SQLPACKAGE_BIN=""
for _sp in "$(command -v sqlpackage 2>/dev/null)" /opt/sqlpackage/sqlpackage /opt/dotnet-cli/.dotnet/tools/sqlpackage /usr/local/bin/sqlpackage "$HOME/.dotnet/tools/sqlpackage" /root/.dotnet/tools/sqlpackage; do
  [ -n "$_sp" ] && [ -x "$_sp" ] && "$_sp" /version >/dev/null 2>&1 && SQLPACKAGE_BIN="$_sp" && break
done
if [ -z "$SQLPACKAGE_BIN" ]; then echo "ERROR: sqlpackage not found or not functional."; echo "Install: dotnet tool install -g microsoft.sqlpackage"; echo "Or for Docker: check Dockerfile sqlpackage installation."; echo "Test: sqlpackage /version"; exit 1; fi`;

    const metadata = {
        type: 'mssql',
        database_name: validated.dbName,
        hostname,
        port,
        username: validated.user,
        instance: validated.instance,
        encrypt: validated.encrypt,
        trustServerCert: !!dbSource.trustServerCert,
        is_host_database: !!dbSource.is_host_database,
        auth_method: authMethod,
        client_id: validated.client_id || undefined,
        tenant_id: validated.tenant_id || undefined,
    };
    const metadataB64 = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');

    const buildSqlpackageCmd = (dbNameQuoted, dbNameRaw, targetFileRef) => {
        if (sqlpackageAuthArgs.useConnectionString) {
            return `"$SQLPACKAGE_BIN" /Action:Export \\
        /scs:"${sqlpackageAuthArgs.connStrTemplate};Password=\\"$DB_PASS_ESC\\";Initial Catalog=${dbNameRaw}" \\
        /TargetFile:${targetFileRef}`;
        }
        return `"$SQLPACKAGE_BIN" /Action:Export \\
        /SourceServerName:"${serverName}" \\
        /SourceDatabaseName:${dbNameQuoted} \\
        /SourceUser:"${validated.user}" \\
        /SourcePassword:"$DB_PASS" \\
        /SourceTrustServerCertificate:${trustCertValue} \\
        /SourceEncryptConnection:${encryptValue} \\
        /TargetFile:${targetFileRef}`;
    };

    const dbPassLine = passEnvVar
        ? `DB_PASS="$(printenv ${passEnvVar} 2>/dev/null || true)"`
        : `DB_PASS=${shellSingleQuote(String(dbSource.password || ''))}`;
    const dbPassEscLine = `DB_PASS_ESC="$(printf '%s' "$DB_PASS" | sed 's/"/""/g')"`;
    const tempDirQ = shellSingleQuote(tempDir);

    if (validated.dbName === 'all') {
        return `#!/bin/sh
# MSSQL export script - all user databases (using sqlpackage)
set -eu
# BORGMATIC_UI_MSSQL_META_B64:${metadataB64}
${dbPassLine}
${sqlpackageAuthArgs.useConnectionString ? dbPassEscLine : ''}
${sqlcmdResolver}
${sqlpackageResolver}
TMP_DIR=${tempDirQ}
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
echo "Listing MSSQL databases..."
"$SQLCMD_BIN" -S "${sqlcmdServer}" ${sqlcmdAuthArgs} ${sqlcmdEncryptFlag} ${sqlcmdTrustCert} -b -r 1 -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND name NOT IN ('master','tempdb','model','msdb')" | while IFS= read -r db; do
    [ -z "$db" ] && continue
    if ! printf '%s' "$db" | grep -Eq '^[A-Za-z0-9_-]+$'; then
        echo "Skipping MSSQL database with unsupported name: $db"
        continue
    fi
    echo "Exporting MSSQL database: $db"
    ${buildSqlpackageCmd('"$db"', '$db', '"$TMP_DIR/$db.bacpac"')}
done`;
    }

    return `#!/bin/sh
# MSSQL export script - single database: ${validated.dbName} (using sqlpackage)
set -eu
# BORGMATIC_UI_MSSQL_META_B64:${metadataB64}
${dbPassLine}
${sqlpackageAuthArgs.useConnectionString ? dbPassEscLine : ''}
${sqlpackageResolver}
TMP_DIR=${tempDirQ}
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
echo "Exporting MSSQL database: ${validated.dbName}"
${buildSqlpackageCmd(`"${validated.dbName}"`, validated.dbName, `"$TMP_DIR/${validated.dbName}.bacpac"`)}`;
}

/**
 * Generate dump script for MariaDB, MySQL, PostgreSQL, or MongoDB.
 */
function generateDbDumpScript(dbSource, passEnvVar, tempDir) {
    const validated = validateHookDbInputs(dbSource);
    const hostname = validated.host;
    const port = validated.port;
    const username = validated.user;
    const dbName = validated.dbName;
    const authDb = validated.authDb;
    const authMethod = validated.authMethod;
    const awsRegion = validated.awsRegion;
    const isAwsIam = authMethod === 'aws_iam';
    const hasEnvVar = !isAwsIam && typeof passEnvVar === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(passEnvVar);
    const passwordLiteral = hasEnvVar ? '' : (isAwsIam ? '' : String(dbSource.password || ''));

    const metadata = {
        type: dbSource.type,
        database_name: dbName,
        hostname,
        port,
        username,
        tls: dbSource.tls,
        ssl_mode: dbSource.ssl_mode || null,
        auth_method: authMethod,
        aws_region: awsRegion || null,
        authentication_database: dbSource.authentication_database,
        is_host_database: !!dbSource.is_host_database,
        db_password_env_var: hasEnvVar ? passEnvVar : null,
    };
    const metadataB64 = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');
    const metadataComment = `# BORGMATIC_UI_DB_META_B64:${metadataB64}`;

    let dbPassLine;
    if (isAwsIam) {
        const regionQ = shellSingleQuote(awsRegion);
        const hostQ = shellSingleQuote(hostname);
        dbPassLine = `echo "Generating AWS IAM auth token for ${dbSource.type} on ${hostname}:${port}..."
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws-cli is not installed. Cannot generate IAM auth token." >&2
  exit 1
fi
DB_PASS="$(aws rds generate-db-auth-token --hostname ${hostQ} --port ${port} --username ${shellSingleQuote(username)} --region ${regionQ})"
if [ -z "$DB_PASS" ]; then
  echo "ERROR: Failed to generate IAM auth token. Check AWS credentials and permissions." >&2
  exit 1
fi`;
    } else if (hasEnvVar) {
        dbPassLine = `DB_PASS="$(printenv ${passEnvVar} 2>/dev/null || true)"`;
    } else {
        dbPassLine = `DB_PASS=${shellSingleQuote(passwordLiteral)}`;
    }
    const hostQ = shellSingleQuote(hostname);
    const userQ = shellSingleQuote(username);
    const dbNameQ = shellSingleQuote(dbName);
    const authDbQ = shellSingleQuote(authDb);
    const tempDirQ = shellSingleQuote(tempDir);

    switch (dbSource.type) {
        case 'mariadb':
        case 'mysql': {
            const dumpCmd = dbSource.type === 'mariadb' ? 'mariadb-dump' : 'mysqldump';
            const tlsFlag = isAwsIam ? ' --ssl' : (dbSource.tls === false ? ' --skip-ssl' : '');
            if (dbName === 'all') {
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
echo "Dumping all ${dbSource.type} databases from ${hostname}:${port}..."
MYSQL_PWD="$DB_PASS" ${dumpCmd} -h ${hostQ} -P ${port} -u ${userQ} --single-transaction --all-databases${tlsFlag} > ${tempDirQ}/all-databases.sql
echo "Database dump completed: ${tempDir}/all-databases.sql"`;
            }
            return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
echo "Dumping ${dbSource.type} database '${dbName}' from ${hostname}:${port}..."
MYSQL_PWD="$DB_PASS" ${dumpCmd} -h ${hostQ} -P ${port} -u ${userQ} --single-transaction --databases ${dbNameQ}${tlsFlag} > ${tempDirQ}/${dbNameQ}.sql
echo "Database dump completed: ${tempDir}/${dbName}.sql"`;
        }

        case 'postgresql': {
            const pgpassLineQ = shellSingleQuote(`${hostname}:${port}:*:${username}:`);
            const pgSslMode = isAwsIam ? (dbSource.ssl_mode || 'require') : (dbSource.ssl_mode || '');
            const pgSslExport = pgSslMode ? `\nexport PGSSLMODE=${shellSingleQuote(pgSslMode)}` : '';
            if (dbName === 'all') {
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
export PGPASSFILE="$(mktemp)"${pgSslExport}
trap 'rm -f "$PGPASSFILE"' EXIT
printf "%s%s\\n" ${pgpassLineQ} "$DB_PASS" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
echo "Dumping all PostgreSQL databases from ${hostname}:${port}..."
pg_dumpall -h ${hostQ} -p ${port} -U ${userQ} -f ${tempDirQ}/all-databases.sql
echo "Database dump completed: ${tempDir}/all-databases.sql"`;
            }
            return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
export PGPASSFILE="$(mktemp)"${pgSslExport}
trap 'rm -f "$PGPASSFILE"' EXIT
printf "%s%s\\n" ${pgpassLineQ} "$DB_PASS" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
echo "Dumping PostgreSQL database '${dbName}' from ${hostname}:${port}..."
pg_dump -h ${hostQ} -p ${port} -U ${userQ} -d ${dbNameQ} -Fc -f ${tempDirQ}/${dbNameQ}.dump
echo "Database dump completed: ${tempDir}/${dbName}.dump"`;
        }

        case 'mongodb': {
            const authPart = username ? ` --username=${userQ} --password="$DB_PASS" --authenticationDatabase=${authDbQ}` : '';
            const mongoTlsFlag = dbSource.tls === true ? ' --tls' : '';
            if (dbName === 'all') {
                return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
echo "Dumping all MongoDB databases from ${hostname}:${port}..."
mongodump --host=${hostQ} --port=${port}${authPart}${mongoTlsFlag} --archive=${tempDirQ}/all-databases.archive
echo "Database dump completed: ${tempDir}/all-databases.archive"`;
            }
            return `#!/bin/sh
${metadataComment}
set -eu
${dbPassLine}
rm -rf ${tempDirQ}
mkdir -p ${tempDirQ}
echo "Dumping MongoDB database '${dbName}' from ${hostname}:${port}..."
mongodump --host=${hostQ} --port=${port} --db=${dbNameQ}${authPart}${mongoTlsFlag} --archive=${tempDirQ}/${dbNameQ}.archive
echo "Database dump completed: ${tempDir}/${dbName}.archive"`;
        }

        default:
            throw new Error(`Unsupported database type for dump script: ${dbSource.type}`);
    }
}

module.exports = {
    generateMssqlDumpScript,
    generateDbDumpScript,
};
