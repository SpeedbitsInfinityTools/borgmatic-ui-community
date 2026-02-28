/**
 * Vault Service - Community Edition Stub
 */

module.exports = {
    storePassphrase: () => {
        throw new Error('Vault service is only available in the Commercial edition.');
    },
    getPassphrase: () => null,
    deletePassphrase: () => {},
    getAllClientIds: () => [],
    deleteAllForClient: () => {},
};
