const express = require('express');
const router = express.Router();

// Default to OFF; enable by setting DEBUG_REPOSITORIES=true
const DEBUG = process.env.DEBUG_REPOSITORIES === 'true';
const debugLog = (...args) => DEBUG && console.log(...args);

// ALWAYS log module loading (critical for debugging)
console.log('🔧 [repositories/index.js] MODULE LOADING - Starting to load sub-routers...');
debugLog('🔧 [repositories/index.js] DEBUG mode enabled');

// Import all sub-routers
debugLog('🔧 [repositories/index.js] Loading list routes...');
const listRoutes = require('./list');
debugLog('🔧 [repositories/index.js] listRoutes type:', typeof listRoutes, 'is router:', typeof listRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading create routes...');
const createRoutes = require('./create');
debugLog('🔧 [repositories/index.js] createRoutes type:', typeof createRoutes, 'is router:', typeof createRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading update routes...');
const updateRoutes = require('./update');
debugLog('🔧 [repositories/index.js] updateRoutes type:', typeof updateRoutes, 'is router:', typeof updateRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading delete routes...');
const deleteRoutes = require('./delete');
debugLog('🔧 [repositories/index.js] deleteRoutes type:', typeof deleteRoutes, 'is router:', typeof deleteRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading passphrase routes...');
const passphraseRoutes = require('./passphrase');
debugLog('🔧 [repositories/index.js] passphraseRoutes type:', typeof passphraseRoutes, 'is router:', typeof passphraseRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading versions routes...');
const versionsRoutes = require('./versions');
debugLog('🔧 [repositories/index.js] versionsRoutes type:', typeof versionsRoutes, 'is router:', typeof versionsRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading testing routes...');
const testingRoutes = require('./testing');
debugLog('🔧 [repositories/index.js] testingRoutes type:', typeof testingRoutes, 'is router:', typeof testingRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading browsing routes...');
const browsingRoutes = require('./browsing');
debugLog('🔧 [repositories/index.js] browsingRoutes type:', typeof browsingRoutes, 'is router:', typeof browsingRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading mounting routes...');
const mountingRoutes = require('./mounting');
debugLog('🔧 [repositories/index.js] mountingRoutes type:', typeof mountingRoutes, 'is router:', typeof mountingRoutes === 'function');

debugLog('🔧 [repositories/index.js] Loading operations routes...');
const operationsRoutes = require('./operations');
debugLog('🔧 [repositories/index.js] operationsRoutes type:', typeof operationsRoutes, 'is router:', typeof operationsRoutes === 'function');

// Mount all sub-routers
// IMPORTANT: Mount specific routes BEFORE parameterized routes (like /:id)
// Express matches routes in order, so /rclone-remotes must come before /:id
debugLog('🔧 [repositories/index.js] Mounting browsing routes (specific routes first)...');
router.use('/', browsingRoutes);
debugLog('🔧 [repositories/index.js] Mounting testing routes...');
router.use('/', testingRoutes);
debugLog('🔧 [repositories/index.js] Mounting mounting routes...');
router.use('/', mountingRoutes);
debugLog('🔧 [repositories/index.js] Mounting operations routes...');
router.use('/', operationsRoutes);

// Non-parameterized routes before /:id handlers
debugLog('🔧 [repositories/index.js] Mounting versions routes...');
router.use('/', versionsRoutes);
debugLog('🔧 [repositories/index.js] Mounting list routes...');
router.use('/', listRoutes);
debugLog('🔧 [repositories/index.js] Mounting create routes...');
router.use('/', createRoutes);
debugLog('🔧 [repositories/index.js] Mounting passphrase routes...');
router.use('/', passphraseRoutes);

// Parameterized routes last
debugLog('🔧 [repositories/index.js] Mounting update routes...');
router.use('/', updateRoutes);
debugLog('🔧 [repositories/index.js] Mounting delete routes...');
router.use('/', deleteRoutes);
debugLog('✅ [repositories/index.js] All routes mounted successfully');

module.exports = router;
