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
 *   "keyboard-interactive" (PAM). We prefer both.
 * - We do NOT pass GSSAPIAuthentication=no: Alpine's openssh (used in our
 *   image) is compiled WITHOUT GSSAPI, so that option is rejected outright with
 *   `command-line: Unsupported option "gssapiauthentication"` and the whole
 *   ssh/sftp/sshfs invocation fails. It's also unnecessary — limiting
 *   PreferredAuthentications to keyboard-interactive,password already prevents
 *   GSSAPI (and pubkey) from ever being attempted; PubkeyAuthentication=no is
 *   kept as belt-and-suspenders since it's a universally supported option.
 */

const PASSWORD_AUTH_PREFERRED_METHODS = 'keyboard-interactive,password';

const PASSWORD_AUTH_SSH_FLAGS = [
    '-o', `PreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS}`,
    '-o', 'PubkeyAuthentication=no',
];

const PASSWORD_AUTH_SFTP_FLAGS = [
    `-oPreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS}`,
    '-oPubkeyAuthentication=no',
];

// Returns the password-auth ssh options as a single space-separated string,
// for embedding in a command-line string (BORG_RSH, or an sshfs/sshpass
// invocation rendered into a generated bash script).
function buildPasswordSshArgString() {
    return `-o PreferredAuthentications=${PASSWORD_AUTH_PREFERRED_METHODS} -o PubkeyAuthentication=no`;
}

// sshfs-safe variant. sshfs runs every `-o` value through FUSE's option
// parser, which splits on commas BEFORE forwarding unknown options to ssh.
// So `-o PreferredAuthentications=keyboard-interactive,password` becomes the
// ssh option `PreferredAuthentications=keyboard-interactive` plus a bogus
// FUSE option `password`, and the mount dies with
// `fuse: unknown option(s): -o password`. There is no escaping mechanism, so
// for sshfs we must use a comma-free value: password-only. (Trade-off: a
// server that only allows keyboard-interactive PAM auth won't work over
// sshfs password mounts — but password is the overwhelmingly common case,
// and key auth is unaffected.)
function buildSshfsPasswordArgString() {
    return '-o PreferredAuthentications=password -o PubkeyAuthentication=no';
}

// Back-compat alias (the args are identical for borg's BORG_RSH and any other
// sshpass+ssh invocation — same SSH password-auth policy).
const buildBorgPasswordSshArgs = buildPasswordSshArgString;

module.exports = {
    PASSWORD_AUTH_PREFERRED_METHODS,
    PASSWORD_AUTH_SSH_FLAGS,
    PASSWORD_AUTH_SFTP_FLAGS,
    buildPasswordSshArgString,
    buildSshfsPasswordArgString,
    buildBorgPasswordSshArgs,
};
