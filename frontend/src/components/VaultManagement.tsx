import React, { useState } from 'react';
import { useQuery, useMutation } from 'react-query';
import { Shield, Key, Eye, EyeOff, Lock, RefreshCw, AlertTriangle } from 'lucide-react';
import { vaultAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { formatDateTime } from '../utils/dateFormat';

export default function VaultManagement() {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showViewPassphrases, setShowViewPassphrases] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  // Fetch vault status
  const { data: vaultStatus, isLoading: loadingStatus } = useQuery({
    queryKey: ['vault-status'],
    queryFn: () => vaultAPI.getStatus().then(res => res.data),
  });

  // Fetch vault clients
  const { data: clientsData, isLoading: loadingClients } = useQuery({
    queryKey: ['vault-clients'],
    queryFn: () => vaultAPI.getClients().then(res => res.data),
    enabled: vaultStatus?.data?.initialized,
  });

  const clients = clientsData?.data?.clients || [];

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: () => vaultAPI.changePassword(currentPassword, newPassword, confirmPassword),
    onSuccess: () => {
      toast.success('Master password changed successfully!');
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to change password');
    },
  });

  // Fetch client passphrases
  const [clientPassphrases, setClientPassphrases] = useState<any>(null);
  const [loadingPassphrases, setLoadingPassphrases] = useState(false);

  const handleViewPassphrases = async () => {
    if (!masterPassword) {
      toast.error('Please enter master password');
      return;
    }

    if (!selectedClient) {
      toast.error('Please select a client');
      return;
    }

    setLoadingPassphrases(true);
    try {
      const response = await vaultAPI.getClientPassphrases(selectedClient, masterPassword);
      setClientPassphrases(response.data.data.passphrases);
      setShowViewPassphrases(true);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to retrieve passphrases');
    } finally {
      setLoadingPassphrases(false);
    }
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    changePasswordMutation.mutate();
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!vaultStatus?.data?.initialized) {
    return (
      <div className="card p-6">
        <div className="text-center">
          <Shield className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Vault Not Initialized</h3>
          <p className="text-gray-600">
            The vault has not been set up yet. Go to the Director Dashboard to initialize it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <Shield className="w-8 h-8 text-purple-600" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Vault Management</h2>
          <p className="text-sm text-gray-500">Manage master password and view stored passphrases</p>
        </div>
      </div>

      {/* Vault Status Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Vault Status</h3>
            <p className="text-sm text-gray-600 mt-1">
              {clients.length} client(s) with stored passphrases
            </p>
          </div>
          <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            ✓ Initialized
          </div>
        </div>
      </div>

      {/* Change Master Password */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Key className="w-5 h-5 mr-2" />
              Change Master Password
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Update your vault master password. All passphrases will be re-encrypted.
            </p>
          </div>
          {!showChangePassword && (
            <button
              onClick={() => setShowChangePassword(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Change Password</span>
            </button>
          )}
        </div>

        {showChangePassword && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Master Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input w-full"
                placeholder="Enter current password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Master Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input w-full"
                placeholder="Enter new password (min 8 characters)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input w-full"
                placeholder="Re-enter new password"
              />
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowChangePassword(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isLoading}
                className="btn-primary"
              >
                {changePasswordMutation.isLoading ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* View Stored Passphrases */}
      <div className="card p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Eye className="w-5 h-5 mr-2" />
            View Stored Passphrases
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Enter master password to decrypt and view client passphrases
          </p>
        </div>

        {loadingClients ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Lock className="w-12 h-12 mx-auto text-gray-400 mb-2" />
            <p>No passphrases stored yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Client
              </label>
              <select
                value={selectedClient || ''}
                onChange={(e) => setSelectedClient(e.target.value)}
                className="input w-full"
              >
                <option value="">-- Select a client --</option>
                {clients.map((client: any) => (
                  <option key={client.client_id} value={client.client_id}>
                    {client.client_id} ({client.repository_count} repositories)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Master Password
              </label>
              <div className="flex space-x-2">
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  className="input flex-1"
                  placeholder="Enter master password"
                />
                <button
                  onClick={handleViewPassphrases}
                  disabled={loadingPassphrases || !masterPassword || !selectedClient}
                  className="btn-primary flex items-center space-x-2"
                >
                  {loadingPassphrases ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      <span>View</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Warning Card */}
      <div className="card border-2 border-yellow-300 bg-yellow-50 p-6">
        <div className="flex">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-900">
            <h4 className="font-semibold mb-2">Security Reminder</h4>
            <ul className="list-disc list-inside space-y-1">
              <li>Never share your master password</li>
              <li>Store it securely (password manager recommended)</li>
              <li>If you lose it, all stored passphrases become unrecoverable</li>
            </ul>
          </div>
        </div>
      </div>

      {/* View Passphrases Modal */}
      {showViewPassphrases && clientPassphrases && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">
                  Stored Passphrases for {selectedClient}
                </h3>
                <button
                  onClick={() => {
                    setShowViewPassphrases(false);
                    setClientPassphrases(null);
                    setMasterPassword('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-grow">
              {clientPassphrases.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No passphrases found for this client</p>
              ) : (
                <div className="space-y-4">
                  {clientPassphrases.map((item: any) => (
                    <div key={item.repo_id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-gray-900">{item.name}</h4>
                          <p className="text-sm text-gray-600 font-mono">{item.path}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Stored: {formatDateTime(item.stored_at)}
                          </p>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Passphrase
                        </label>
                        <div className="flex space-x-2">
                          <input
                            type={showPasswords ? 'text' : 'password'}
                            value={item.passphrase}
                            readOnly
                            className="input flex-1 font-mono text-sm"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(item.passphrase);
                              toast.success('Passphrase copied to clipboard');
                            }}
                            className="btn-secondary"
                            title="Copy to clipboard"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => setShowPasswords(!showPasswords)}
                className="btn-secondary flex items-center space-x-2"
              >
                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span>{showPasswords ? 'Hide' : 'Show'} Passphrases</span>
              </button>
              <button
                onClick={() => {
                  setShowViewPassphrases(false);
                  setClientPassphrases(null);
                  setMasterPassword('');
                }}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

