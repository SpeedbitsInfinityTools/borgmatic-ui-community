jest.mock('../backup-manager', () => ({}));
jest.mock('../../routes/events', () => ({ eventManager: { broadcastEvent: jest.fn() } }));
jest.mock('../password-manager', () => ({}));
jest.mock('../log-manager', () => ({}));
jest.mock('../notification-router', () => ({}));

const backupExecutor = require('../backup-executor');

describe('getSiblingBackupsUsingRepo', () => {
    afterEach(() => backupExecutor.runningBackups.clear());

    const run = (id, name, repositories) => {
        backupExecutor.runningBackups.set(id, { backup: { name, repositories_summary: repositories } });
    };

    test('finds other running jobs on the same repository', () => {
        run('a', 'SpeedBits Database Backup', [{ path: 'ssh://u@box/./repo' }]);
        run('b', 'Publistic Database', [{ path: 'ssh://u@box/./repo' }]);
        run('c', 'Unrelated', [{ path: 'ssh://u@box/./other' }]);

        expect(backupExecutor.getSiblingBackupsUsingRepo('b', 'ssh://u@box/./repo'))
            .toEqual(['SpeedBits Database Backup']);
    });

    test('ignores the job itself and accepts plain-string repositories', () => {
        run('a', 'Self', ['/repo']);
        expect(backupExecutor.getSiblingBackupsUsingRepo('a', '/repo')).toEqual([]);

        run('b', 'Other', ['/repo']);
        expect(backupExecutor.getSiblingBackupsUsingRepo('a', '/repo')).toEqual(['Other']);
    });
});
