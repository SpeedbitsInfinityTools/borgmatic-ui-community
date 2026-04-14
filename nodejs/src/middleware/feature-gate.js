const { isFeatureAvailable } = require('../utils/edition');

const FEATURE_LABELS = {
    git_repos: 'Git repository backup',
    mssql: 'MS SQL Server backup',
    aws_iam: 'AWS IAM database authentication',
    director: 'Director mode',
};

function requireFeature(featureName) {
    return (req, res, next) => {
        if (isFeatureAvailable(featureName)) return next();
        const label = FEATURE_LABELS[featureName] || featureName;
        res.status(402).json({
            success: false,
            error: 'payment_required',
            detail: `${label} is only available in the Commercial edition.`,
            upgrade_url: 'https://www.speedbits.io',
            feature: featureName,
        });
    };
}

module.exports = { requireFeature };
