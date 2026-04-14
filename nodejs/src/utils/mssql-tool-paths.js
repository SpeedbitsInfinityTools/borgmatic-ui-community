const fs = require('fs');

function getHomeCandidates(env = process.env) {
    const home = env.HOME || '/root';
    const sudoUser = env.SUDO_USER;
    const safeSudoUser = (typeof sudoUser === 'string' && /^[A-Za-z0-9_-]+$/.test(sudoUser))
        ? sudoUser
        : null;
    const sudoHome = safeSudoUser ? `/home/${safeSudoUser}` : null;
    return { home, sudoHome };
}

function getMssqlToolPathEntries(env = process.env) {
    const { home, sudoHome } = getHomeCandidates(env);
    return [
        `${home}/.dotnet/tools`,
        `${home}/.local/bin`,
        sudoHome ? `${sudoHome}/.dotnet/tools` : null,
        sudoHome ? `${sudoHome}/.local/bin` : null,
        '/opt/sqlpackage',
        '/opt/mssql-tools18/bin',
        '/opt/mssql-tools/bin',
    ].filter(Boolean);
}

function getSqlpackageCandidates(env = process.env) {
    const { home, sudoHome } = getHomeCandidates(env);
    return [
        null, // resolved via PATH (command -v)
        '/opt/sqlpackage/sqlpackage',
        '/opt/dotnet-cli/.dotnet/tools/sqlpackage',
        '/usr/local/bin/sqlpackage',
        `${home}/.dotnet/tools/sqlpackage`,
        sudoHome ? `${sudoHome}/.dotnet/tools/sqlpackage` : null,
    ].filter(Boolean);
}

function getSqlcmdCandidates(env = process.env) {
    const { home, sudoHome } = getHomeCandidates(env);
    return [
        null, // resolved via PATH (command -v)
        '/opt/mssql-tools18/bin/sqlcmd',
        '/opt/mssql-tools/bin/sqlcmd',
        '/usr/local/bin/sqlcmd',
        `${home}/.local/bin/sqlcmd`,
        sudoHome ? `${sudoHome}/.local/bin/sqlcmd` : null,
    ].filter(Boolean);
}

function appendExistingPaths(basePath, candidatePaths) {
    const extraPaths = candidatePaths.filter(p => {
        try { return fs.existsSync(p); } catch { return false; }
    });
    return [basePath, ...extraPaths].filter(Boolean).join(':');
}

module.exports = {
    getMssqlToolPathEntries,
    getSqlpackageCandidates,
    getSqlcmdCandidates,
    appendExistingPaths,
};
