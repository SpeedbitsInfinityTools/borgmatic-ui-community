/**
 * Default borgmatic lock_wait (seconds) written into generated job configs.
 */
const DEFAULT_LOCK_WAIT_SECONDS = 600;

/**
 * The value generated configs used before DEFAULT_LOCK_WAIT_SECONDS existed.
 */
const LEGACY_LOCK_WAIT_SECONDS = 60;

module.exports = {
    DEFAULT_LOCK_WAIT_SECONDS,
    LEGACY_LOCK_WAIT_SECONDS,
};
