/**
 * Shared SSH/SFTP password-auth flags.
 *
 * Why centralized:
 * - We must keep password-auth behavior identical across browse, test,
 *   create/restore, and BORG_RSH paths.
 * - If one path drifts (e.g. forgets PubkeyAuthentication=no), ssh may offer
 *   /root/.ssh keys first, remote fail2ban counts those rejects, and users get
 *   "kex_exchange_identification: read: Connection reset by peer".
 *
 * Compatibility note:
 * - Some servers disable direct "password" auth but allow
 *   "keyboard-interactive" (PAM). We prefer both, while still forcing away
 *   pubkey/GSSAPI to avoid key spray.
 */

const PASSWORD_AUTH_PREFERRED_METHODS = 'keyboard-interactive,password';

const PASSWORD_AUTH_SSH_FLAGS = [
    '-o', `PreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS}`,
    '-o', 'PubkeyAuthentication=no',
    '-o', 'GSSAPIAuthentication=no',
];

const PASSWORD_AUTH_SFTP_FLAGS = [
    `-oPreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS}`,
    '-oPubkeyAuthentication=no',
    '-oGSSAPIAuthentication=no',
];

// Returns the password-auth ssh options as a single space-separated string,
// for embedding in a command-line string (BORG_RSH, or an sshfs/sshpass
// invocation rendered into a generated bash script).
function buildPasswordSshArgString() {
    return `-o PreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS} -o PubkeyAuthentication=no -o GSSAPIAuthentication=no`;
}

// Back-compat alias (the args are identical for borg's BORG_RSH and any other
// sshpass+ssh/sshfs invocation — same SSH password-auth policy).
const buildBorgPasswordSshArgs = buildPasswordSshArgString;

module.exports = {
    PASSWORD_AUTH_PREFERRED_METHODS,
    PASSWORD_AUTH_SSH_FLAGS,
    PASSWORD_AUTH_SFTP_FLAGS,
    buildPasswordSshArgString,
    buildBorgPasswordSshArgs,
};
