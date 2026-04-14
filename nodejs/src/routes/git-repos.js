/**
 * Git Repos Routes - Community Edition Stub
 *
 * Returns 402 Payment Required for all Git repository API endpoints.
 * Upgrade to Commercial edition via Infinity Tools.
 */

const express = require('express');
const router = express.Router();

router.all('*', (req, res) => {
    res.status(402).json({
        success: false,
        error: 'payment_required',
        detail: 'Git repository backup is only available in the Commercial edition.',
        upgrade_url: 'https://www.speedbits.io',
        feature: 'git_repos',
    });
});

module.exports = router;
