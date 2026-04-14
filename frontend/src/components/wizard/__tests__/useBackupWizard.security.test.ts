import { buildSyncCommand, enforceAwsIamTransport } from '../useBackupWizard';

describe('useBackupWizard security helpers', () => {
  describe('buildSyncCommand', () => {
    it('single-quotes paths to prevent shell expansion/injection', () => {
      const cmd = buildSyncCommand(
        {
          enabled: true,
          type: 'local',
          localPath: '/backup/$(touch /tmp/pwned)',
          rcloneRemote: '',
          rclonePath: '',
        },
        [{ path: '/repo/`id`' }]
      );

      expect(cmd).toBe("rclone sync '/repo/`id`' '/backup/$(touch /tmp/pwned)' --progress");
    });

    it('escapes embedded single quotes correctly', () => {
      const cmd = buildSyncCommand(
        {
          enabled: true,
          type: 'local',
          localPath: "/backup/o'hare",
          rcloneRemote: '',
          rclonePath: '',
        },
        [{ path: "/repo/o'hare" }]
      );

      expect(cmd).toContain("'\"'\"'");
      expect(cmd).toBe("rclone sync '/repo/o'\"'\"'hare' '/backup/o'\"'\"'hare' --progress");
    });
  });

  describe('enforceAwsIamTransport', () => {
    it('forces postgresql aws_iam ssl_mode from disable to require', () => {
      const source = { type: 'postgresql', auth_method: 'aws_iam', ssl_mode: 'disable' };
      const out = enforceAwsIamTransport(source);
      expect(out.ssl_mode).toBe('require');
    });

    it('forces mysql/mariadb aws_iam tls=true', () => {
      const mysqlOut = enforceAwsIamTransport({ type: 'mysql', auth_method: 'aws_iam', tls: false });
      const mariadbOut = enforceAwsIamTransport({ type: 'mariadb', auth_method: 'aws_iam', tls: false });
      expect(mysqlOut.tls).toBe(true);
      expect(mariadbOut.tls).toBe(true);
    });
  });
});
