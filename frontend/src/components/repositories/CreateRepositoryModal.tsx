import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { CreateRepositoryForm, PathTestResult, MountTestResult, Repository } from '../../types/repositories';
import { normalizePath, normalizeRclonePath, getEncryptionDescription, getCompressionDescription } from '../../utils/repositoryUtils';
import { useRepositoryMutations } from '../../hooks/useRepositories';
import PathCreationModal from './PathCreationModal';
import RcloneBrowserModal from './RcloneBrowserModal';
import S3BrowserModal from './S3BrowserModal';
import SSHBrowserModal from './SSHBrowserModal';
import PathSelectorField from '../PathSelectorField';
import FileExplorerModal from '../FileExplorerModal';

interface CreateRepositoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  sshKeysData?: any;
  repository?: Repository | null; // If provided, modal is in edit mode
}

const CreateRepositoryModal: React.FC<CreateRepositoryModalProps> = ({
  isOpen,
  onClose,
  sshKeysData,
  repository = null, // null = create mode, Repository = edit mode
}) => {
  const isEditMode = !!repository;
  const [createForm, setCreateForm] = useState<CreateRepositoryForm>({
    name: '',
    path: '/var/backups/borg',
    mount_path: '/mnt/rclone',
    local_path: '/var/backups/borg-local',
    // Must be valid for the default borg_version (1.x)
    encryption: 'repokey-blake2',
    compression: 'lz4',
    log_file_path: '',
    passphrase: '',
    confirmPassphrase: '',
    repository_type: 'local',
    storage_mode: 'sync',
    borg_version: '1.x', // Default to Borg 1.x (stable, production-ready)
    host: '',
    port: 22,
    username: '',
    ssh_auth_method: 'password',
    ssh_key_id: null,
    ssh_password: '',
    s3_endpoint: '',
    s3_bucket: '',
    s3_path: '/backups',
    s3_region: 'us-east-1',
    s3_access_key: '',
    s3_secret_key: '',
    rclone_remote: '',
    rclone_path: '',
    read_only: false,
  });

  const [showPassphrase, setShowPassphrase] = useState(false);
  const [pathTestResult, setPathTestResult] = useState<PathTestResult>({ status: 'idle', message: '' });
  const [mountTestResult, setMountTestResult] = useState<MountTestResult>({ status: 'idle', message: '' });
  const [showPathModal, setShowPathModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pathRequiresCreation, setPathRequiresCreation] = useState(false);
  const [confirmPassphraseError, setConfirmPassphraseError] = useState(false);
  const [discoveredRepositories, setDiscoveredRepositories] = useState<any[]>([]);
  const [selectedDiscoveredRepos, setSelectedDiscoveredRepos] = useState<Set<string>>(new Set());
  const [s3Providers] = useState([
    { name: 'AWS S3', endpoint: '', region: 'us-east-1', help: 'Amazon Web Services S3' },
    { name: 'Wasabi', endpoint: 's3.wasabisys.com', region: 'us-east-1', help: 'Hot Cloud Storage' },
    { name: 'Backblaze B2', endpoint: 's3.us-west-004.backblazeb2.com', region: 'us-west-004', help: 'Change region as needed' },
    { name: 'Hetzner Storage', endpoint: 'https://your-location.your-objectstorage.com', region: 'nbg1', help: 'Hetzner Object Storage (S3 compatible)' },
    { name: 'MinIO', endpoint: 'localhost:9000', region: 'us-east-1', help: 'Self-hosted S3 compatible' },
    { name: 'DigitalOcean Spaces', endpoint: 'nyc3.digitaloceanspaces.com', region: 'nyc3', help: 'Change region as needed' },
    { name: 'Custom', endpoint: '', region: 'us-east-1', help: 'Custom S3-compatible provider' },
  ]);
  const [selectedS3Provider, setSelectedS3Provider] = useState('AWS S3');
  const [rcloneRemotes, setRcloneRemotes] = useState<Array<{ name: string; type?: string }>>([]);
  const [loadingRcloneRemotes, setLoadingRcloneRemotes] = useState(false);
  const [rcloneRemotesToastShown, setRcloneRemotesToastShown] = useState(false);
  const [showRcloneBrowser, setShowRcloneBrowser] = useState(false);
  const [showS3Browser, setShowS3Browser] = useState(false);
  const [showSSHBrowser, setShowSSHBrowser] = useState(false);
  const [showLocalFileBrowser, setShowLocalFileBrowser] = useState(false);
  const [showMountPathBrowser, setShowMountPathBrowser] = useState(false);
  const [s3ConnectionTestResult, setS3ConnectionTestResult] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
    details?: string;
  }>({ status: 'idle', message: '' });
  const [s3Buckets, setS3Buckets] = useState<string[]>([]);
  const [loadingS3Buckets, setLoadingS3Buckets] = useState(false);
  // Remote Borg version info (for SSH repositories)
  const [remoteBorgVersion, setRemoteBorgVersion] = useState<{
    borg_installed: boolean;
    borg_major_version?: '1.x' | '2.x';
    borg_full_version?: string;
    has_1x?: boolean;
    has_2x?: boolean;
    install_hints?: Record<string, string>;
  } | null>(null);

  const [createSuccess, setCreateSuccess] = useState(false);
  
  const {
    createRepositoryMutation,
    updateRepositoryMutation,
    tryMountMutation,
  } = useRepositoryMutations({
    onCreateSuccess: () => {
      // Show success state briefly before closing
      setCreateSuccess(true);
      setTimeout(() => {
        resetForm();
        setCreateSuccess(false);
        onClose();
      }, 1500);
    },
    onUpdateSuccess: () => {
      resetForm();
      onClose();
    },
    onMountTestSuccess: (result) => {
      setMountTestResult(result);
    },
    onMountTestError: (error) => {
      setMountTestResult({ status: 'error', message: error });
    },
  });

  // Show loading state when creating repository
  const isCreating = createRepositoryMutation.isLoading;

  // Update createError when mutation fails
  useEffect(() => {
    if (createRepositoryMutation.isError) {
      const error = createRepositoryMutation.error as any;
      setCreateError(error.response?.data?.detail || error.message || 'Failed to create repository');
    } else {
      setCreateError(null);
    }
  }, [createRepositoryMutation.isError, createRepositoryMutation.error]);

  const resetForm = () => {
    setCreateForm({
      name: '',
      path: '/var/backups/borg',
      mount_path: '/mnt/rclone',
      local_path: '/var/backups/borg-local',
      // Must be valid for the default borg_version (1.x)
      encryption: 'repokey-blake2',
      compression: 'lz4',
      log_file_path: '',
      passphrase: '',
      confirmPassphrase: '',
      repository_type: 'local',
      storage_mode: 'sync',
      borg_version: '1.x',
      host: '',
      port: 22,
      username: '',
      ssh_auth_method: 'password' as 'key' | 'password',
      ssh_key_id: null,
      ssh_password: '',
      s3_endpoint: '',
      s3_bucket: '',
      s3_path: '/backups',
      s3_region: 'us-east-1',
      read_only: false,
      s3_access_key: '',
      s3_secret_key: '',
      rclone_remote: '',
      rclone_path: '',
    });
    setShowPassphrase(false);
    setPathTestResult({ status: 'idle', message: '' });
    setMountTestResult({ status: 'idle', message: '' });
    setCreateError(null);
    setPathRequiresCreation(false);
    setConfirmPassphraseError(false);
    setDiscoveredRepositories([]);
    setRemoteBorgVersion(null);
    setSelectedDiscoveredRepos(new Set());
    setSelectedS3Provider('AWS S3');
  };

  // Populate form from repository when in edit mode
  const populateFormFromRepository = (repo: Repository) => {
    // Extract SSH path components if it's an SSH/SFTP repository
    let host = '';
    let port = 22;
    let username = '';
    let repoPath = repo.path;

    if (repo.repository_type === 'ssh' || repo.repository_type === 'sftp' || repo.repository_type === 'hetzner') {
      const sshMatch = repo.path.match(/^ssh:\/\/([^@]+)@([^:]+):?(\d+)?(.+)$/);
      if (sshMatch) {
        username = sshMatch[1];
        host = sshMatch[2];
        port = sshMatch[3] ? parseInt(sshMatch[3]) : 22;
        repoPath = sshMatch[4];
      }
    }

    // Extract S3 path components if it's an S3 repository
    let s3AccessKey = '';
    let s3SecretKey = '';
    let s3Bucket = '';
    let s3Path = '';

    if (repo.repository_type === 's3' && repo.path.startsWith('s3:')) {
      const s3Match = repo.path.match(/^s3:([^:]+):([^@]+)@\/([^/]+)(.+)$/);
      if (s3Match) {
        s3AccessKey = s3Match[1];
        s3SecretKey = s3Match[2];
        s3Bucket = s3Match[3];
        s3Path = s3Match[4] || '/backups';
      }
    }

    setCreateForm({
      name: repo.name || '',
      path: repoPath,
      mount_path: repo.mount_path || '/mnt/rclone',
      local_path: repo.local_path || '/var/backups/borg-local',
      encryption: repo.encryption || 'repokey-blake2',
      compression: repo.compression || 'lz4',
      log_file_path: String((repo as any).log_file_path || ''),
      passphrase: '', // Never populate passphrase for security
      confirmPassphrase: '',
      repository_type: repo.repository_type || 'local',
      storage_mode: repo.storage_mode || 'sync',
      borg_version: repo.borg_version || '1.x',
      hetzner_borg_version: (repo as any).hetzner_borg_version || undefined,
      host: host,
      port: port,
      username: username,
      ssh_auth_method: ((repo as any).ssh_auth_method || ((repo as any).ssh_key_id ? 'key' : 'password')) as 'key' | 'password',
      ssh_key_id: (repo as any).ssh_key_id || null,
      ssh_password: '', // Never populate password for security
      s3_endpoint: (repo as any).s3_endpoint || '',
      s3_bucket: s3Bucket || (repo as any).s3_bucket || '',
      s3_path: s3Path || (repo as any).s3_path || '/backups',
      s3_region: (repo as any).s3_region || 'us-east-1',
      s3_access_key: s3AccessKey,
      s3_secret_key: s3SecretKey,
      rclone_remote: repo.rclone_remote || '',
      rclone_path: repo.rclone_path || '',
      read_only: repo.read_only ?? false,
    });

    // Set S3 provider based on endpoint
    if ((repo as any).s3_endpoint) {
      const provider = s3Providers.find(p =>
        p.endpoint === (repo as any).s3_endpoint ||
        (repo as any).s3_endpoint.includes(p.endpoint)
      );
      if (provider) {
        setSelectedS3Provider(provider.name);
      } else {
        setSelectedS3Provider('Custom');
      }
    }
  };

  // Ensure encryption always matches the selected Borg version.
  // If the current value isn't available for the selected version, reset to a safe default.
  useEffect(() => {
    if (!isOpen || isEditMode) return;

    const borgVersion = createForm.borg_version;
    const allowedForBorg2 = new Set([
      'repokey-blake2-aes-ocb',
      'repokey-blake2-chacha20-poly1305',
      'repokey-aes-ocb',
      'repokey-chacha20-poly1305',
      'keyfile-blake2-aes-ocb',
      'keyfile-blake2-chacha20-poly1305',
      'keyfile-aes-ocb',
      'keyfile-chacha20-poly1305',
      'authenticated-blake2',
      'authenticated',
      'none',
    ]);

    const allowedForBorg1 = new Set([
      'repokey-blake2',
      'repokey',
      'keyfile-blake2',
      'keyfile',
      'authenticated-blake2',
      'authenticated',
      'none',
    ]);

    const allowed = borgVersion === '2.x' ? allowedForBorg2 : allowedForBorg1;
    if (!allowed.has(createForm.encryption)) {
      const defaultEncryption = borgVersion === '2.x' ? 'repokey-blake2-aes-ocb' : 'repokey-blake2';
      setCreateForm(prev => ({ ...prev, encryption: defaultEncryption }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, createForm.borg_version]);

  useEffect(() => {
    if (isOpen) {
      if (repository) {
        // Edit mode: populate form from repository
        populateFormFromRepository(repository);
      } else {
        // Create mode: reset form
        resetForm();
      }
      // Reset per-open toast suppression
      setRcloneRemotesToastShown(false);
    }
  }, [isOpen, repository]);

  // Load rclone remotes ONLY when the user selects Rclone as repository type
  // (or when editing an existing rclone repo).
  useEffect(() => {
    if (!isOpen) return;
    if (createForm.repository_type !== 'rclone') return;
    // Avoid spamming if already loaded / loading
    if (loadingRcloneRemotes) return;
    if (rcloneRemotes.length > 0) return;
    loadRcloneRemotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, createForm.repository_type]);

  const loadRcloneRemotes = async () => {
    setLoadingRcloneRemotes(true);
    try {
      // First check if Rclone is installed on host
      const checkResponse = await fetch('/api/repositories/rclone-check', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });
      const checkResult = await checkResponse.json();

      if (!checkResult.success || !checkResult.data?.installed) {
        if (!rcloneRemotesToastShown) {
          const errorMsg = checkResult.data?.error || 'Rclone is not installed on the host system.';
          toast.error(`⚠️ ${errorMsg}`, { duration: 8000 });
          setRcloneRemotesToastShown(true);
        }
        setLoadingRcloneRemotes(false);
        return;
      }

      // Rclone is installed, now fetch remotes
      const response = await fetch('/api/repositories/rclone-remotes', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });
      const result = await response.json();
      if (result.success) {
        const remotes = result.data.remotes || [];
        setRcloneRemotes(remotes);

        if (remotes.length === 0 && !rcloneRemotesToastShown) {
          toast('ℹ️ Rclone is installed but no remotes are configured. Create remotes with with the Rclone Director UI application on the host.', {
            duration: 8000,
            icon: '📋'
          });
          setRcloneRemotesToastShown(true);
        }
      } else {
        if (!rcloneRemotesToastShown) {
          toast.error('Failed to load rclone remotes: ' + (result.error || 'Unknown error'));
          setRcloneRemotesToastShown(true);
        }
      }
    } catch (error) {
      if (!rcloneRemotesToastShown) {
        toast.error('Failed to load rclone remotes. Check server connection.');
        setRcloneRemotesToastShown(true);
      }
    } finally {
      setLoadingRcloneRemotes(false);
    }
  };

  const handleS3ProviderChange = (providerName: string) => {
    setSelectedS3Provider(providerName);
    const provider = s3Providers.find(p => p.name === providerName);
    if (provider) {
      setCreateForm({
        ...createForm,
        s3_endpoint: provider.endpoint,
        s3_region: provider.region,
      });
    }
  };

  const handleTryMount = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!createForm.rclone_remote || !createForm.mount_path) {
      toast.error('Please fill in Rclone Remote and Mount Path');
      return;
    }

    setMountTestResult({ status: 'testing', message: 'Testing mount...' });
    tryMountMutation.mutate({
      rclone_remote: createForm.rclone_remote,
      rclone_path: createForm.rclone_path || undefined,
      mount_path: createForm.mount_path,
    });
  };

  const testConnection = async () => {
    // Validate SSH credentials before testing
    if (createForm.repository_type === 'ssh' || createForm.repository_type === 'sftp' || createForm.repository_type === 'hetzner') {
      if (createForm.ssh_auth_method === 'key' && !createForm.ssh_key_id) {
        toast.error('Please select an SSH key first');
        return;
      }
      if (createForm.ssh_auth_method === 'password' && (!createForm.ssh_password || createForm.ssh_password.trim().length === 0)) {
        toast.error('Please enter SSH password first');
        return;
      }
    }

    setPathTestResult({ status: 'testing', message: `Testing ${createForm.repository_type} connection...` });

    try {
      const response = await fetch('/api/repositories/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          repository_type: createForm.repository_type,
          path: createForm.path,
          host: createForm.host,
          port: createForm.port,
          username: createForm.username,
          ssh_key_id: createForm.ssh_key_id,
          ssh_auth_method: createForm.ssh_auth_method,
          ssh_password: createForm.ssh_password,
          s3_endpoint: createForm.s3_endpoint,
          s3_bucket: createForm.s3_bucket,
          s3_region: createForm.s3_region,
          s3_access_key: createForm.s3_access_key,
          s3_secret_key: createForm.s3_secret_key,
          rclone_remote: createForm.rclone_remote,
          rclone_path: createForm.rclone_path,
          discover_repositories: createForm.repository_type === 'ssh', // Auto-discover for SSH
        })
      });

      const result = await response.json();

      if (result.success) {
        if (result.data?.requires_creation && createForm.repository_type === 'local') {
          setPathRequiresCreation(true);
          setPathTestResult({
            status: 'error',
            message: 'Path does not exist. Click "Create Path" to create it, or test again after creating it manually.'
          });
        } else {
          setPathRequiresCreation(false);
          let message = result.data?.message || 'Connection successful and writable';
          let status: 'success' | 'error' = 'success';

          // Check for Borg installation warning for SSH mode (including Hetzner)
          const isSSHType = createForm.repository_type === 'ssh' || createForm.repository_type === 'hetzner';
          if (isSSHType && result.data?.borg_installed === false) {
            status = 'error';
            message = result.data?.warning || 'Borg is not installed on the remote system';
            toast.error('Borg is not installed on the remote system. Please install Borg or use SFTP mode.');
            // Store install hints for display
            setRemoteBorgVersion({
              borg_installed: false,
              install_hints: result.data?.install_hints
            });
          } else if (isSSHType && result.data?.borg_installed === true) {
            // Store remote Borg version info
            const availableVersions = result.data?.available_borg_versions;
            setRemoteBorgVersion({
              borg_installed: true,
              borg_major_version: result.data?.borg_major_version,
              borg_full_version: result.data?.borg_full_version,
              has_1x: availableVersions?.has_1x || false,
              has_2x: availableVersions?.has_2x || false
            });

            // Check version compatibility
            const selectedVersion = createForm.borg_version;
            const remoteHasSelectedVersion =
              (selectedVersion === '1.x' && availableVersions?.has_1x) ||
              (selectedVersion === '2.x' && availableVersions?.has_2x);

            if (!remoteHasSelectedVersion) {
              status = 'error';
              const availableStr = availableVersions?.has_1x && availableVersions?.has_2x
                ? 'Borg 1.x and 2.x'
                : availableVersions?.has_1x ? 'Borg 1.x only' : 'Borg 2.x only';
              message = `Remote server has ${availableStr}, but you selected Borg ${selectedVersion}. Please change your Borg version selection.`;
              toast.error(`Version mismatch: Remote has ${availableStr}, you selected ${selectedVersion}`);
            } else {
              message = `Connection successful. Remote has Borg ${result.data?.borg_full_version || result.data?.borg_major_version}.`;

              // Check write test result
              const writeTest = result.data?.write_test;
              if (writeTest?.tested) {
                if (writeTest.writable) {
                  message += ' Path is writable.';
                } else {
                  status = 'error';
                  message += ` ${writeTest.message || 'Path is not writable.'}`;
                  toast.error('Remote path is not writable');
                }
              }
            }

            // Handle discovered repositories
            if (result.data?.discovered_repositories && result.data.discovered_repositories.length > 0) {
              setDiscoveredRepositories(result.data.discovered_repositories);
              setSelectedDiscoveredRepos(new Set()); // Reset selection
            } else {
              setDiscoveredRepositories([]);
            }
          } else if (!isSSHType) {
            // Clear remote Borg version for non-SSH types
            setRemoteBorgVersion(null);
          }

          // For SFTP or cases where Borg check was skipped, still check write test
          if (result.data?.write_test?.tested && !message.includes('writable')) {
            const writeTest = result.data.write_test;
            if (writeTest.writable) {
              message += ' Path is writable.';
            } else {
              status = 'error';
              message += ` ${writeTest.message || 'Path is not writable.'}`;
            }
          }

          setPathTestResult({
            status,
            message
          });
        }
      } else {
        setPathRequiresCreation(false);
        setPathTestResult({
          status: 'error',
          message: result.detail || 'Connection test failed'
        });
      }
    } catch (error: any) {
      setPathTestResult({
        status: 'error',
        message: error.message || 'Failed to test connection'
      });
    }
  };

  const createPath = async () => {
    try {
      setPathTestResult({ status: 'testing', message: 'Creating path...' });
      const response = await fetch('/api/repositories/create-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({ path: createForm.path })
      });

      const result = await response.json();

      if (result.success) {
        setPathRequiresCreation(false);
        setPathTestResult({ status: 'success', message: 'Path created successfully' });
        setShowPathModal(false);
        toast.success('Path created successfully');
      } else {
        setPathTestResult({ status: 'error', message: result.detail || result.message || 'Failed to create path' });
        setShowPathModal(false);
        toast.error(result.detail || result.message || 'Failed to create path');
      }
    } catch (error: any) {
      setPathTestResult({ status: 'error', message: error.message || 'Failed to create path' });
      setShowPathModal(false);
      toast.error('Failed to create path');
    }
  };

  const handleCreateRepository = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passphrase confirmation
    if (createForm.encryption !== 'none') {
      if (!createForm.confirmPassphrase || createForm.confirmPassphrase.trim() === '') {
        setConfirmPassphraseError(true);
        toast.error('Please confirm the passphrase');
        return;
      }
      if (createForm.passphrase !== createForm.confirmPassphrase) {
        setConfirmPassphraseError(true);
        toast.error('Passphrases do not match');
        return;
      }
      setConfirmPassphraseError(false);
    }

    // Validate SSH credentials
    if (createForm.repository_type === 'ssh' || createForm.repository_type === 'sftp' || createForm.repository_type === 'hetzner') {
      if (createForm.ssh_auth_method === 'key' && !createForm.ssh_key_id) {
        toast.error('Please select an SSH key');
        return;
      }
      if (createForm.ssh_auth_method === 'password' && (!createForm.ssh_password || createForm.ssh_password.trim().length === 0)) {
        toast.error('SSH password is required');
        return;
      }
    }

    // For SSH/Hetzner types, validate remote Borg version compatibility
    if ((createForm.repository_type === 'ssh' || createForm.repository_type === 'hetzner') && remoteBorgVersion) {
      if (!remoteBorgVersion.borg_installed) {
        toast.error('Borg is not installed on the remote server. Please install Borg or use SFTP mode.');
        return;
      }
      const versionCompatible =
        (createForm.borg_version === '1.x' && remoteBorgVersion.has_1x) ||
        (createForm.borg_version === '2.x' && remoteBorgVersion.has_2x);
      if (!versionCompatible) {
        toast.error(`Version mismatch: You selected Borg ${createForm.borg_version}, but remote doesn't have it. Please change your Borg version selection.`);
        return;
      }
    }

    // Test path before creating repository (skip for cloud storage with Borg 2.x)
    const isCloudWithBorg2 = (createForm.repository_type === 'rclone' || createForm.repository_type === 's3') &&
      createForm.borg_version === '2.x';
    if (!isCloudWithBorg2 && pathTestResult.status !== 'success') {
      toast.error('Please test the path first');
      return;
    }

    // Normalize all paths before submission
    const normalizedForm = { ...createForm };
    
    // For cloud storage with Borg 2.x, set storage_mode to 'native' for backend compatibility
    if (isCloudWithBorg2) {
      normalizedForm.storage_mode = 'native';
    }

    // Normalize repository path (local or cloud)
    if (normalizedForm.path) {
      const pathType = isCloudWithBorg2 ? 'cloud' : 'local';
      const normalized = normalizePath(normalizedForm.path, pathType);
      if (!normalized && normalizedForm.path.trim()) {
        return;
      }
      normalizedForm.path = normalized;
    }

    // Local path normalization (for backward compatibility)
    if (normalizedForm.local_path) {
      const normalized = normalizePath(normalizedForm.local_path, 'local');
      if (!normalized && normalizedForm.local_path.trim()) {
        return;
      }
      normalizedForm.local_path = normalized;
    }

    // Normalize log_file_path (optional)
    if (normalizedForm.log_file_path) {
      const normalized = normalizePath(normalizedForm.log_file_path, 'local');
      if (!normalized && normalizedForm.log_file_path.trim()) {
        return;
      }
      normalizedForm.log_file_path = normalized;
    }

    // Normalize rclone_path
    if (normalizedForm.rclone_path) {
      const normalized = normalizePath(normalizedForm.rclone_path, 'cloud');
      if (!normalized && normalizedForm.rclone_path.trim()) {
        return;
      }
      normalizedForm.rclone_path = normalized;
    }

    // Normalize S3 paths
    if (normalizedForm.s3_bucket) {
      normalizedForm.s3_bucket = normalizedForm.s3_bucket.trim();
    }

    if (isEditMode && repository) {
      // Edit mode: call update mutation
      updateRepositoryMutation.mutate({
        path: repository.path, // Original path for identification
        ...normalizedForm
      });
    } else {
      // Create mode: call create mutation
      createRepositoryMutation.mutate(normalizedForm);
    }
  };

  const updatePathForDirectRclone = (mountPath: string, rclonePath: string) => {
    const normalizedRclonePath = rclonePath.replace(/^\/+/, '').replace(/\/+$/, '');
    return normalizedRclonePath
      ? `${mountPath}/${normalizedRclonePath}/borg`
      : `${mountPath}/borg`;
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 py-8">
        <div className="relative mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white mb-8">
          {/* Success overlay */}
          {createSuccess && (
            <div className="absolute inset-0 bg-white bg-opacity-95 flex items-center justify-center z-50 rounded-md">
              <div className="text-center">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-2" />
                <p className="text-lg font-medium text-gray-900">Repository Created!</p>
                <p className="text-sm text-gray-600 mt-1">Closing...</p>
              </div>
            </div>
          )}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {isEditMode ? 'Edit Repository' : 'Create Repository'}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRepository} className="space-y-4">
              {/* Repository Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Repository Name</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter repository name"
                  required
                />
              </div>

              {/* Borg Version Selection */}
              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Borg Version</label>
                  <select
                    value={createForm.borg_version}
                    disabled={createForm.repository_type === 'hetzner'} // Hetzner only supports Borg 1.x
                    onChange={(e) => {
                      const newVersion = e.target.value as '1.x' | '2.x';
                      
                      // Prevent Borg 2.x for Hetzner
                      if (newVersion === '2.x' && createForm.repository_type === 'hetzner') {
                        toast.error('Hetzner Storage Boxes only support Borg 1.x');
                        return;
                      }
                      
                      // Update encryption to version-appropriate default
                      const defaultEncryption = newVersion === '2.x'
                        ? 'repokey-blake2-aes-ocb'
                        : 'repokey-blake2';
                      setCreateForm({
                        ...createForm,
                        borg_version: newVersion,
                        encryption: defaultEncryption,
                      });
                      // Reset path test when Borg version changes (need to re-verify compatibility)
                      if ((createForm.repository_type === 'ssh' || createForm.repository_type === 'hetzner') && remoteBorgVersion) {
                        setPathTestResult({ status: 'idle', message: '' });
                      }
                    }}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="1.x">Borg 1.x (Stable, Production-Ready)</option>
                    <option value="2.x" disabled={createForm.repository_type === 'hetzner'}>
                      Borg 2.x (Improved, not yet for production){createForm.repository_type === 'hetzner' ? ' - Not available for Hetzner' : ''}
                    </option>
                  </select>
                  {createForm.repository_type === 'hetzner' && (
                    <p className="mt-1 text-xs text-amber-600">
                      ⚠️ Hetzner Storage Boxes only support Borg 1.x (versions 1.1, 1.2, 1.4)
                    </p>
                  )}
                  {createForm.borg_version === '2.x' && createForm.repository_type !== 'hetzner' && (
                    <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-800">
                        <strong>Note:</strong> Borg 2.x offers modern encryption, faster deduplication, and efficient archive browsing. However, the Borg team does not recommend for production, use at your own discretion!
                      </p>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {createForm.borg_version === '1.x'
                      ? '📦 Borg 1.x is widely deployed and stable. Recommended for production use.'
                      : '🧪 Borg 2.x is the next generation with improved features, but still in beta.'}
                  </p>
                </div>
              )}

              {/* Repository Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Repository Type</label>
                <select
                  value={createForm.repository_type}
                  disabled={isEditMode} // Cannot change repository type after creation
                  onChange={(e) => {
                    const newType = e.target.value;
                    const isRcloneOrS3 = newType === 'rclone' || newType === 's3';
                    const isHetzner = newType === 'hetzner';
                    
                    // Hetzner only supports Borg 1.x - force switch if needed
                    let newBorgVersion = createForm.borg_version;
                    const isForcingBorg1 = isHetzner && createForm.borg_version === '2.x';
                    if (isForcingBorg1) {
                      toast('Hetzner Storage Boxes only support Borg 1.x. Switching to Borg 1.x.', {
                        icon: '⚠️',
                        duration: 5000,
                      });
                      newBorgVersion = '1.x';
                    }
                    
                    // Note: S3 and Rclone require Borg 2.x - we show a warning in the UI
                    // but don't auto-switch here. The Create button will be disabled instead.
                    
                    const forcedEncryption = newBorgVersion === '2.x'
                      ? 'repokey-blake2-aes-ocb'
                      : 'repokey-blake2';
                    
                    setCreateForm({
                      ...createForm,
                      repository_type: newType,
                      borg_version: newBorgVersion,
                      encryption: isForcingBorg1 ? forcedEncryption : createForm.encryption,
                      path: isHetzner ? './backups' : '/var/backups/borg',
                      // Hetzner Storage Box defaults
                      port: isHetzner ? 23 : (newType === 'ssh' || newType === 'sftp' ? 22 : createForm.port),
                      host: isHetzner ? 'uXXXXXX.your-storagebox.de' : (newType === 'ssh' || newType === 'sftp' ? createForm.host : ''),
                      username: isHetzner ? 'uXXXXXX' : (newType === 'ssh' || newType === 'sftp' ? createForm.username : ''),
                      hetzner_borg_version: isHetzner ? 'borg-1.4' : undefined, // Default to latest Borg 1.x on Hetzner
                      rclone_remote: newType === 'rclone' ? createForm.rclone_remote : '',
                      rclone_path: newType === 'rclone' ? createForm.rclone_path : '',
                      s3_endpoint: newType === 's3' ? createForm.s3_endpoint : '',
                      s3_bucket: newType === 's3' ? createForm.s3_bucket : '',
                      s3_path: newType === 's3' ? createForm.s3_path : '/backups',
                      s3_region: newType === 's3' ? createForm.s3_region : 'us-east-1',
                      s3_access_key: newType === 's3' ? createForm.s3_access_key : '',
                      s3_secret_key: newType === 's3' ? createForm.s3_secret_key : ''
                    });
                    setPathTestResult({ status: 'idle', message: '' });
                    setS3ConnectionTestResult({ status: 'idle', message: '' });
                    setRemoteBorgVersion(null);
                    if (newType === 'rclone') {
                      loadRcloneRemotes();
                    }
                  }}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="local">Local Filesystem</option>
                  <option value="ssh">SSH (Secure Shell)</option>
                  <option value="hetzner">Hetzner Storage Box</option>
                  <option value="sftp">SFTP (SSH File Transfer)</option>
                  <option value="s3">S3 (Amazon S3 compatible)</option>
                  <option value="rclone">Rclone (100+ cloud providers)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {createForm.repository_type === 'local' && '💾 Store backups on local or mounted filesystem'}
                  {createForm.repository_type === 'ssh' && '🔐 Store backups on remote server via SSH (most secure)'}
                  {createForm.repository_type === 'hetzner' && '📦 Hetzner Storage Box with pre-installed Borg (SSH on port 23)'}
                  {createForm.repository_type === 'sftp' && '📁 Store backups on remote server via SFTP'}
                  {createForm.repository_type === 's3' && '☁️ Store backups on S3 (Amazon, Wasabi, Backblaze B2, MinIO)'}
                  {createForm.repository_type === 'rclone' && '🌐 Store backups on any cloud provider (Google Drive, Dropbox, Azure, etc.)'}
                </p>
              </div>

              {/* Read-Only Mode */}
              <div className="p-4 border rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.read_only}
                    onChange={(e) => setCreateForm({ ...createForm, read_only: e.target.checked })}
                    className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="font-medium text-gray-900">Monitor Only (Read-Only)</span>
                    <p className="text-sm text-gray-500 mt-1">
                      View and restore existing archives only. Use this for repositories managed by other backup tools or systems.
                      <span className="block mt-1 text-xs text-blue-600">
                        ℹ️ Read-only repositories cannot be used for creating new backups or in scheduled jobs.
                      </span>
                    </p>
                  </div>
                </label>
              </div>

              {/* Cloud Storage Info for Borg 1.x - Explain that cloud storage requires Borg 2.x */}
              {(createForm.repository_type === 'rclone' || createForm.repository_type === 's3') && createForm.borg_version === '1.x' && (
                <div className="p-4 bg-amber-50 border-2 border-amber-400 rounded-lg">
                  <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-900 mb-2">
                        ⚠️ {createForm.repository_type === 's3' ? 'S3 Storage' : 'Rclone Cloud Storage'} Requires Borg 2.x
                      </div>
                      <div className="text-sm text-amber-800 space-y-2">
                        <p>
                          <strong>Borg 1.x does not support native cloud storage.</strong> To use {createForm.repository_type === 's3' ? 'S3' : 'Rclone'} as a repository, 
                          please select <strong>Borg 2.x</strong> in the Borg Version selector above.
                        </p>
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                          <div className="font-medium text-blue-900 mb-1">💡 Alternative: Sync Local Repository to Cloud</div>
                          <p className="text-blue-800 text-xs">
                            If you need to use Borg 1.x, create a <strong>local repository</strong> and add an <strong>"After Backup" script</strong> in your 
                            backup job configuration to sync the repository to cloud storage using rclone.
                          </p>
                          <p className="text-blue-700 text-xs mt-1">
                            Go to: <strong>Backups → Create/Edit Backup → Scripts → After Backup</strong>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cloud Storage Info for Borg 2.x - Native support */}
              {(createForm.repository_type === 'rclone' || createForm.repository_type === 's3') && createForm.borg_version === '2.x' && (
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-start">
                    <div className="flex-1">
                      <div className="font-medium text-purple-900">🚀 Native Cloud Storage (Borg 2.x)</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {createForm.repository_type === 'rclone'
                          ? 'Borg 2.x writes directly via Rclone - no local copy, no mounting needed!'
                          : 'Borg 2.x writes directly to S3 - native S3 support, no Rclone required!'}
                      </div>
                      <div className="text-sm text-purple-700 mt-2 bg-purple-100 p-2 rounded border border-purple-200">
                        ✨ <strong>Borg 2.x Feature:</strong> Fastest and simplest cloud option. Supports {createForm.repository_type === 'rclone' ? 'all Rclone backends (Google Drive, Dropbox, OneDrive, etc.)' : 'Amazon S3, Backblaze B2, Wasabi, and any S3-compatible storage'}.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Rclone Remote for Borg 2.x native mode */}
              {createForm.repository_type === 'rclone' && createForm.borg_version === '2.x' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rclone Remote <span className="text-red-500">*</span>
                  </label>
                  <div className="flex space-x-2">
                    {rcloneRemotes.length > 0 ? (
                      <select
                        value={createForm.rclone_remote}
                        onChange={(e) => {
                          const newRemote = e.target.value;
                          setCreateForm({
                            ...createForm,
                            rclone_remote: newRemote,
                          });
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="">Select a remote</option>
                        {rcloneRemotes.map(remote => (
                          <option key={remote.name} value={remote.name}>
                            {remote.name}{remote.type ? ` (${remote.type})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={createForm.rclone_remote}
                        onChange={(e) => {
                          const newRemote = e.target.value;
                          setCreateForm({
                            ...createForm,
                            rclone_remote: newRemote,
                          });
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter remote name (e.g., gdrive, hetzner-s3, etc.)"
                        required
                      />
                    )}
                    <button
                      type="button"
                      onClick={loadRcloneRemotes}
                      disabled={loadingRcloneRemotes}
                      className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingRcloneRemotes ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {rcloneRemotes.length > 0
                      ? `Found ${rcloneRemotes.length} configured remote(s). Click refresh to reload.`
                      : 'Click refresh to detect rclone remotes, or enter manually.'}
                  </p>
                  {/* Tip about Rclone Director UI */}
                  <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                    💡 <strong>Tip:</strong> Configure rclone remotes with{' '}
                    <a href="https://speedbits.io/infinity-tools" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900 font-semibold">
                      Rclone Director UI
                    </a>{' '}
                    or via terminal: <code className="bg-blue-100 px-1 rounded">rclone config</code>
                  </div>
                  {/* Path preview */}
                  {createForm.rclone_remote && createForm.rclone_path && (
                    <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-800">
                      <strong>Repository path:</strong>{' '}
                      <code className="bg-purple-100 px-1 rounded">rclone:{createForm.rclone_remote}:{createForm.rclone_path.replace(/^\//, '')}</code>
                    </div>
                  )}
                </div>
              )}

              {/* SSH/SFTP/Hetzner Fields */}
              {(createForm.repository_type === 'ssh' || createForm.repository_type === 'sftp' || createForm.repository_type === 'hetzner') && (
                <>
                  {/* Section Divider - Connection Settings */}
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="w-full border-t border-gray-300"></div>
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-3 text-sm font-medium text-gray-500">🔌 Connection Settings</span>
                    </div>
                  </div>

                  {/* Warning for SSH mode */}
                  {createForm.repository_type === 'ssh' && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                      <p className="text-sm text-yellow-800">
                        <strong>Note:</strong> For SSH mode, Borg, Borgmatic, or Borgmatic Director UI must be installed on the target system.
                        If you don't want to install Borg on the remote system, please switch to SFTP mode instead.
                      </p>
                    </div>
                  )}

                  {/* Hetzner Storage Box info */}
                  {createForm.repository_type === 'hetzner' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                      <p className="text-sm text-blue-800">
                        <strong>📦 Hetzner Storage Box:</strong> BorgBackup is pre-installed. Uses SSH on port 23.
                      </p>
                      <p className="text-xs text-blue-700 mt-2">
                        Username format: <code className="bg-blue-100 px-1 rounded">uXXXXXX</code> •
                        Host format: <code className="bg-blue-100 px-1 rounded">uXXXXXX.your-storagebox.de</code>
                      </p>
                      
                      {/* Hetzner Borg Version Selector */}
                      <div className="mt-3 p-2 bg-white border border-blue-200 rounded">
                        <label className="block text-xs font-medium text-blue-800 mb-1">
                          Borg Version on Hetzner (--remote-path)
                        </label>
                        <select
                          value={createForm.hetzner_borg_version || 'borg-1.4'}
                          onChange={(e) => setCreateForm({ ...createForm, hetzner_borg_version: e.target.value })}
                          className="block w-full px-2 py-1 text-sm border border-blue-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="borg-1.4">Borg 1.4 (Latest, Recommended)</option>
                          <option value="borg-1.2">Borg 1.2 (Hetzner Default)</option>
                          <option value="borg-1.1">Borg 1.1 (Legacy)</option>
                        </select>
                        <p className="text-xs text-blue-600 mt-1">
                          💡 We recommend Borg 1.4 for best performance. Hetzner's default is 1.2.
                        </p>
                      </div>
                      
                      <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                        <strong>⚠️ Requirement:</strong> You must enable <strong>"SSH support"</strong> in your Hetzner Storage Box settings via the{' '}
                        <a 
                          href="https://docs.hetzner.com/storage/storage-box/access/access-ssh-rsync-borg/" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-amber-700 underline hover:text-amber-900"
                        >
                          Hetzner Console
                        </a>.
                        Without this, connections will fail.
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                    <input
                      type="text"
                      value={createForm.host}
                      onChange={(e) => setCreateForm({ ...createForm, host: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="192.168.1.100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <input
                      type="text"
                      value={createForm.username}
                      onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="user"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                    <input
                      type="number"
                      value={createForm.port}
                      onChange={(e) => setCreateForm({ ...createForm, port: parseInt(e.target.value) })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min="1"
                      max="65535"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Authentication Method</label>
                    <select
                      value={createForm.ssh_auth_method}
                      onChange={(e) => {
                        const authMethod = e.target.value as 'key' | 'password';
                        setCreateForm({
                          ...createForm,
                          ssh_auth_method: authMethod,
                          ssh_key_id: authMethod === 'key' ? createForm.ssh_key_id : null,
                          ssh_password: authMethod === 'password' ? createForm.ssh_password : ''
                        });
                      }}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="key">SSH Key</option>
                      <option value="password">Password</option>
                    </select>
                  </div>

                  {createForm.ssh_auth_method === 'key' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SSH Key <span className="text-red-500">*</span></label>
                      <select
                        value={createForm.ssh_key_id || ''}
                        onChange={(e) => {
                          const selectedValue = e.target.value;
                          // Handle both string UUIDs and numeric IDs
                          const sshKeyId = selectedValue ? (isNaN(Number(selectedValue)) ? selectedValue : Number(selectedValue)) : null;
                          setCreateForm({ ...createForm, ssh_key_id: sshKeyId });
                        }}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="">Select SSH Key</option>
                        {(sshKeysData?.data?.ssh_keys || sshKeysData?.ssh_keys || []).map((key: any) => (
                          <option key={key.id} value={key.id}>
                            {key.name} ({key.key_type})
                          </option>
                        ))}
                      </select>
                      {(!sshKeysData?.data?.ssh_keys && !sshKeysData?.ssh_keys) && (
                        <p className="mt-1 text-xs text-gray-500">No SSH keys available. Create one in the SSH Keys section.</p>
                      )}
                    </div>
                  )}

                  {createForm.ssh_auth_method === 'password' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SSH Password <span className="text-red-500">*</span></label>
                      <input
                        type="password"
                        value={createForm.ssh_password}
                        onChange={(e) => setCreateForm({ ...createForm, ssh_password: e.target.value })}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter SSH password"
                        required
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Password will be stored encrypted in the database
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* S3 Fields */}
              {createForm.repository_type === 's3' && (
                <>
                  {/* Section Divider - S3 Connection Settings */}
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="w-full border-t border-gray-300"></div>
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-3 text-sm font-medium text-gray-500">☁️ S3 Connection Settings</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">S3 Provider</label>
                    <select
                      value={selectedS3Provider}
                      onChange={(e) => handleS3ProviderChange(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      {s3Providers.map(provider => (
                        <option key={provider.name} value={provider.name}>{provider.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      {s3Providers.find(p => p.name === selectedS3Provider)?.help}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">S3 Access Key <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={createForm.s3_access_key}
                      onChange={(e) => {
                        setCreateForm({ ...createForm, s3_access_key: e.target.value });
                        setS3ConnectionTestResult({ status: 'idle', message: '' });
                      }}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">S3 Secret Key <span className="text-red-500">*</span></label>
                    <input
                      type="password"
                      value={createForm.s3_secret_key}
                      onChange={(e) => {
                        setCreateForm({ ...createForm, s3_secret_key: e.target.value });
                        setS3ConnectionTestResult({ status: 'idle', message: '' });
                      }}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">S3 Endpoint</label>
                    <input
                      type="text"
                      value={createForm.s3_endpoint}
                      onChange={(e) => {
                        setCreateForm({ ...createForm, s3_endpoint: e.target.value });
                        setS3ConnectionTestResult({ status: 'idle', message: '' });
                      }}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="s3.amazonaws.com or https://your-location.your-objectstorage.com (leave empty for AWS S3)"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Required for S3-compatible services (Hetzner, Wasabi, etc.). Leave empty for AWS S3.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      S3 Region
                      {!createForm.s3_endpoint && <span className="text-red-500">*</span>}
                      {createForm.s3_endpoint && <span className="text-gray-500 text-xs ml-1">(optional for non-AWS providers)</span>}
                    </label>
                    <input
                      type="text"
                      value={createForm.s3_region}
                      onChange={(e) => setCreateForm({ ...createForm, s3_region: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={createForm.s3_endpoint ? "Leave empty for non-AWS providers" : "us-east-1"}
                      required={!createForm.s3_endpoint}
                    />
                    {createForm.s3_endpoint && (
                      <p className="mt-1 text-xs text-gray-500">
                        Region is optional for S3-compatible providers like Hetzner, Wasabi, Backblaze B2, etc.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      S3 Bucket <span className="text-red-500">*</span>
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={createForm.s3_bucket}
                        onChange={(e) => {
                          setCreateForm({ ...createForm, s3_bucket: e.target.value });
                          setS3ConnectionTestResult({ status: 'idle', message: '' });
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="my-backup-bucket"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!createForm.s3_access_key || !createForm.s3_secret_key) {
                            toast.error('Please enter S3 Access Key and Secret Key first');
                            return;
                          }
                          setShowS3Browser(true);
                        }}
                        disabled={!createForm.s3_access_key || !createForm.s3_secret_key}
                        className={`flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium ${(!createForm.s3_access_key || !createForm.s3_secret_key)
                          ? 'opacity-50 cursor-not-allowed bg-gray-100'
                          : 'text-gray-700 hover:bg-gray-50'
                          }`}
                      >
                        <FolderOpen className="w-4 h-4 mr-1" />
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* S3 Path (for Borg 2.x native S3 support) */}
                  {createForm.borg_version === '2.x' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        S3 Path <span className="text-red-500">*</span>
                      </label>
                      <p className="text-xs text-gray-600 mb-2">
                        Path within the bucket where the repository will be stored.
                        <br />
                        Example: <code className="bg-gray-100 px-1 rounded">/backups/repo-name</code>
                      </p>
                      <input
                        type="text"
                        value={createForm.s3_path}
                        onChange={(e) => setCreateForm({ ...createForm, s3_path: e.target.value })}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="/backups"
                        required
                      />
                    </div>
                  )}

                  {/* S3 Connection Test Button */}
                  <div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!createForm.s3_access_key || !createForm.s3_secret_key || !createForm.s3_bucket) {
                          toast.error('Please fill in S3 Access Key, Secret Key, and Bucket first');
                          return;
                        }

                        setS3ConnectionTestResult({ status: 'testing', message: 'Testing connection...' });

                        try {
                          const response = await fetch('/api/repositories/test-connection', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                            },
                            body: JSON.stringify({
                              repository_type: 's3',
                              s3_endpoint: createForm.s3_endpoint,
                              s3_bucket: createForm.s3_bucket,
                              s3_region: createForm.s3_region,
                              s3_access_key: createForm.s3_access_key,
                              s3_secret_key: createForm.s3_secret_key,
                            })
                          });

                          const result = await response.json();

                          if (result.success) {
                            const messages = result.data?.testResults?.messages || [];
                            setS3ConnectionTestResult({
                              status: 'success',
                              message: result.data?.message || 'Connection successful',
                              details: messages.join('\n')
                            });
                          } else {
                            setS3ConnectionTestResult({
                              status: 'error',
                              message: result.detail || 'Connection test failed'
                            });
                          }
                        } catch (error: any) {
                          setS3ConnectionTestResult({
                            status: 'error',
                            message: error.message || 'Failed to test connection'
                          });
                        }
                      }}
                      disabled={s3ConnectionTestResult.status === 'testing' || !createForm.s3_access_key || !createForm.s3_secret_key || !createForm.s3_bucket}
                      className={`w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium ${(!createForm.s3_access_key || !createForm.s3_secret_key || !createForm.s3_bucket)
                        ? 'opacity-50 cursor-not-allowed bg-gray-100'
                        : 'text-gray-700 hover:bg-gray-50'
                        } ${s3ConnectionTestResult.status === 'testing' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {s3ConnectionTestResult.status === 'testing' ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Testing Connection...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Test Connection (Connect, Read, Write)
                        </>
                      )}
                    </button>

                    {/* S3 Connection Test Result */}
                    {s3ConnectionTestResult.status !== 'idle' && (
                      <div className={`mt-2 p-3 rounded border ${s3ConnectionTestResult.status === 'success' ? 'bg-green-50 border-green-200' :
                        s3ConnectionTestResult.status === 'error' ? 'bg-red-50 border-red-200' :
                          'bg-blue-50 border-blue-200'
                        }`}>
                        <div className="flex items-start">
                          {s3ConnectionTestResult.status === 'success' && <CheckCircle className="w-5 h-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" />}
                          {s3ConnectionTestResult.status === 'error' && <XCircle className="w-5 h-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />}
                          {s3ConnectionTestResult.status === 'testing' && <RefreshCw className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5 animate-spin" />}
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${s3ConnectionTestResult.status === 'success' ? 'text-green-800' :
                              s3ConnectionTestResult.status === 'error' ? 'text-red-800' :
                                'text-blue-800'
                              }`}>
                              {s3ConnectionTestResult.message}
                            </p>
                            {s3ConnectionTestResult.details && (
                              <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap">
                                {s3ConnectionTestResult.details}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Rclone Path Field for Borg 2.x */}
              {createForm.repository_type === 'rclone' && createForm.borg_version === '2.x' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rclone Path <span className="text-red-500">*</span>
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={createForm.rclone_path}
                      onChange={(e) => {
                        setCreateForm({
                          ...createForm,
                          rclone_path: e.target.value,
                        });
                      }}
                      onBlur={(e) => {
                        const normalized = normalizeRclonePath(e.target.value);
                        setCreateForm({
                          ...createForm,
                          rclone_path: normalized,
                        });
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="backups/borg"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowRcloneBrowser(true)}
                      disabled={!createForm.rclone_remote}
                      className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 space-x-1"
                      title="Browse folders"
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span>Browse</span>
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    📁 Path on the rclone remote where the Borg repository will be stored
                  </p>
                </div>
              )}

              {/* Section Divider - Repository Path & Security */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-sm font-medium text-gray-500">📁 Repository Path & Security</span>
                </div>
              </div>

              {/* Repository Path for local, SSH, SFTP, Hetzner (not for cloud storage with Borg 2.x) */}
              {!(createForm.repository_type === 'rclone' && createForm.borg_version === '2.x') && 
               !(createForm.repository_type === 's3' && createForm.borg_version === '2.x') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Repository Path
                  </label>
                  <div className="flex space-x-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={createForm.path}
                        onChange={(e) => {
                          setCreateForm({ ...createForm, path: e.target.value });
                          setPathTestResult({ status: 'idle', message: '' });
                          setPathRequiresCreation(false);
                        }}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder={createForm.repository_type === 'hetzner' ? './backups' : '/var/backups/borg'}
                        required
                      />
                      {/* Browse button for local filesystem */}
                      {createForm.repository_type === 'local' && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowLocalFileBrowser(true);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Browse filesystem"
                        >
                          <FolderOpen className="w-5 h-5" />
                        </button>
                      )}
                      {/* Browse button for SSH/SFTP/Hetzner - inside input */}
                      {(createForm.repository_type === 'ssh' || createForm.repository_type === 'sftp' || createForm.repository_type === 'hetzner') && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!createForm.host || !createForm.username) {
                              toast.error('Please enter Host and Username first');
                              return;
                            }
                            if (createForm.ssh_auth_method === 'key' && !createForm.ssh_key_id) {
                              toast.error('Please select an SSH key first');
                              return;
                            }
                            if (createForm.ssh_auth_method === 'password' && !createForm.ssh_password) {
                              toast.error('Please enter SSH password first');
                              return;
                            }
                            setShowSSHBrowser(true);
                          }}
                          disabled={!createForm.host || !createForm.username || (createForm.ssh_auth_method === 'key' && !createForm.ssh_key_id) || (createForm.ssh_auth_method === 'password' && !createForm.ssh_password)}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 transition-colors ${(!createForm.host || !createForm.username || (createForm.ssh_auth_method === 'key' && !createForm.ssh_key_id) || (createForm.ssh_auth_method === 'password' && !createForm.ssh_password))
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-gray-600'
                            }`}
                          title="Browse remote directory"
                        >
                          <FolderOpen className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={testConnection}
                      disabled={pathTestResult.status === 'testing'}
                      className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Test Connection
                    </button>
                  </div>
                  {/* Path test result */}
                  {pathTestResult.status !== 'idle' && (
                    <div className={`mt-2 flex items-start text-sm ${pathTestResult.status === 'success' ? 'text-green-600' :
                      pathTestResult.status === 'error' ? 'text-red-600' : 'text-blue-600'
                      }`}>
                      {pathTestResult.status === 'success' && <CheckCircle className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" />}
                      {pathTestResult.status === 'error' && <XCircle className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" />}
                      {pathTestResult.status === 'testing' && <RefreshCw className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0 animate-spin" />}
                      <span className="whitespace-pre-line break-words">{pathTestResult.message}</span>
                    </div>
                  )}

                  {/* Hetzner path semantics helper */}
                  {createForm.repository_type === 'hetzner' && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                      <strong>📦 Hetzner path tip:</strong> Hetzner paths are <em>relative to your Storage Box home directory</em>.
                      The folder browser shows your writable area as <code className="bg-blue-100 px-1 rounded">/home/&lt;name&gt;</code>,
                      but over SSH that's the same place as <code className="bg-blue-100 px-1 rounded">./&lt;name&gt;</code>.
                      Absolute paths like <code className="bg-blue-100 px-1 rounded">/test</code> point to a read-only chroot root and Borg
                      will fail with <em>"Read-only file system"</em>. We will save your repository at:{' '}
                      <code className="bg-white px-1 rounded border border-blue-200 font-mono break-all">
                        ssh://{createForm.username || 'user'}@{createForm.host || 'host'}:{createForm.port || 23}/./{(createForm.path || 'borg')
                          .replace(/^local:/i, '')
                          .replace(/^\/+home\/+/i, '')
                          .replace(/^\/+/, '')
                          .replace(/^\.\/+/, '')
                          .replace(/^~\/+/, '')
                          .replace(/\/+$/, '') || 'borg'}
                      </code>
                    </div>
                  )}

                  {/* Remote Borg Version Info (SSH types only) */}
                  {(createForm.repository_type === 'ssh' || createForm.repository_type === 'hetzner') && remoteBorgVersion && (
                    <div className="mt-3">
                      {remoteBorgVersion.borg_installed ? (
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">
                              Remote Borg Version: <span className="font-mono">{remoteBorgVersion.borg_full_version || remoteBorgVersion.borg_major_version}</span>
                            </span>
                            <span className={`text-xs px-2 py-1 rounded ${(createForm.borg_version === '1.x' && remoteBorgVersion.has_1x) ||
                              (createForm.borg_version === '2.x' && remoteBorgVersion.has_2x)
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                              }`}>
                              {(createForm.borg_version === '1.x' && remoteBorgVersion.has_1x) ||
                                (createForm.borg_version === '2.x' && remoteBorgVersion.has_2x)
                                ? '✓ Compatible'
                                : '✗ Incompatible'}
                            </span>
                          </div>
                          {remoteBorgVersion.has_1x && remoteBorgVersion.has_2x && (
                            <p className="mt-1 text-xs text-gray-500">
                              Remote has both Borg 1.x and 2.x available
                            </p>
                          )}
                          {/* Version mismatch warning */}
                          {!((createForm.borg_version === '1.x' && remoteBorgVersion.has_1x) ||
                            (createForm.borg_version === '2.x' && remoteBorgVersion.has_2x)) && (
                              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                                <strong>Version Mismatch:</strong> You selected Borg {createForm.borg_version}, but the remote server
                                {remoteBorgVersion.has_1x ? ' only has Borg 1.x' : ' only has Borg 2.x'}.
                                Please change your Borg version selection above.
                              </div>
                            )}
                        </div>
                      ) : (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                          <p className="text-sm font-medium text-red-800">⚠️ Borg is not installed on the remote system</p>
                          <p className="mt-1 text-xs text-red-700">
                            For SSH mode, Borg must be installed on the remote server. You can use SFTP mode as an alternative.
                          </p>
                          {remoteBorgVersion.install_hints && (
                            <div className="mt-2 text-xs text-gray-700">
                              <p className="font-medium">Install Borg:</p>
                              <ul className="mt-1 space-y-1 font-mono text-xs">
                                <li><span className="text-gray-500">Ubuntu/Debian:</span> {remoteBorgVersion.install_hints.debian_ubuntu}</li>
                                <li><span className="text-gray-500">Fedora/RHEL:</span> {remoteBorgVersion.install_hints.fedora_rhel}</li>
                                <li><span className="text-gray-500">Arch:</span> {remoteBorgVersion.install_hints.arch}</li>
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Optional log file path (borgmatic log output) */}
              <PathSelectorField
                label="Log file path (optional)"
                value={createForm.log_file_path || ''}
                onChange={(value) => setCreateForm({ ...createForm, log_file_path: value })}
                selectMode="both"
                autoComplete="off"
                placeholder="/var/backups/borgmatic.log"
                helperText="If you select a directory, we'll automatically append 'borgmatic.log'."
                onBrowseSelect={(selected) => {
                  const s = String(selected || '').trim();
                  if (!s) return s;
                  const cleaned = s.replace(/\/+$/g, '');
                  const last = cleaned.split('/').pop() || '';
                  // Heuristic: if it looks like a filename (has an extension), keep it; otherwise treat as directory.
                  if (last.includes('.')) return cleaned;
                  return `${cleaned}/borgmatic.log`;
                }}
              />

              {/* Encryption - Dynamic based on Borg version */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Encryption</label>
                <select
                  value={createForm.encryption}
                  onChange={(e) => setCreateForm({ ...createForm, encryption: e.target.value })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  {createForm.borg_version === '2.x' ? (
                    <>
                      <optgroup label="🧪 Borg 2.x AEAD Encryption">
                        <option value="repokey-blake2-aes-ocb">Repokey BLAKE2 + AES-OCB (Recommended)</option>
                        <option value="repokey-blake2-chacha20-poly1305">Repokey BLAKE2 + ChaCha20 (Older CPUs)</option>
                      </optgroup>
                      <optgroup label="Key in Repository">
                        <option value="repokey-aes-ocb">Repokey AES-OCB</option>
                        <option value="repokey-chacha20-poly1305">Repokey ChaCha20-Poly1305</option>
                      </optgroup>
                      <optgroup label="Key in File (Must Backup!)">
                        <option value="keyfile-blake2-aes-ocb">Keyfile BLAKE2 + AES-OCB</option>
                        <option value="keyfile-blake2-chacha20-poly1305">Keyfile BLAKE2 + ChaCha20</option>
                        <option value="keyfile-aes-ocb">Keyfile AES-OCB</option>
                        <option value="keyfile-chacha20-poly1305">Keyfile ChaCha20-Poly1305</option>
                      </optgroup>
                      <optgroup label="⚠️ Not Encrypted">
                        <option value="authenticated-blake2">Authenticated BLAKE2 (No Encryption)</option>
                        <option value="authenticated">Authenticated (No Encryption)</option>
                        <option value="none">None (No Encryption/Auth)</option>
                      </optgroup>
                    </>
                  ) : (
                    <>
                      <optgroup label="🌟 Recommended (Borg 1.x)">
                        <option value="repokey-blake2">Repokey BLAKE2 (Recommended)</option>
                        <option value="repokey">Repokey (AES-CTR)</option>
                      </optgroup>
                      <optgroup label="Key in File (Must Backup!)">
                        <option value="keyfile-blake2">Keyfile BLAKE2</option>
                        <option value="keyfile">Keyfile (AES-CTR)</option>
                      </optgroup>
                      <optgroup label="⚠️ Not Encrypted">
                        <option value="authenticated-blake2">Authenticated BLAKE2 (No Encryption)</option>
                        <option value="authenticated">Authenticated (No Encryption)</option>
                        <option value="none">None (No Encryption/Auth)</option>
                      </optgroup>
                    </>
                  )}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {getEncryptionDescription(createForm.encryption)}
                </p>
              </div>

              {/* Compression */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Compression</label>
                <select
                  value={createForm.compression}
                  onChange={(e) => setCreateForm({ ...createForm, compression: e.target.value })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="lz4">LZ4 (Fast)</option>
                  <option value="zstd">Zstandard</option>
                  <option value="zlib">Zlib</option>
                  <option value="none">None</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {getCompressionDescription(createForm.compression)}
                </p>
              </div>

              {/* Passphrase Fields */}
              {createForm.encryption !== 'none' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Repository Passphrase
                      <button
                        type="button"
                        onClick={() => setShowPassphrase(!showPassphrase)}
                        className="ml-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        {showPassphrase ? <EyeOff className="w-4 h-4 inline" /> : <Eye className="w-4 h-4 inline" />}
                        {showPassphrase ? 'Hide' : 'Show'} password
                      </button>
                    </label>
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={createForm.passphrase}
                      onChange={(e) => setCreateForm({ ...createForm, passphrase: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter repository encryption passphrase"
                      required
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      This passphrase encrypts your backup data. Keep it safe - without it, you cannot restore your backups!
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Repository Passphrase</label>
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={createForm.confirmPassphrase}
                      onChange={(e) => {
                        setCreateForm({ ...createForm, confirmPassphrase: e.target.value });
                        // Clear error when user starts typing
                        if (confirmPassphraseError && e.target.value.trim() !== '') {
                          setConfirmPassphraseError(false);
                        }
                      }}
                      className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none ${confirmPassphraseError || (createForm.passphrase && createForm.confirmPassphrase && createForm.passphrase !== createForm.confirmPassphrase)
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                      placeholder="Confirm passphrase"
                      required
                    />
                    {confirmPassphraseError && createForm.passphrase && !createForm.confirmPassphrase && (
                      <p className="mt-1 text-sm text-red-600">Please confirm the passphrase</p>
                    )}
                    {createForm.passphrase && createForm.confirmPassphrase && createForm.passphrase !== createForm.confirmPassphrase && (
                      <p className="mt-1 text-sm text-red-600">Passphrases do not match</p>
                    )}
                  </div>
                </>
              )}

              {/* Error Display */}
              {(createError || createRepositoryMutation.isError) && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                  <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-red-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800">Error Creating Repository</p>
                      <p className="text-sm text-red-700 mt-1">{createError || 'An error occurred while creating the repository'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Path Creation Prompt */}
              {pathRequiresCreation && createForm.repository_type === 'local' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                  <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800">Path Does Not Exist</p>
                      <p className="text-sm text-yellow-700 mt-1 mb-2">The path "{createForm.path}" does not exist. Would you like to create it?</p>
                      <button
                        type="button"
                        onClick={createPath}
                        className="px-3 py-1.5 text-sm font-medium text-yellow-800 bg-yellow-100 border border-yellow-300 rounded-md hover:bg-yellow-200"
                      >
                        Create Path
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Discovered Repositories */}
              {discoveredRepositories.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
                  <div className="flex items-start mb-3">
                    <Info className="w-5 h-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-blue-800">
                        Discovered {discoveredRepositories.length} existing {discoveredRepositories.length === 1 ? 'repository' : 'repositories'} on remote system
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        Select repositories to add to your repository list:
                      </p>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-blue-200 rounded-md bg-white">
                    {discoveredRepositories.map((repo, index) => (
                      <label
                        key={index}
                        className="flex items-start p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDiscoveredRepos.has(repo.path)}
                          onChange={(e) => {
                            const newSelected = new Set(selectedDiscoveredRepos);
                            if (e.target.checked) {
                              newSelected.add(repo.path);
                            } else {
                              newSelected.delete(repo.path);
                            }
                            setSelectedDiscoveredRepos(newSelected);
                          }}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1">
                          <p className="text-sm font-medium text-gray-900">{repo.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{repo.local_path}</p>
                          {repo.encryption && repo.encryption !== 'unknown' && (
                            <p className="text-xs text-gray-400 mt-0.5">Encryption: {repo.encryption}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedDiscoveredRepos.size > 0 && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          // Bulk create selected repositories
                          const reposToCreate = discoveredRepositories.filter(r => selectedDiscoveredRepos.has(r.path));
                          try {
                            for (const repo of reposToCreate) {
                              await createRepositoryMutation.mutateAsync({
                                name: repo.name,
                                path: repo.path,
                                repository_type: repo.repository_type,
                                host: repo.host,
                                port: repo.port,
                                username: repo.username,
                                ssh_auth_method: repo.ssh_auth_method,
                                ssh_key_id: repo.ssh_key_id,
                                encryption: repo.encryption !== 'unknown' ? repo.encryption : 'repokey-blake2',
                                compression: 'lz4',
                              });
                            }
                            toast.success(`Added ${reposToCreate.length} ${reposToCreate.length === 1 ? 'repository' : 'repositories'}`);
                            setDiscoveredRepositories([]);
                            setSelectedDiscoveredRepos(new Set());
                          } catch (error: any) {
                            toast.error(`Failed to add some repositories: ${error.message}`);
                          }
                        }}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                      >
                        Add {selectedDiscoveredRepos.size} Selected {selectedDiscoveredRepos.size === 1 ? 'Repository' : 'Repositories'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Form Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    (isEditMode ? updateRepositoryMutation.isLoading : createRepositoryMutation.isLoading) ||
                    // Disable when Borg 1.x is selected with S3 or Rclone (cloud storage requires Borg 2.x)
                    ((createForm.repository_type === 's3' || createForm.repository_type === 'rclone') && createForm.borg_version === '1.x')
                  }
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center"
                >
                  {isEditMode ? (
                    <>
                      {updateRepositoryMutation.isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                      {updateRepositoryMutation.isLoading ? 'Updating...' : 'Update'}
                    </>
                  ) : (
                    <>
                      {createRepositoryMutation.isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                      {createRepositoryMutation.isLoading ? 'Creating Repository...' : 'Create Repository'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Path Creation Modal */}
      {showPathModal && (
        <PathCreationModal
          path={createForm.path}
          onCreate={createPath}
          onCancel={() => {
            setShowPathModal(false);
            setPathTestResult({ status: 'idle', message: '' });
          }}
        />
      )}

      {/* Rclone Browser Modal */}
      <RcloneBrowserModal
        isOpen={showRcloneBrowser}
        rcloneRemote={createForm.rclone_remote}
        currentPath={createForm.rclone_path}
        onSelectPath={(path) => {
          setCreateForm({
            ...createForm,
            rclone_path: path,
          });
          setShowRcloneBrowser(false);
        }}
        onClose={() => setShowRcloneBrowser(false)}
      />

      {/* S3 Browser Modal */}
      <S3BrowserModal
        isOpen={showS3Browser}
        s3Endpoint={createForm.s3_endpoint}
        s3Region={createForm.s3_region}
        s3AccessKey={createForm.s3_access_key}
        s3SecretKey={createForm.s3_secret_key}
        currentBucket={createForm.s3_bucket}
        currentPath={createForm.s3_path}
        onSelectBucket={(bucket) => {
          setCreateForm({
            ...createForm,
            s3_bucket: bucket,
            s3_path: '/backups' // Reset path when bucket changes
          });
        }}
        onSelectPath={(bucket, path) => {
          setCreateForm({
            ...createForm,
            s3_bucket: bucket,
            s3_path: path
          });
          setShowS3Browser(false);
        }}
        onClose={() => setShowS3Browser(false)}
      />

      {/* SSH/SFTP Browser Modal */}
      <SSHBrowserModal
        isOpen={showSSHBrowser}
        host={createForm.host}
        port={createForm.port}
        username={createForm.username}
        sshKeyId={createForm.ssh_key_id || undefined}
        sshAuthMethod={createForm.ssh_auth_method}
        sshPassword={createForm.ssh_password}
        currentPath={createForm.path}
        onSelectPath={(selectedPath) => {
          // For Hetzner, the SFTP folder browser shows the writable area as
          // /home/<name>, but Borg over SSH lands directly in the home dir.
          // Convert /home/<x> -> ./<x> so we end up writing into the user's
          // own area rather than the read-only chroot root.
          let pathToSet = selectedPath;
          if (createForm.repository_type === 'hetzner' && pathToSet) {
            const cleaned = pathToSet
              .replace(/^local:/i, '')
              .replace(/^\/+home\/+/i, '')
              .replace(/^\/+/, '')
              .replace(/^\.\/+/, '')
              .replace(/^~\/+/, '')
              .replace(/\/+$/, '');
            pathToSet = cleaned ? `./${cleaned}` : './borg';
          }
          setCreateForm({ ...createForm, path: pathToSet });
          setPathTestResult({ status: 'idle', message: '' });
          setPathRequiresCreation(false);
          setShowSSHBrowser(false);
        }}
        onClose={() => setShowSSHBrowser(false)}
      />

      {/* Local Filesystem Browser Modal */}
      <FileExplorerModal
        isOpen={showLocalFileBrowser}
        onClose={() => setShowLocalFileBrowser(false)}
        onSelect={(paths) => {
          if (paths.length > 0) {
            setCreateForm({ ...createForm, path: paths[0] });
            setPathTestResult({ status: 'idle', message: '' });
            setPathRequiresCreation(false);
          }
          setShowLocalFileBrowser(false);
        }}
        initialPath={createForm.path || '/'}
        selectMode="directories"
        title="Select Repository Directory"
        selectButtonText="Select"
      />

      {/* Mount Path Browser Modal */}
      <FileExplorerModal
        isOpen={showMountPathBrowser}
        onClose={() => setShowMountPathBrowser(false)}
        onSelect={(paths) => {
          if (paths.length > 0) {
            const mountPath = paths[0];
            setCreateForm({
              ...createForm,
              mount_path: mountPath,
              path: updatePathForDirectRclone(mountPath, createForm.rclone_path || '')
            });
            setMountTestResult({ status: 'idle', message: '' });
          }
          setShowMountPathBrowser(false);
        }}
        initialPath={createForm.mount_path || '/mnt'}
        selectMode="directories"
        title="Select Mount Point Directory"
        selectButtonText="Select"
      />
    </>
  );
};

export default CreateRepositoryModal;

