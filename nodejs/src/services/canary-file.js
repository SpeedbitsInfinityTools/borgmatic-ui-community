/**
 * Canary File Service - Stealthy Ransomware Protection
 * 
 * Implements ransomware protection via hidden canary files.
 * Canary files have random names, random content, and are placed
 * in random locations to prevent ransomware from adapting to detect them.
 * 
 * IMPORTANT: Canary files are designed to look like normal application data.
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

// Lazy-load apprise to avoid circular dependencies
let appriseService = null;
const getAppriseService = () => {
    if (!appriseService) {
        appriseService = require('./apprise');
    }
    return appriseService;
};

// Canary manifest/config should live OUTSIDE the backed-up data so ransomware touching the
// backup scope doesn't also corrupt the manifest and prevent detection.
// In dev container, config.dataDir is /app/data (writable for the node user).
const CANARY_CONFIG_DIR = process.env.CANARY_CONFIG_DIR || path.join(config.dataDir, '.canary-config');
const CANARY_MANIFEST_FILE = path.join(CANARY_CONFIG_DIR, 'manifest.json');

// Base directory where canary files themselves are placed (should be WITHIN the backed-up scope).
// In our containerized dev setup, the Infinity Tools data lives under /host/opt/speedbits.
const CANARY_BASE_DIR = process.env.CANARY_BASE_DIR || '/host/opt/speedbits';

// Possible locations where canaries can be placed (within the backup scope)
const CANARY_LOCATIONS = [
    path.join(CANARY_BASE_DIR, '.cache'),
    path.join(CANARY_BASE_DIR, '.config'),
    path.join(CANARY_BASE_DIR, '.local'),
    path.join(CANARY_BASE_DIR, 'data'),
    path.join(CANARY_BASE_DIR, 'config'),
    path.join(CANARY_BASE_DIR, 'var'),
];

// File extensions that look normal (not obviously canary)
const STEALTH_EXTENSIONS = [
    '.dat',
    '.cache',
    '.tmp',
    '.bin',
    '.db',
    '.idx',
    '.lock',
];

// Fake prefixes that look like normal app files
const STEALTH_PREFIXES = [
    'cache_',
    'index_',
    'session_',
    'data_',
    'state_',
    'sync_',
    'tmp_',
    '.tmp_',
    '.cache_',
];

class CanaryFileService {
    constructor() {
        this.manifest = null;
    }

    /**
     * Initialize canary file system with random stealth canaries
     */
    async initialize(options = {}) {
        try {
            const count = options.canaryCount || 3; // Create multiple canaries

            // Create config directory
            await fs.ensureDir(CANARY_CONFIG_DIR);
            await fs.chmod(CANARY_CONFIG_DIR, 0o700);

            // Check if manifest exists
            if (await fs.pathExists(CANARY_MANIFEST_FILE)) {
                // Verify existing canaries
                this.manifest = await this.loadManifest();
                const status = await this.checkCanary();

                if (status.compromised) {
                    console.error('⚠️  WARNING: Canary files compromised!');
                    return { success: false, ...status };
                }

                console.log(`✅ Canary protection active (${this.manifest.canaries.length} stealth files)`);
                return { success: true, ...status };
            }

            // Create new canaries
            await this.createCanaryFiles(count);
            console.log(`✅ Canary protection initialized (${count} stealth files)`);

            return {
                success: true,
                message: `Created ${count} stealth canary files`,
                canary_count: count
            };
        } catch (error) {
            console.error('Failed to initialize canary files:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate random stealth filename
     */
    generateStealthFilename() {
        const prefix = STEALTH_PREFIXES[Math.floor(Math.random() * STEALTH_PREFIXES.length)];
        const ext = STEALTH_EXTENSIONS[Math.floor(Math.random() * STEALTH_EXTENSIONS.length)];
        const randomPart = crypto.randomBytes(8).toString('hex');
        return `${prefix}${randomPart}${ext}`;
    }

    /**
     * Generate random binary content that looks like app data
     */
    generateStealthContent() {
        // Generate random binary content (looks like serialized data)
        const size = 512 + Math.floor(Math.random() * 2048); // 512-2560 bytes
        return crypto.randomBytes(size);
    }

    /**
     * Get a random canary location, creating if needed
     */
    async getRandomLocation() {
        // Shuffle locations
        const shuffled = [...CANARY_LOCATIONS].sort(() => Math.random() - 0.5);

        for (const loc of shuffled) {
            try {
                await fs.ensureDir(loc);
                return loc;
            } catch (error) {
                // Skip if can't create
                continue;
            }
        }

        // Fallback
        const fallback = path.join(CANARY_BASE_DIR, '.canary-data');
        await fs.ensureDir(fallback);
        return fallback;
    }

    /**
     * Create multiple stealth canary files
     */
    async createCanaryFiles(count = 3) {
        const canaries = [];
        const usedPaths = new Set();

        for (let i = 0; i < count; i++) {
            const location = await this.getRandomLocation();
            let filename, fullPath;

            // Ensure unique path
            do {
                filename = this.generateStealthFilename();
                fullPath = path.join(location, filename);
            } while (usedPaths.has(fullPath));

            usedPaths.add(fullPath);

            // Generate content
            const content = this.generateStealthContent();
            const hash = this.calculateHashBuffer(content);

            // Write file
            await fs.writeFile(fullPath, content);

            // Make it look old (random timestamp in last 30 days)
            const randomAge = Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);
            const mtime = new Date(Date.now() - randomAge);
            await fs.utimes(fullPath, mtime, mtime);

            // Normal permissions (not read-only - that would be suspicious)
            await fs.chmod(fullPath, 0o644);

            canaries.push({
                path: fullPath,
                hash: hash,
                size: content.length,
                created: new Date().toISOString()
            });
        }

        // Save manifest (in secure location)
        this.manifest = {
            version: 2,
            created: new Date().toISOString(),
            canaries: canaries
        };

        await this.saveManifest();

        return canaries;
    }

    /**
     * Load manifest
     */
    async loadManifest() {
        try {
            const content = await fs.readFile(CANARY_MANIFEST_FILE, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }

    /**
     * Save manifest
     */
    async saveManifest() {
        await fs.writeFile(CANARY_MANIFEST_FILE, JSON.stringify(this.manifest, null, 2), 'utf8');
        await fs.chmod(CANARY_MANIFEST_FILE, 0o600);
    }

    /**
     * Check if all canary files are intact
     */
    async checkCanary() {
        try {
            // Load manifest if not loaded
            if (!this.manifest) {
                this.manifest = await this.loadManifest();
            }

            if (!this.manifest || !this.manifest.canaries) {
                return {
                    compromised: true,
                    reason: 'MANIFEST_MISSING',
                    message: 'Canary manifest not found - cannot verify integrity',
                    severity: 'critical'
                };
            }

            const results = [];
            let compromised = false;
            let reason = null;

            for (const canary of this.manifest.canaries) {
                const result = await this.checkSingleCanary(canary);
                results.push(result);

                if (result.compromised && !compromised) {
                    compromised = true;
                    reason = result.reason;
                }
            }

            if (compromised) {
                // Send security alert notification
                try {
                    const apprise = getAppriseService();
                    const compromisedFiles = results.filter(r => r.compromised);
                    const reasonText = reason === 'DELETED' ? 'deleted' :
                        reason === 'MODIFIED' ? 'modified' : 'compromised';

                    await apprise.sendSecurityAlert({
                        title: '🚨 SECURITY ALERT: Canary File Compromised',
                        body: `URGENT: ${compromisedFiles.length} canary file(s) ${reasonText}. ` +
                            `This may indicate ransomware or unauthorized access. ` +
                            `Backups have been stopped to prevent encrypting already-compromised data. ` +
                            `INVESTIGATE IMMEDIATELY!`
                    });
                } catch (notifyError) {
                    console.error('Failed to send security alert notification:', notifyError.message);
                }

                return {
                    compromised: true,
                    reason: reason,
                    message: 'One or more canary files have been modified - possible ransomware activity',
                    severity: 'critical',
                    details: results
                };
            }

            return {
                compromised: false,
                message: `All ${results.length} canary files intact`,
                canary_count: results.length
            };
        } catch (error) {
            return {
                compromised: true,
                reason: 'CHECK_FAILED',
                message: `Failed to check canaries: ${error.message}`,
                severity: 'critical',
                error: error.message
            };
        }
    }

    /**
     * Check single canary file
     */
    async checkSingleCanary(canary) {
        try {
            // Check existence
            if (!await fs.pathExists(canary.path)) {
                return {
                    path: canary.path,
                    compromised: true,
                    reason: 'DELETED'
                };
            }

            // Read and hash
            const content = await fs.readFile(canary.path);
            const currentHash = this.calculateHashBuffer(content);

            if (currentHash !== canary.hash) {
                return {
                    path: canary.path,
                    compromised: true,
                    reason: 'MODIFIED',
                    expected: canary.hash,
                    actual: currentHash
                };
            }

            return {
                path: canary.path,
                compromised: false
            };
        } catch (error) {
            return {
                path: canary.path,
                compromised: true,
                reason: 'ERROR',
                error: error.message
            };
        }
    }

    /**
     * Calculate SHA-256 hash of buffer
     */
    calculateHashBuffer(buffer) {
        return crypto
            .createHash('sha256')
            .update(buffer)
            .digest('hex');
    }

    /**
     * Get status for API (redacts actual file locations for security)
     */
    async getStatus() {
        const check = await this.checkCanary();

        if (!this.manifest) {
            return {
                enabled: false,
                message: 'Canary protection not initialized'
            };
        }

        // SECURITY: Don't expose actual file paths in API response!
        // (prevents ransomware from learning where canaries are)
        return {
            enabled: true,
            canary_count: this.manifest.canaries.length,
            version: this.manifest.version,
            created: this.manifest.created,
            compromised: check.compromised,
            message: check.message,
            reason: check.reason || null,
            severity: check.severity || null
            // NOTE: Intentionally NOT including check.details which contains file paths!
        };
    }

    /**
     * Reset canary files (creates new random ones)
     */
    async reset() {
        try {
            // Remove old canaries
            if (this.manifest && this.manifest.canaries) {
                for (const canary of this.manifest.canaries) {
                    try {
                        await fs.remove(canary.path);
                    } catch (e) {
                        // Ignore removal errors
                    }
                }
            }

            // Remove old manifest
            if (await fs.pathExists(CANARY_MANIFEST_FILE)) {
                await fs.remove(CANARY_MANIFEST_FILE);
            }

            // Clear cached manifest
            this.manifest = null;

            // Create new canaries
            await this.initialize({ canaryCount: 3 });

            return {
                success: true,
                message: 'Canary files reset with new random locations'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate pre-backup check command for Borgmatic
     * This checks all canaries via the manifest using jq for safe JSON parsing
     * Sends notification via API if canary is compromised
     */
    getPreBackupCommand(options = {}) {
        const apiUrl = options.apiUrl || process.env.BORGMATIC_UI_API_URL || 'http://localhost:8000';

        // Use jq for safe JSON parsing (handles special chars in paths)
        // Falls back to simple existence check if jq not available
        // Sends notification to API on failure
        return `MANIFEST="${CANARY_MANIFEST_FILE}"; ` +
            `API_URL="${apiUrl}"; ` +
            `send_alert() { ` +
            `  curl -s -X POST "$API_URL/api/backups/canary-alert" ` +
            `    -H "Content-Type: application/json" ` +
            `    -d "{\\"reason\\": \\"$1\\", \\"file_path\\": \\"$2\\"}" > /dev/null 2>&1 || true; ` +
            `}; ` +
            `if [ ! -f "$MANIFEST" ]; then ` +
            `  echo "❌ CANARY MANIFEST MISSING!"; ` +
            `  send_alert "MISSING" "$MANIFEST"; ` +
            `  exit 1; ` +
            `fi; ` +
            `if command -v jq >/dev/null 2>&1; then ` +
            `  jq -r '.canaries[].path' "$MANIFEST" | while IFS= read -r CANARY; do ` +
            `    if [ ! -f "$CANARY" ]; then ` +
            `      echo "❌ CANARY DELETED: $CANARY"; ` +
            `      send_alert "DELETED" "$CANARY"; ` +
            `      exit 1; ` +
            `    fi; ` +
            `  done || exit 1; ` +
            `else ` +
            `  grep -o '"path": "[^"]*"' "$MANIFEST" | cut -d'"' -f4 | while IFS= read -r CANARY; do ` +
            `    if [ ! -f "$CANARY" ]; then ` +
            `      echo "❌ CANARY DELETED: $CANARY"; ` +
            `      send_alert "DELETED" "$CANARY"; ` +
            `      exit 1; ` +
            `    fi; ` +
            `  done || exit 1; ` +
            `fi; ` +
            `echo "✅ Canary check passed"`;
    }

    /**
     * Get comprehensive pre-backup command with hash verification
     * This is more thorough but requires jq
     * Sends notification via API on failure
     */
    getPreBackupCommandWithHash(options = {}) {
        const apiUrl = options.apiUrl || process.env.BORGMATIC_UI_API_URL || 'http://localhost:8000';

        return `
MANIFEST="${CANARY_MANIFEST_FILE}"
API_URL="${apiUrl}"

send_alert() {
    curl -s -X POST "$API_URL/api/backups/canary-alert" \\
        -H "Content-Type: application/json" \\
        -d "{\\"reason\\": \\"$1\\", \\"file_path\\": \\"$2\\"}" > /dev/null 2>&1 || true
}

if [ ! -f "$MANIFEST" ]; then 
    echo "❌ CANARY MANIFEST MISSING!"
    send_alert "MISSING" "$MANIFEST"
    exit 1
fi

FAILED=0
FAIL_REASON=""
FAIL_PATH=""

while IFS= read -r line; do
    PATH_VAL=$(echo "$line" | jq -r '.path')
    HASH_VAL=$(echo "$line" | jq -r '.hash')
    
    if [ ! -f "$PATH_VAL" ]; then
        echo "❌ CANARY DELETED: $PATH_VAL"
        FAILED=1
        FAIL_REASON="DELETED"
        FAIL_PATH="$PATH_VAL"
    else
        ACTUAL_HASH=$(sha256sum "$PATH_VAL" | cut -d' ' -f1)
        if [ "$ACTUAL_HASH" != "$HASH_VAL" ]; then
            echo "❌ CANARY MODIFIED: $PATH_VAL"
            FAILED=1
            FAIL_REASON="MODIFIED"
            FAIL_PATH="$PATH_VAL"
        fi
    fi
done < <(cat "$MANIFEST" | jq -c '.canaries[]')

if [ $FAILED -eq 1 ]; then
    echo "❌ BACKUP ABORTED - Possible ransomware activity!"
    send_alert "$FAIL_REASON" "$FAIL_PATH"
    exit 1
fi

echo "✅ All canary files verified"
`.trim();
    }
}

module.exports = new CanaryFileService();
