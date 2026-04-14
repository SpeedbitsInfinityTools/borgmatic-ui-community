/**
 * Pre-flight checks for database backup CLI tools.
 * Verifies that required binaries (sqlcmd, sqlpackage, pg_dump, etc.)
 * are installed and functional before a backup config is saved or run.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const { getSqlpackageCandidates, getSqlcmdCandidates } = require('./mssql-tool-paths');

function findExecutable(name, candidates) {
    for (const candidate of candidates) {
        const bin = candidate || (() => {
            try {
                return execFileSync('which', [name], { encoding: 'utf8', timeout: 5000 }).trim();
            } catch { return null; }
        })();
        if (!bin) continue;
        try {
            if (!fs.existsSync(bin)) continue;
            fs.accessSync(bin, fs.constants.X_OK);
            return bin;
        } catch { /* not executable */ }
    }
    return null;
}

function isFunctional(bin, testArgs) {
    try {
        execFileSync(bin, testArgs, { encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
        return true;
    } catch (e) {
        const stderr = String(e?.stderr || '');
        const stdout = String(e?.stdout || '');
        const msg = String(e?.message || '');

        // Explicit hard failures: missing binary, loader, architecture mismatch.
        if (
            e?.status === 127 ||
            /not found/i.test(msg) ||
            /No such file or directory/i.test(stderr) ||
            /Exec format error/i.test(stderr) ||
            /cannot execute binary file/i.test(stderr) ||
            /error while loading shared libraries/i.test(stderr) ||
            /wrong ELF class/i.test(stderr)
        ) {
            return false;
        }

        // If process reached the executable and produced normal CLI output/help/version,
        // treat as functional even on non-zero code.
        if (
            /sqlpackage|usage|version/i.test(stderr) ||
            /sqlpackage|usage|version/i.test(stdout)
        ) {
            return true;
        }

        // Unknown failure mode: treat as non-functional to fail safe.
        return false;
    }
}

/**
 * Check whether MSSQL backup tools are available.
 * @returns {{ ok: boolean, sqlcmd: {found:boolean, path:string|null}, sqlpackage: {found:boolean, path:string|null}, errors: string[] }}
 */
function checkMssqlTools() {
    const result = {
        ok: true,
        sqlcmd: { found: false, path: null },
        sqlpackage: { found: false, path: null },
        errors: [],
    };

    // Check sqlcmd
    const sqlcmdPath = findExecutable('sqlcmd', getSqlcmdCandidates());
    if (sqlcmdPath && isFunctional(sqlcmdPath, ['--version'])) {
        result.sqlcmd = { found: true, path: sqlcmdPath };
    } else if (sqlcmdPath) {
        result.errors.push(`sqlcmd found at ${sqlcmdPath} but is not functional (wrong architecture or missing libraries).`);
        result.ok = false;
    } else {
        result.errors.push(
            'sqlcmd is not installed. It is required for MSSQL database listing (backup of "all" databases). ' +
            'Install go-sqlcmd: https://github.com/microsoft/go-sqlcmd/releases'
        );
        result.ok = false;
    }

    // Check sqlpackage
    const sqlpackagePath = findExecutable('sqlpackage', getSqlpackageCandidates());
    if (sqlpackagePath && isFunctional(sqlpackagePath, ['/version'])) {
        result.sqlpackage = { found: true, path: sqlpackagePath };
    } else if (sqlpackagePath) {
        result.errors.push(`sqlpackage found at ${sqlpackagePath} but is not functional (wrong architecture or missing libraries).`);
        result.ok = false;
    } else {
        result.errors.push(
            'sqlpackage is not installed. It is required for MSSQL database export (.bacpac). ' +
            'Install via: dotnet tool install -g microsoft.sqlpackage'
        );
        result.ok = false;
    }

    return result;
}

/**
 * Check whether AWS CLI is available (needed for IAM database auth).
 * @returns {{ ok: boolean, aws: {found: boolean, path: string|null}, errors: string[] }}
 */
function checkAwsTools() {
    const result = {
        ok: true,
        aws: { found: false, path: null },
        errors: [],
    };

    let awsPath = null;
    try {
        awsPath = execFileSync('which', ['aws'], { encoding: 'utf8', timeout: 5000 }).trim();
    } catch { /* not found via which */ }

    if (awsPath && fs.existsSync(awsPath)) {
        try {
            execFileSync(awsPath, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
            result.aws = { found: true, path: awsPath };
        } catch (e) {
            const out = String(e?.stdout || '') + String(e?.stderr || '');
            if (/aws-cli/i.test(out)) {
                result.aws = { found: true, path: awsPath };
            } else {
                result.errors.push(`aws found at ${awsPath} but is not functional.`);
                result.ok = false;
            }
        }
    } else {
        result.errors.push(
            'aws-cli is not installed. It is required for AWS IAM database authentication ' +
            '(generates temporary auth tokens via "aws rds generate-db-auth-token"). ' +
            'Install via: pip3 install awscli'
        );
        result.ok = false;
    }

    return result;
}

/**
 * Check tools for a given database type.
 * Returns { ok, errors[] } - currently only MSSQL and AWS have special tool requirements.
 */
function checkDbTools(dbType) {
    if (dbType === 'mssql') return checkMssqlTools();
    if (dbType === 'aws') return checkAwsTools();
    return { ok: true, errors: [] };
}

module.exports = { checkMssqlTools, checkAwsTools, checkDbTools };
