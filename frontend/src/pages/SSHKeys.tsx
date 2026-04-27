import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  Plus,
  Edit,
  Trash2,
  Key,
  Wifi,
  Download,
  Upload,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FolderOpen,
  FileUp
} from 'lucide-react';
import { sshKeysAPI, restoreAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import FileExplorerModal from '../components/FileExplorerModal';

interface SSHKey {
  id: string | number;
  name: string;
  description: string | null;
  key_type: string;
  public_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

const SSHKeys: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [editingKey, setEditingKey] = useState<SSHKey | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  // Get SSH keys
  const { data: sshKeysData, isLoading } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: sshKeysAPI.getSSHKeys,
  });

  // Create SSH key mutation
  const createSSHKeyMutation = useMutation({
    mutationFn: sshKeysAPI.createSSHKey,
    onSuccess: (response: any) => {
      // axios wraps response in data property
      const message = response?.data?.message || 'SSH key created successfully';
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setShowCreateModal(false);
      // Reset form state
      setExtractedPublicKey('');
      setDetectedKeyType('');
      setIsExtracting(false);
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Failed to create SSH key';
      console.error('SSH key creation error:', error.response?.data || error.message);
      toast.error(errorMessage);
    },
  });

  // Generate SSH key mutation
  const generateSSHKeyMutation = useMutation({
    mutationFn: sshKeysAPI.generateSSHKey,
    onSuccess: () => {
      toast.success('SSH key generated successfully');
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setShowGenerateModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to generate SSH key');
    },
  });

  // Update SSH key mutation
  const updateSSHKeyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string | number; data: any }) =>
      sshKeysAPI.updateSSHKey(id, data),
    onSuccess: () => {
      toast.success('SSH key updated successfully');
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setEditingKey(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update SSH key');
    },
  });

  // Delete SSH key mutation
  const deleteSSHKeyMutation = useMutation({
    mutationFn: sshKeysAPI.deleteSSHKey,
    onSuccess: () => {
      toast.success('SSH key deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete SSH key');
    },
  });

  // Test SSH connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: sshKeysAPI.testSSHConnection,
    onSuccess: (data: any) => {
      const connectionTest = data.data?.connection_test || data.data;
      if (connectionTest.success) {
        setTestResult({
          success: true,
          message: connectionTest.message || 'SSH connection successful!',
          borg: connectionTest.borg || null
        });
        if (connectionTest.borg?.installed) {
          toast.success(`SSH connection successful! Borg ${connectionTest.borg.version} found.`);
        } else {
          toast.success('SSH connection successful!');
          if (connectionTest.borg) {
            toast.error('Warning: Borg is not installed on the remote server!', { duration: 5000 });
          }
        }
      } else {
        const fullError = connectionTest.error || 'SSH connection failed';
        setTestResult({
          success: false,
          error: fullError
        });
        // Keep the toast concise — show the first line only; the full multi-line
        // explanation (including Hetzner hints) is rendered in the inline panel.
        const firstLine = String(fullError).split('\n')[0].trim();
        toast.error(`SSH connection failed: ${firstLine}`);
      }
    },
    onError: (error: any) => {
      setTestResult({
        success: false,
        error: error.response?.data?.detail || 'Failed to test SSH connection'
      });
      toast.error(error.response?.data?.detail || 'Failed to test SSH connection');
    },
  });

  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    private_key: '',
    passphrase: '',
  });
  const [extractedPublicKey, setExtractedPublicKey] = useState('');
  const [detectedKeyType, setDetectedKeyType] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [checkingEncryption, setCheckingEncryption] = useState(false);

  // File selection states
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generateForm, setGenerateForm] = useState({
    name: '',
    description: '',
    key_type: 'rsa',
  });

  const [testForm, setTestForm] = useState({
    host: '',
    username: '',
    port: 22,
  });
  const [testingKeyId, setTestingKeyId] = useState<string | number | null>(null);

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    is_active: true,
  });

  const handleCreateSSHKey = (e: React.FormEvent) => {
    e.preventDefault();
    // Send private_key and passphrase if encrypted
    createSSHKeyMutation.mutate({
      name: createForm.name,
      description: createForm.description,
      private_key: createForm.private_key,
      passphrase: isEncrypted && createForm.passphrase ? createForm.passphrase : undefined,
    });
  };

  const handleGenerateSSHKey = (e: React.FormEvent) => {
    e.preventDefault();
    generateSSHKeyMutation.mutate(generateForm);
  };

  const handleUpdateSSHKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingKey) {
      updateSSHKeyMutation.mutate({
        id: editingKey.id,
        data: editForm,
      });
    }
  };

  const handleDeleteSSHKey = (sshKey: SSHKey) => {
    if (window.confirm(`Are you sure you want to delete SSH key "${sshKey.name}"?`)) {
      deleteSSHKeyMutation.mutate(sshKey.id);
    }
  };

  const handleTestConnection = (e: React.FormEvent) => {
    e.preventDefault();
    if (testingKeyId === null) {
      toast.error('No SSH key selected for testing');
      return;
    }
    testConnectionMutation.mutate({
      key_id: testingKeyId,
      host: testForm.host,
      username: testForm.username,
      port: testForm.port,
    });
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
    setCreateForm({
      name: '',
      description: '',
      private_key: '',
      passphrase: '',
    });
    setExtractedPublicKey('');
    setDetectedKeyType('');
    setIsExtracting(false);
    setIsEncrypted(false);
    setCheckingEncryption(false);
  };

  // Handle private key input change - detect if encrypted
  const handlePrivateKeyChange = async (privateKey: string) => {
    setCreateForm({ ...createForm, private_key: privateKey });

    if (!privateKey.trim()) {
      setExtractedPublicKey('');
      setDetectedKeyType('');
      setIsExtracting(false);
      setIsEncrypted(false);
      setCheckingEncryption(false);
      return;
    }

    // Validate format first
    const validHeaders = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----'
    ];

    const trimmed = privateKey.trim();
    const isValid = validHeaders.some(header => trimmed.startsWith(header));

    if (!isValid) {
      setExtractedPublicKey('');
      setDetectedKeyType('');
      setIsExtracting(false);
      setIsEncrypted(false);
      setCheckingEncryption(false);
      return;
    }

    // Try to detect if key is encrypted by attempting extraction
    setCheckingEncryption(true);
    setIsExtracting(true);

    try {
      // Get token from localStorage (use access_token like the API interceptor does)
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        setIsEncrypted(false);
        setExtractedPublicKey('(Will be extracted automatically from private key)');
        setDetectedKeyType('(Will be detected automatically)');
        setIsExtracting(false);
        return;
      }

      // Call backend to check if encrypted
      const response = await fetch('/api/ssh-keys/check-encryption', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ private_key: privateKey })
      });

      if (!response.ok) {
        // If unauthorized or other error, skip encryption check
        console.warn('Failed to check encryption, assuming not encrypted');
        setIsEncrypted(false);
        setExtractedPublicKey('(Will be extracted automatically from private key)');
        setDetectedKeyType('(Will be detected automatically)');
        setIsExtracting(false);
        return;
      }

      const data = await response.json();

      if (data.requires_passphrase) {
        setIsEncrypted(true);
        setExtractedPublicKey('');
        setDetectedKeyType('');
        setIsExtracting(false);
      } else {
        setIsEncrypted(false);
        setExtractedPublicKey('(Will be extracted automatically from private key)');
        setDetectedKeyType('(Will be detected automatically)');
        setIsExtracting(false);
      }
    } catch (error) {
      // If check fails, assume not encrypted for now
      setIsEncrypted(false);
      setExtractedPublicKey('(Will be extracted automatically from private key)');
      setDetectedKeyType('(Will be detected automatically)');
      setIsExtracting(false);
    } finally {
      setCheckingEncryption(false);
    }
  };

  // Handle file selection from server file browser
  const handleFileSelectFromServer = async (paths: string[]) => {
    if (paths.length === 0) return;
    
    const filePath = paths[0];
    setShowFileBrowser(false);
    setIsLoadingFile(true);
    
    try {
      const response = await restoreAPI.readFile(filePath);
      if (response.data?.success && response.data?.data?.content) {
        const content = response.data.data.content;
        handlePrivateKeyChange(content);
        toast.success('Key file loaded successfully');
      } else {
        toast.error('Failed to read file content');
      }
    } catch (error: any) {
      console.error('Failed to read file:', error);
      toast.error(error.response?.data?.detail || 'Failed to read file');
    } finally {
      setIsLoadingFile(false);
    }
  };

  // Handle file upload from local machine
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 100KB for SSH keys)
    if (file.size > 100 * 1024) {
      toast.error('File too large. SSH key files should be less than 100KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      handlePrivateKeyChange(content);
      toast.success('Key file loaded successfully');
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
    };
    reader.readAsText(file);

    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const openGenerateModal = () => {
    setShowGenerateModal(true);
    setGenerateForm({
      name: '',
      description: '',
      key_type: 'rsa',
    });
  };

  const openTestModal = (keyId: string | number) => {
    setTestingKeyId(keyId);
    setShowTestModal(true);
    setTestResult(null); // Reset test result when opening modal
    setTestForm({
      host: '',
      username: '',
      port: 22,
    });
  };

  const openEditModal = (sshKey: SSHKey) => {
    setEditingKey(sshKey);
    setEditForm({
      name: sshKey.name,
      description: sshKey.description || '',
      is_active: sshKey.is_active,
    });
  };

  const getKeyTypeIcon = (keyType: string) => {
    switch (keyType) {
      case 'rsa':
        return <Key className="w-4 h-4 text-blue-500" />;
      case 'ed25519':
        return <Key className="w-4 h-4 text-green-500" />;
      case 'ecdsa':
        return <Key className="w-4 h-4 text-purple-500" />;
      default:
        return <Key className="w-4 h-4 text-gray-500" />;
    }
  };

  const getKeyTypeLabel = (keyType: string) => {
    switch (keyType) {
      case 'rsa':
        return 'RSA';
      case 'ed25519':
        return 'Ed25519';
      case 'ecdsa':
        return 'ECDSA';
      default:
        return keyType.toUpperCase();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">SSH Key Management</h1>
          <p className="text-gray-600">Manage SSH keys for remote repository access</p>
          <p className="mt-2 text-sm text-gray-600">
            SSH Keys are needed for Borgmatic to authenticate in remote servers.
          </p>
        </div>
        {user?.is_admin && (
          <div className="flex space-x-3 flex-shrink-0">
            <button
              onClick={openGenerateModal}
              className="flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Generate Key
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import Key
            </button>
          </div>
        )}
      </div>

      {/* SSH Keys List */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading SSH keys...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sshKeysData?.data?.ssh_keys?.map((sshKey: SSHKey) => (
            <div key={sshKey.id} className="bg-white rounded-lg border shadow-sm">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    {getKeyTypeIcon(sshKey.key_type)}
                    <h3 className="text-lg font-medium text-gray-900">{sshKey.name}</h3>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${sshKey.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                      }`}>
                      {sshKey.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {sshKey.description && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">Description</label>
                      <p className="text-sm text-gray-900">{sshKey.description}</p>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-gray-500">Key Type</label>
                    <p className="text-sm text-gray-900">{getKeyTypeLabel(sshKey.key_type)}</p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-500">Public Key</label>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <p className="text-xs text-gray-900 font-mono break-all bg-gray-50 p-2 rounded border flex-1">
                          {sshKey.public_key}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(sshKey.public_key);
                            toast.success('Public key copied to clipboard');
                          }}
                          className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                          title="Copy public key"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Full public key extracted from private key. Compare with Hetzner's public key.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-500">Created</label>
                    <p className="text-sm text-gray-900">
                      {new Date(sshKey.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                {user?.is_admin && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => openTestModal(sshKey.id)}
                          disabled={testConnectionMutation.isLoading}
                          className="flex items-center px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          <Wifi className="w-3 h-3 mr-1" />
                          Test
                        </button>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => openEditModal(sshKey)}
                          className="flex items-center px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800"
                        >
                          <Edit className="w-3 h-3 mr-1" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteSSHKey(sshKey)}
                          className="flex items-center px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create SSH Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 py-20">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white mb-20">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Import SSH Key</h3>
              <form onSubmit={handleCreateSSHKey} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Private Key <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={createForm.private_key}
                    onChange={(e) => handlePrivateKeyChange(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    rows={8}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                    required
                  />
                  
                  {/* File selection buttons */}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowFileBrowser(true)}
                      disabled={isLoadingFile}
                      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <FolderOpen className="w-4 h-4 mr-1.5" />
                      Select from Server
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoadingFile}
                      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <FileUp className="w-4 h-4 mr-1.5" />
                      Upload Key File
                    </button>
                    {isLoadingFile && (
                      <span className="flex items-center text-sm text-gray-500">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                        Loading...
                      </span>
                    )}
                  </div>
                  {/* Hidden file input for upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pem,.key,.pub,*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  
                  <p className="mt-2 text-xs text-gray-500">
                    Paste your private key or use the buttons above to load from a file:
                  </p>
                  <ul className="mt-1 text-xs text-gray-500 list-disc list-inside space-y-0.5">
                    <li><strong>OpenSSH format:</strong> <code className="bg-gray-100 px-1 rounded">-----BEGIN OPENSSH PRIVATE KEY-----</code> (recommended, works with Hetzner, AWS, etc.)</li>
                    <li><strong>PEM RSA format:</strong> <code className="bg-gray-100 px-1 rounded">-----BEGIN RSA PRIVATE KEY-----</code></li>
                    <li><strong>PEM EC format:</strong> <code className="bg-gray-100 px-1 rounded">-----BEGIN EC PRIVATE KEY-----</code></li>
                    <li><strong>PKCS#8 format:</strong> <code className="bg-gray-100 px-1 rounded">-----BEGIN PRIVATE KEY-----</code></li>
                  </ul>
                  <p className="mt-2 text-xs text-gray-600">
                    <strong>Note:</strong> The public key will be automatically extracted from your private key.
                    {isEncrypted && ' Encrypted keys are supported - please provide the passphrase below.'}
                  </p>
                </div>

                {/* Passphrase field for encrypted keys */}
                {isEncrypted && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Passphrase <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={createForm.passphrase}
                      onChange={(e) => setCreateForm({ ...createForm, passphrase: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter passphrase for encrypted key"
                      required={isEncrypted}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Passphrase will be stored encrypted in the database
                    </p>
                  </div>
                )}

                {/* Extracted Public Key (Read-only display) */}
                {(extractedPublicKey || isExtracting || checkingEncryption) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Extracted Public Key <span className="text-xs text-gray-500">(auto-detected)</span>
                    </label>
                    {(isExtracting || checkingEncryption) ? (
                      <div className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm text-gray-600">
                          {checkingEncryption ? 'Checking if key is encrypted...' : 'Extracting public key...'}
                        </span>
                      </div>
                    ) : (
                      <textarea
                        value={extractedPublicKey}
                        readOnly
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-700 font-mono text-sm cursor-not-allowed"
                        rows={3}
                      />
                    )}
                  </div>
                )}

                {/* Detected Key Type (Read-only display) */}
                {detectedKeyType && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Key Type <span className="text-xs text-gray-500">(auto-detected)</span>
                    </label>
                    <input
                      type="text"
                      value={detectedKeyType === '(Will be detected automatically)' ? 'Auto-detected on save' : getKeyTypeLabel(detectedKeyType)}
                      readOnly
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-700 cursor-not-allowed"
                    />
                  </div>
                )}
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createSSHKeyMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createSSHKeyMutation.isLoading ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Generate SSH Key Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Generate SSH Key</h3>
              <form onSubmit={handleGenerateSSHKey} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={generateForm.name}
                    onChange={(e) => setGenerateForm({ ...generateForm, name: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={generateForm.description}
                    onChange={(e) => setGenerateForm({ ...generateForm, description: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Key Type</label>
                  <select
                    value={generateForm.key_type}
                    onChange={(e) => setGenerateForm({ ...generateForm, key_type: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="rsa">RSA (Recommended)</option>
                    <option value="ed25519">Ed25519 (Modern)</option>
                    <option value="ecdsa">ECDSA</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generateSSHKeyMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                  >
                    {generateSSHKeyMutation.isLoading ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Test Connection Modal */}
      {showTestModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Test SSH Connection</h3>

              {/* Test Result Indicator */}
              {testResult && (
                <div className="mb-4 space-y-2">
                  {/* SSH Connection Result */}
                  <div className={`p-3 rounded-md border ${testResult.success
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                    }`}>
                    <div className="flex items-center space-x-2">
                      {testResult.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className={`text-sm font-medium whitespace-pre-line ${testResult.success ? 'text-green-800' : 'text-red-800'
                          }`}>
                          {testResult.success
                            ? (testResult.message || 'SSH connection successful!')
                            : (testResult.error || 'SSH connection failed')
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Borg Installation Check */}
                  {testResult.success && testResult.borg && (
                    <div className={`p-3 rounded-md border ${testResult.borg.installed
                        ? 'bg-green-50 border-green-200'
                        : 'bg-yellow-50 border-yellow-200'
                      }`}>
                      <div className="flex items-center space-x-2">
                        {testResult.borg.installed ? (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${testResult.borg.installed ? 'text-green-800' : 'text-yellow-800'
                            }`}>
                            {testResult.borg.installed
                              ? `Borg installed: ${testResult.borg.version}`
                              : 'Borg not installed on remote server'
                            }
                          </p>
                          {!testResult.borg.installed && testResult.borg.error && (
                            <p className="text-xs text-yellow-700 mt-1">{testResult.borg.error}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleTestConnection} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                  <input
                    type="text"
                    value={testForm.host}
                    onChange={(e) => setTestForm({ ...testForm, host: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="192.168.1.100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    type="text"
                    value={testForm.username}
                    onChange={(e) => setTestForm({ ...testForm, username: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="user"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                  <input
                    type="number"
                    value={testForm.port}
                    onChange={(e) => setTestForm({ ...testForm, port: parseInt(e.target.value) })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    min="1"
                    max="65535"
                    required
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowTestModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={testConnectionMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {testConnectionMutation.isLoading ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit SSH Key Modal */}
      {editingKey && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Edit SSH Key</h3>
              <form onSubmit={handleUpdateSSHKey} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Active</label>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditingKey(null)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateSSHKeyMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateSSHKeyMutation.isLoading ? 'Updating...' : 'Update'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* File Browser Modal for selecting SSH key from server */}
      <FileExplorerModal
        isOpen={showFileBrowser}
        onClose={() => setShowFileBrowser(false)}
        onSelect={handleFileSelectFromServer}
        initialPath="/host"
        selectMode="files"
        multiSelect={false}
        title="Select SSH Key File"
        selectButtonText="Select File"
      />
    </div>
  );
};

export default SSHKeys;
