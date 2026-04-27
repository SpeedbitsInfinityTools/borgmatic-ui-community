export interface Repository {
  id?: number | string;
  name: string;
  label?: string;
  path: string;
  encryption: string;
  compression?: string;
  /** Optional borgmatic log file path for backups using this repository */
  log_file_path?: string;
  last_backup?: string | null;
  total_size?: string | null;
  archive_count?: number;
  is_active?: boolean;
  isUsed?: boolean;
  usedInBackups?: string[];
  repository_type?: string;
  // Borg version (1.x or 2.x)
  borg_version?: '1.x' | '2.x';
  // Hetzner Storage Box: remote Borg version (borg-1.1, borg-1.2, borg-1.4)
  hetzner_borg_version?: string;
  // Read-only mode (monitor only - no backups allowed)
  read_only?: boolean;
  // Rclone-specific fields
  rclone_remote?: string;
  rclone_path?: string;
  // Other type-specific fields
  storage_mode?: string;
  local_path?: string;
  mount_path?: string;
  created_at?: string;
  updated_at?: string | null;
  // Lock status (detected when querying borg)
  is_locked?: boolean | null;
  lock_error?: string | null;
  // SSH/SFTP/Hetzner connection metadata (returned by /api/repositories/list)
  host?: string;
  port?: number;
  username?: string;
  ssh_key_id?: number | string | null;
  ssh_auth_method?: 'key' | 'password';
  // S3 metadata (non-sensitive)
  s3_endpoint?: string;
  s3_bucket?: string;
  s3_path?: string;
  s3_region?: string;
}

export interface CreateRepositoryForm {
  name: string;
  path: string;
  mount_path: string;
  local_path: string;
  encryption: string;
  compression: string;
  /** Optional borgmatic log file path */
  log_file_path?: string;
  passphrase: string;
  confirmPassphrase: string;
  repository_type: string;
  storage_mode: string;
  // Borg version selection
  borg_version: '1.x' | '2.x';
  // Hetzner Storage Box: remote Borg version (borg-1.1, borg-1.2, borg-1.4)
  hetzner_borg_version?: string;
  host: string;
  port: number;
  username: string;
  ssh_auth_method: 'key' | 'password';
  ssh_key_id: number | string | null;
  ssh_password: string;
  // S3 / Rclone fields
  s3_endpoint: string;
  s3_bucket: string;
  s3_path: string; // Path within bucket (e.g., /backups/repo-name)
  s3_region: string;
  s3_access_key: string;
  s3_secret_key: string;
  rclone_remote: string;
  rclone_path: string;
  // Read-only mode (monitor only)
  read_only: boolean;
}

export interface PathTestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
}

export interface MountTestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
}

export interface RemoteBorgVersionInfo {
  borg_installed: boolean;
  borg_major_version?: '1.x' | '2.x';
  borg_full_version?: string;
  available_borg_versions?: {
    default?: { majorVersion: '1.x' | '2.x'; fullVersion: string } | null;
    borg1?: { majorVersion: '1.x' | '2.x'; fullVersion: string } | null;
    borg2?: { majorVersion: '1.x' | '2.x'; fullVersion: string } | null;
    has_1x: boolean;
    has_2x: boolean;
  };
  install_hints?: {
    debian_ubuntu: string;
    fedora_rhel: string;
    arch: string;
    pip: string;
  };
}
