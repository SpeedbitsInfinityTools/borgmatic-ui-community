import React, { useState, useEffect } from 'react';
import {
  X,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Repository, PathTestResult } from '../../types/repositories';
import { getDisplayPath, getCompressionDescription, getEncryptionDescription } from '../../utils/repositoryUtils';
import { useRepositoryMutations } from '../../hooks/useRepositories';

interface EditRepositoryModalProps {
  repository: Repository | null;
  isOpen: boolean;
  onClose: () => void;
  sshKeysData?: any;
}

const EditRepositoryModal: React.FC<EditRepositoryModalProps> = ({
  repository,
  isOpen,
  onClose,
  sshKeysData,
}) => {
  const [name, setName] = useState('');
  const [compression, setCompression] = useState('lz4');
  const [readOnly, setReadOnly] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  // SSH/SFTP fields
  const [sshAuthMethod, setSshAuthMethod] = useState<'key' | 'password'>('key');
  const [sshKeyId, setSshKeyId] = useState<number | string | null>(null);
  const [sshPassword, setSshPassword] = useState('');
  const [pathTestResult, setPathTestResult] = useState<PathTestResult>({ status: 'idle', message: '' });

  // Extract SSH connection details from repository path
  const getSSHDetails = () => {
    if (repository.repository_type !== 'ssh' && repository.repository_type !== 'sftp') {
      return null;
    }

    // Parse SSH path: ssh://user@host:port/path or ssh://user@host/path
    // More flexible regex that handles paths correctly
    const sshMatch = repository.path.match(/^ssh:\/\/([^@]+)@([^:/]+)(?::(\d+))?(.*)$/);
    if (sshMatch) {
      return {
        username: sshMatch[1],
        host: sshMatch[2],
        port: sshMatch[3] ? parseInt(sshMatch[3]) : 22,
        path: sshMatch[4] || '/'
      };
    }
    return null;
  };

  const sshDetails = getSSHDetails();

  // S3 fields
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Region, setS3Region] = useState('us-east-1');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Path, setS3Path] = useState('/backups');

  const { updateRepositoryMutation } = useRepositoryMutations({
    onUpdateSuccess: () => {
      onClose();
    },
  });

  // Populate form from repository
  useEffect(() => {
    if (repository && isOpen) {
      setName(repository.name || '');
      setCompression(repository.compression || 'lz4');
      setReadOnly(repository.read_only || false);

      // Extract SSH authentication method and credentials
      // Check if ssh_key_id exists first (more reliable than ssh_auth_method which might not be set for old repos)
      const hasKeyId = (repository as any).ssh_key_id !== undefined && (repository as any).ssh_key_id !== null;
      const authMethod = (repository as any).ssh_auth_method || (hasKeyId ? 'key' : 'password');
      setSshAuthMethod(authMethod);
      if (authMethod === 'key' && hasKeyId) {
        // Handle both string UUIDs and numeric IDs - preserve the exact value
        const keyId = (repository as any).ssh_key_id;
        setSshKeyId(keyId);
      } else {
        // If no key ID, set to null
        setSshKeyId(null);
      }
      // Note: SSH password is NOT populated for security - user must re-enter if changing

      // Extract S3 fields if available
      if ((repository as any).s3_endpoint) {
        setS3Endpoint((repository as any).s3_endpoint);
      }
      if ((repository as any).s3_region) {
        setS3Region((repository as any).s3_region);
      }
      if ((repository as any).s3_bucket) {
        setS3Bucket((repository as any).s3_bucket);
      }
      if ((repository as any).s3_path) {
        setS3Path((repository as any).s3_path);
      }

      // Note: S3 credentials and passphrases are NOT populated for security
      // User must re-enter them if they want to change them
    }
  }, [repository, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!repository) return;

    // Validate passphrase if provided
    if (passphrase) {
      if (passphrase !== confirmPassphrase) {
        toast.error('Passphrases do not match');
        return;
      }
    }

    // Build update payload with only editable fields
    const updateData: any = {
      name,
      compression,
      read_only: readOnly,
    };

    // Add credentials if provided
    if (repository.repository_type === 'ssh' || repository.repository_type === 'sftp') {
      updateData.ssh_auth_method = sshAuthMethod;
      if (sshAuthMethod === 'key' && sshKeyId) {
        updateData.ssh_key_id = sshKeyId;
      } else if (sshAuthMethod === 'password' && sshPassword) {
        updateData.ssh_password = sshPassword;
      }
    } else if (repository.repository_type === 's3') {
      if (s3AccessKey && s3SecretKey) {
        updateData.s3_access_key = s3AccessKey;
        updateData.s3_secret_key = s3SecretKey;
        updateData.s3_endpoint = s3Endpoint;
        updateData.s3_region = s3Region;
        updateData.s3_bucket = s3Bucket;
        updateData.s3_path = s3Path;
      }
    }

    // Add passphrase if provided
    if (passphrase) {
      updateData.passphrase = passphrase;
    }

    updateRepositoryMutation.mutate({
      path: repository.path,
      ...updateData,
    });
  };

  if (!isOpen || !repository) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 py-20">
      <div className="relative mx-auto p-6 border w-full max-w-2xl shadow-lg rounded-md bg-white mb-20">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Edit Repository</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info notice */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start">
            <Info className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Only certain fields can be changed after repository initialization:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><strong>Editable:</strong> Name, Compression, Credentials (SSH keys, S3 keys, Passphrases)</li>
                <li><strong>Not editable:</strong> Path, Encryption type, Repository type</li>
              </ul>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Repository Name - Editable */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repository Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          {/* Repository Type - Read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repository Type
            </label>
            <input
              type="text"
              value={repository.repository_type || 'local'}
              disabled
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-600 cursor-not-allowed capitalize"
            />
            <p className="mt-1 text-xs text-gray-500">Cannot be changed after initialization</p>
          </div>

          {/* Path - Read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repository Path
            </label>
            <input
              type="text"
              value={getDisplayPath(repository)}
              disabled
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-600 cursor-not-allowed font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Cannot be changed after initialization</p>
          </div>

          {/* Encryption - Read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Encryption
            </label>
            <input
              type="text"
              value={repository.encryption || 'none'}
              disabled
              className={`block w-full px-3 py-2 border rounded-md shadow-sm cursor-not-allowed ${repository.encryption === 'unknown'
                ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
                : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
            />
            {repository.encryption === 'unknown' ? (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                <strong>⚠️ Encryption unknown:</strong> The repository passphrase is not stored.
                Go to <strong>View/Restore → {repository.name || 'this repository'}</strong> and enter
                the passphrase to see the actual encryption type.
              </div>
            ) : (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  {getEncryptionDescription(repository.encryption || 'none')}
                </p>
                <p className="mt-1 text-xs text-gray-500">Cannot be changed after initialization</p>
              </>
            )}
          </div>

          {/* Compression - Editable */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Compression <span className="text-red-500">*</span>
            </label>
            <select
              value={compression}
              onChange={(e) => setCompression(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="lz4">LZ4 (Fast)</option>
              <option value="zstd">Zstandard</option>
              <option value="zlib">Zlib</option>
              <option value="none">None</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {getCompressionDescription(compression)} - Applies to future archives only
            </p>
          </div>

          {/* Read-Only Mode */}
          <div className="p-4 border rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <div className="ml-3">
                <span className="font-medium text-gray-900">Monitor Only (Read-Only)</span>
                <p className="text-sm text-gray-500 mt-1">
                  View and restore existing archives only. Prevents creating new backups to this repository.
                </p>
              </div>
            </label>
          </div>

          {/* SSH/SFTP Credentials - Editable */}
          {(repository.repository_type === 'ssh' || repository.repository_type === 'sftp') && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-3">SSH/SFTP Credentials</h4>

              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Authentication Method
                </label>
                <select
                  value={sshAuthMethod}
                  onChange={(e) => {
                    const authMethod = e.target.value as 'key' | 'password';
                    setSshAuthMethod(authMethod);
                    if (authMethod === 'key') {
                      setSshPassword('');
                    } else {
                      setSshKeyId(null);
                    }
                  }}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="key">SSH Key</option>
                  <option value="password">Password</option>
                </select>
              </div>

              {sshAuthMethod === 'key' && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    SSH Key
                  </label>
                  <select
                    value={sshKeyId || ''}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      // Handle both string UUIDs and numeric IDs
                      const keyId = selectedValue ? (isNaN(Number(selectedValue)) ? selectedValue : Number(selectedValue)) : null;
                      setSshKeyId(keyId);
                    }}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select SSH Key (leave empty to keep current)</option>
                    {(sshKeysData?.data?.ssh_keys || sshKeysData?.ssh_keys || []).map((key: any) => (
                      <option key={key.id} value={key.id}>
                        {key.name} ({key.key_type})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Select a different SSH key to update credentials. Leave empty to keep current key.
                  </p>
                </div>
              )}

              {sshAuthMethod === 'password' && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    SSH Password
                  </label>
                  <input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder="Enter new password (leave empty to keep current)"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Enter a new password to update credentials. Leave empty to keep current password.
                  </p>
                </div>
              )}

              {/* Test Connection Button */}
              {sshDetails && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={async () => {
                      setPathTestResult({ status: 'testing', message: 'Testing connection...' });

                      try {
                        const response = await fetch('/api/repositories/test-connection', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                          },
                          body: JSON.stringify({
                            repository_type: repository.repository_type,
                            path: sshDetails.path,
                            host: sshDetails.host,
                            port: sshDetails.port,
                            username: sshDetails.username,
                            ssh_key_id: sshAuthMethod === 'key' ? sshKeyId : undefined,
                            ssh_auth_method: sshAuthMethod,
                            ssh_password: sshAuthMethod === 'password' ? sshPassword : undefined,
                          })
                        });

                        const result = await response.json();

                        if (result.success) {
                          let message = result.data?.message || 'Connection successful';
                          let status: 'success' | 'error' = 'success';

                          if (repository.repository_type === 'ssh' && result.data?.borg_installed === false) {
                            status = 'error';
                            message = result.data?.warning || 'Borg is not installed on the remote system';
                            toast.error('Borg is not installed on the remote system.');
                          }

                          setPathTestResult({ status, message });
                        } else {
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
                    }}
                    disabled={pathTestResult.status === 'testing' || (sshAuthMethod === 'key' && !sshKeyId) || (sshAuthMethod === 'password' && !sshPassword)}
                    className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {pathTestResult.status === 'testing' ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Test Connection
                      </>
                    )}
                  </button>

                  {/* Test result */}
                  {pathTestResult.status !== 'idle' && (
                    <div className={`mt-2 flex items-center text-sm ${pathTestResult.status === 'success' ? 'text-green-600' :
                      pathTestResult.status === 'error' ? 'text-red-600' : 'text-blue-600'
                      }`}>
                      {pathTestResult.status === 'success' && <CheckCircle className="w-4 h-4 mr-1" />}
                      {pathTestResult.status === 'error' && <AlertCircle className="w-4 h-4 mr-1" />}
                      {pathTestResult.status === 'testing' && <RefreshCw className="w-4 h-4 mr-1 animate-spin" />}
                      {pathTestResult.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* S3 Credentials - Editable */}
          {repository.repository_type === 's3' && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-3">S3 Credentials</h4>
              <p className="text-xs text-gray-600 mb-3">
                Enter new credentials to update. Leave empty to keep current credentials.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Endpoint</label>
                  <input
                    type="text"
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder={s3Endpoint || 'Leave empty to keep current'}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Bucket</label>
                  <input
                    type="text"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                    placeholder={s3Bucket || 'Leave empty to keep current'}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Path</label>
                  <input
                    type="text"
                    value={s3Path}
                    onChange={(e) => setS3Path(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Region</label>
                  <input
                    type="text"
                    value={s3Region}
                    onChange={(e) => setS3Region(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Access Key</label>
                  <input
                    type="text"
                    value={s3AccessKey}
                    onChange={(e) => setS3AccessKey(e.target.value)}
                    placeholder="Enter new access key (leave empty to keep current)"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">S3 Secret Key</label>
                  <input
                    type="password"
                    value={s3SecretKey}
                    onChange={(e) => setS3SecretKey(e.target.value)}
                    placeholder="Enter new secret key (leave empty to keep current)"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Passphrase - Editable (if repository is encrypted or encryption is unknown) */}
          {repository.encryption && repository.encryption !== 'none' && (
            <div className={`p-4 border rounded-lg ${repository.encryption === 'unknown'
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-gray-50 border-gray-200'
              }`}>
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                {repository.encryption === 'unknown' ? 'Set Repository Passphrase' : 'Change Passphrase'}
              </h4>
              <p className="text-xs text-gray-600 mb-3">
                {repository.encryption === 'unknown'
                  ? 'This repository may be encrypted. Enter the passphrase to access it.'
                  : 'Enter a new passphrase to change it. Leave empty to keep current passphrase.'
                }
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Passphrase</label>
                  <div className="relative">
                    <input
                      type={showPassphrase ? 'text' : 'password'}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Leave empty to keep current passphrase"
                      className="block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {passphrase && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Passphrase</label>
                    <input
                      type={showPassphrase ? 'text' : 'password'}
                      value={confirmPassphrase}
                      onChange={(e) => setConfirmPassphrase(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateRepositoryMutation.isLoading}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {updateRepositoryMutation.isLoading ? 'Updating...' : 'Update Repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditRepositoryModal;

