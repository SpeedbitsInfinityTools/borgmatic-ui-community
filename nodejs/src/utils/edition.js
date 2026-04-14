const fs = require('fs');
const path = require('path');

const EDITION_PATH = path.join(__dirname, '../.edition');

const COMMUNITY_DEFAULT = {
    edition: 'community',
    features: ['standalone', 'client'],
};

const COMMERCIAL_DEFAULT = {
    edition: 'commercial',
    features: ['director', 'standalone', 'client', 'git_repos', 'mssql', 'aws_iam'],
};

function getFallbackEdition() {
    return process.env.EDITION === 'commercial' ? COMMERCIAL_DEFAULT : COMMUNITY_DEFAULT;
}

function getEditionInfo() {
    try {
        if (fs.existsSync(EDITION_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(EDITION_PATH, 'utf8'));
            if (Array.isArray(parsed?.features) && typeof parsed?.edition === 'string') {
                return parsed;
            }
            console.warn('Edition file is invalid, using safe fallback');
        }
    } catch (e) {
        console.warn('Could not read edition info, using safe fallback:', e.message);
    }
    return getFallbackEdition();
}

function isFeatureAvailable(feature) {
    const edition = getEditionInfo();
    return edition.features.includes(feature);
}

module.exports = { getEditionInfo, isFeatureAvailable };
