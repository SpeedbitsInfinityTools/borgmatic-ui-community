/**
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
