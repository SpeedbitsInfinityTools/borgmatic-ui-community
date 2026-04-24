#!/bin/bash
# =============================================================================
# Borgmatic UI Docker Entrypoint
# =============================================================================
# Runs as root on container start (from the image USER default), ensures that
# config/data/logs directories exist with the correct ownership, and then
# executes the main command as the desired runtime user.
#
# Runtime user selection
# ----------------------
# Priority (first match wins):
#
#   1. BORGMATIC_UI_RUN_AS env var
#        - "root" or "0"               -> run as root (no privilege drop)
#        - "node"                      -> run as node (UID 1000)
#        - numeric UID ("0" .. "65535") -> run as that UID
#        - any other string            -> treated as a username
#
#   2. If the compose file pins the container to a non-root user via
#      `user: "<uid>[:<gid>]"` AND that uid != 0, honour it (we already run
#      with those effective IDs and cannot change back up to root).
#
#   3. Fallback: drop to the `node` user. This matches the historical
#      behaviour of this image so existing deployments are unaffected.
#
# Why this exists
# ---------------
# The installer asks "Container user [default: root]" and passes `user: "0:0"`
# in the generated compose file. Before this change, the entrypoint hard-coded
# `su-exec node "$@"`, so the Node process always ran as UID 1000 regardless
# of what the installer requested. That caused EACCES errors whenever the UI
# tried to create host directories owned by root on the host (the common
# case on single-admin Ubuntu/Debian servers).
# =============================================================================

set -e

# -----------------------------------------------------------------------------
# 1. Decide which user the Node process should run as.
# -----------------------------------------------------------------------------
# If we've already been dropped to a non-root user by docker `user:` setting,
# we can't elevate back to root — honour what we got, but still make a
# best-effort to fix ownership on directories that we own.
CURRENT_UID="$(id -u)"

if [ "$CURRENT_UID" != "0" ]; then
    # Non-root start: cannot su-exec, just run the command as-is.
    # We still log the effective UID so installers that pinned the container
    # via compose `user: "<uid>:<gid>"` can verify the expected identity in
    # `docker logs` without having to exec into the container.
    echo "[entrypoint] Runtime user: uid $CURRENT_UID (non-root start, no drop)"
    echo "[entrypoint] Override with BORGMATIC_UI_RUN_AS=(root|node|<uid>|<name>) + compose user: \"0:0\""
    exec "$@"
fi

# We are root. Determine the target runtime user.
TARGET_USER_RAW="${BORGMATIC_UI_RUN_AS:-node}"

# Normalise. Accept "root"/"0" to mean "stay as root".
case "$TARGET_USER_RAW" in
    root|ROOT|0)
        TARGET_USER=""       # empty = no drop
        OWNER_SPEC="root:root"
        ;;
    node)
        TARGET_USER="node"
        OWNER_SPEC="node:node"
        ;;
    *)
        TARGET_USER="$TARGET_USER_RAW"
        # For ownership, use same value twice — works for both names and UIDs.
        OWNER_SPEC="${TARGET_USER_RAW}:${TARGET_USER_RAW}"
        ;;
esac

# -----------------------------------------------------------------------------
# 2. Ensure writable directories exist and are owned by the runtime user.
# -----------------------------------------------------------------------------
WRITABLE_DIRS=(
    "/app/config"
    "/app/data"
    "/app/logs"
    "/app/config/borgmatic.d"
)

for dir in "${WRITABLE_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
    fi
    # chown is a best-effort: bind-mounted volumes on certain filesystems
    # (CIFS, some FUSE) reject chown, and that's fine — the files on such
    # mounts are governed by the mount options, not kernel ownership.
    chown -R "$OWNER_SPEC" "$dir" 2>/dev/null || true
done

# SSH keys: only relevant when running as `node`; root reads /root/.ssh.
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" = "node" ] && [ -d "/home/node/.ssh" ]; then
    chown -R node:node /home/node/.ssh
    chmod 700 /home/node/.ssh
    chmod 600 /home/node/.ssh/* 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 3. Log the decision (helps debugging installs that misconfigure the UID).
# -----------------------------------------------------------------------------
if [ -z "$TARGET_USER" ]; then
    echo "[entrypoint] Runtime user: root (uid 0)"
else
    TARGET_UID="$(id -u "$TARGET_USER" 2>/dev/null || echo "$TARGET_USER")"
    echo "[entrypoint] Runtime user: $TARGET_USER (uid $TARGET_UID)"
fi
echo "[entrypoint] Override with BORGMATIC_UI_RUN_AS=(root|node|<uid>|<name>)"

# -----------------------------------------------------------------------------
# 4. Exec the main command as the chosen user.
# -----------------------------------------------------------------------------
if [ -z "$TARGET_USER" ]; then
    exec "$@"
else
    exec su-exec "$TARGET_USER" "$@"
fi
