/**
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
