#!/usr/bin/env node
/**
 * Edition Preparation Script (Single Image Architecture)
 * 
 * This script ALWAYS creates the Community edition stub files.
 * The single Docker image defaults to Community edition.
 * 
 * At runtime, the container startup script (start.sh) checks for:
 *   /app/commercial/director-server.js
 * 
 * If that file exists (injected by Infinity Tools), it's copied to enable
 * Commercial/Director mode. Otherwise, the built-in stub runs.
 * 
 * This approach:
 * - Builds ONE Docker image (simpler CI/CD)
 * - Community edition works out of the box
 * - Commercial edition requires Infinity Tools injection
 * - Same protection: stub returns 402 until real file is provided
 * 
 * Usage:
 *   node scripts/prepare-edition.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const NODEJS_DIR = path.join(ROOT_DIR, 'nodejs');

// Files that get stubbed for Community edition
// These return 402 Payment Required until the real files are injected
const DIRECTOR_FILES_TO_STUB = [
    {
        path: 'nodejs/src/services/director-server.js',
        stub: `/**
 * Director Server - Community Edition Stub
 * 
 * This stub is included in the default Docker image.
 * Director mode is only available in Commercial edition.
 * 
 * To enable Director mode:
 * 1. Deploy via Infinity Tools (https://www.speedbits.io)
 * 2. The real director-server.js will be injected at /app/commercial/
 * 3. Container startup will detect and activate Commercial edition
 */

class DirectorServerStub {
    async initialize(httpServer) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('⚠️  Director mode is only available in Commercial edition');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('');
        console.error('You are running the Community edition of Borgmatic UI.');
        console.error('Director mode requires the Commercial edition.');
        console.error('');
        console.error('To upgrade:');
        console.error('  1. Visit https://www.speedbits.io');
        console.error('  2. Deploy via Infinity Tools');
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('');
        throw new Error('Director mode requires Commercial edition');
    }

    getConnectedClients() {
        return [];
    }

    getAllClients() {
        return Promise.resolve([]);
    }

    async sendCommandToClient(clientId, command, params) {
        throw new Error('Director mode requires Commercial edition');
    }

    broadcastToClients(event, data) {
        // No-op in Community edition
    }

    disconnectClient(clientId) {
        // No-op in Community edition
    }

    approveClient(clientId, approvedBy, ipLocked) {
        throw new Error('Director mode requires Commercial edition');
    }

    rejectClient(clientId) {
        throw new Error('Director mode requires Commercial edition');
    }
}

module.exports = new DirectorServerStub();
`
    },
    {
        path: 'nodejs/src/routes/director.js',
        stub: `/**
 * Director Routes - Community Edition Stub
 * 
 * Returns 402 Payment Required for all Director API endpoints.
 * Upgrade to Commercial edition via Infinity Tools.
 */

const express = require('express');
const router = express.Router();

// All Director routes return 402 in Community edition
router.all('*', (req, res) => {
    res.status(402).json({
        success: false,
        error: 'payment_required',
        detail: 'Director mode is only available in the Commercial edition.',
        upgrade_url: 'https://www.speedbits.io',
        features: {
            available: ['standalone', 'client'],
            requires_upgrade: ['director']
        }
    });
});

module.exports = router;
`
    }
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🏗️  Borgmatic UI - Single Image Edition Preparation');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('📦 Building single Docker image with Community stubs');
console.log('   (Commercial features activated at runtime via file injection)');
console.log('');

// Step 1: Create stub files
console.log('📝 Step 1: Creating Community edition stub files');
for (const file of DIRECTOR_FILES_TO_STUB) {
    const fullPath = path.join(ROOT_DIR, file.path);
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, file.stub);
    console.log(`   ✓ Created stub: ${file.path}`);
}
console.log('');

// Step 2: Create edition marker file (defaults to Community)
console.log('📝 Step 2: Creating edition marker file');
const marker = {
    edition: 'community',
    features: ['standalone', 'client'],
    director_available: false,
    upgrade_url: 'https://www.speedbits.io',
    build_type: 'single-image',
    prepared_at: new Date().toISOString(),
    note: 'Commercial edition activated at runtime if /app/commercial/director-server.js exists'
};

const editionDir = path.join(NODEJS_DIR, 'src');
if (!fs.existsSync(editionDir)) {
    fs.mkdirSync(editionDir, { recursive: true });
}

fs.writeFileSync(
    path.join(editionDir, '.edition'),
    JSON.stringify(marker, null, 2)
);
console.log('   ✓ Created .edition marker (defaults to Community)');
console.log('');

// Step 3: Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Single image preparation complete!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('📋 Image Configuration:');
console.log('   • Default mode: Community edition');
console.log('   • Director routes: Stubbed (returns 402)');
console.log('   • Director service: Stubbed (throws error)');
console.log('');
console.log('🔓 To activate Commercial edition at runtime:');
console.log('   1. Mount real director-server.js to /app/commercial/');
console.log('   2. Container startup script detects and copies it');
console.log('   3. EDITION env var set to "commercial"');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
