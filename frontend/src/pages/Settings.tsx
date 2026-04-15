import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  Settings as SettingsIcon,
  Users,
  User,
  Shield,
  Save,
  Trash2,
  Plus,
  Edit,
  Key,
  RefreshCw,
  Server,
  Globe,
  ExternalLink,
  BookOpen,
  Package,
  Database,
  HardDrive,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { settingsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import PathSelectorField from '../components/PathSelectorField';
import ModeSettings from '../components/ModeSettings';
import ClientConfiguration from '../components/ClientConfiguration';
import ConnectionConfiguration from '../components/ConnectionConfiguration';
import DomainSettings from '../components/DomainSettings';
import VaultManagement from '../components/VaultManagement';
import ExportImportSettings from '../components/ExportImportSettings';
import { useDirector } from '../contexts/DirectorContext';

interface SystemSettings {
  backup_timeout: number;
  max_concurrent_backups: number;
  log_retention_days: number;
  email_notifications: boolean;
  webhook_url: string;
  auto_cleanup: boolean;
  cleanup_retention_days: number;
  dump_temp_dir: string;
  borgmatic_version: string;
  app_version: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  last_login: string | null;
}

const Settings: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isRemoteSession, selectedClient } = useDirector();
  const location = useLocation();
  // Default to 'system' tab when viewing remote client (mode/config tabs don't apply)
  const [activeTab, setActiveTab] = useState(isRemoteSession ? 'system' : 'mode');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [operatingMode, setOperatingMode] = useState<string | null>(null);
  const [appEdition, setAppEdition] = useState<string>('');

  // Fetch operating mode and edition
  useEffect(() => {
    const fetchMode = async () => {
      try {
        const { identityAPI } = await import('../services/api');
        const response = await identityAPI.getStatus();
        setOperatingMode(response.data.data.mode);
        setAppEdition(response.data.data.edition || '');
      } catch (error) {
        console.error('Failed to fetch mode:', error);
      }
    };
    fetchMode();
  }, []);

  // Reset to appropriate tab when remote session changes
  useEffect(() => {
    if (isRemoteSession) {
      setActiveTab('system');
    }
  }, [isRemoteSession]);

  // Allow deep-linking into a tab (used by Dashboard's Import/Export button)
  useEffect(() => {
    if (isRemoteSession) return;
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'export-import') {
      setActiveTab('export-import');
    }
  }, [isRemoteSession, location.search]);

  // When viewing a remote client, treat the mode as 'client' for tab display
  // The actual API calls will be proxied to the client
  const effectiveMode = isRemoteSession ? 'client' : operatingMode;

  // System settings
  const { data: systemSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: settingsAPI.getSystemSettings,
  });

  // Cache status
  const { data: cacheStatus, isLoading: loadingCache, refetch: refetchCache } = useQuery({
    queryKey: ['cacheStatus'],
    queryFn: settingsAPI.getCacheStatus,
  });

  const updateSystemSettingsMutation = useMutation({
    mutationFn: settingsAPI.updateSystemSettings,
    onSuccess: () => {
      toast.success('System settings updated successfully');
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update system settings');
    },
  });

  const flushCacheMutation = useMutation({
    mutationFn: settingsAPI.flushCache,
    onSuccess: () => {
      toast.success('Archive cache flushed successfully');
      queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to flush cache');
    },
  });

  // Users
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: settingsAPI.getUsers,
    enabled: user?.is_admin === true,
  });

  const createUserMutation = useMutation({
    mutationFn: settingsAPI.createUser,
    onSuccess: () => {
      toast.success('User created successfully');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateUser(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to create user');
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, userData }: { userId: number; userData: any }) =>
      settingsAPI.updateUser(userId, userData),
    onSuccess: () => {
      toast.success('User updated successfully');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update user');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: settingsAPI.deleteUser,
    onSuccess: () => {
      toast.success('User deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: number; newPassword: string }) =>
      settingsAPI.resetUserPassword(userId, newPassword),
    onSuccess: () => {
      toast.success('Password reset successfully');
      setShowPasswordModal(false);
      setSelectedUserId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to reset password');
    },
  });

  // System cleanup
  const cleanupMutation = useMutation({
    mutationFn: settingsAPI.cleanupSystem,
    onSuccess: () => {
      toast.success('System cleanup completed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to run system cleanup');
    },
  });

  // Form states
  const [systemForm, setSystemForm] = useState<Partial<SystemSettings>>({});
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    password: '',
    is_admin: false,
  });
  const [passwordForm, setPasswordForm] = useState({
    new_password: '',
  });
  const [dumpDirTest, setDumpDirTest] = useState<{
    loading: boolean;
    result: null | { path: string; exists: boolean; writable: boolean; free_space: number | null; error: string | null };
  }>({ loading: false, result: null });

  const handleTestDumpDir = async () => {
    const dir = systemForm.dump_temp_dir || '/tmp';
    setDumpDirTest({ loading: true, result: null });
    try {
      const res = await settingsAPI.testDumpDir(dir);
      setDumpDirTest({ loading: false, result: res.data.results });
    } catch (err: any) {
      setDumpDirTest({ loading: false, result: { path: dir, exists: false, writable: false, free_space: null, error: err.response?.data?.detail || err.message } });
    }
  };

  // Initialize form when data loads
  React.useEffect(() => {
    if (systemSettings?.data?.settings) {
      setSystemForm(systemSettings.data.settings);
    }
  }, [systemSettings]);

  const handleSystemSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSystemSettingsMutation.mutate(systemForm);
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    createUserMutation.mutate(userForm);
  };

  const handleUpdateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      updateUserMutation.mutate({
        userId: editingUser.id,
        userData: userForm,
      });
    }
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserId) {
      resetPasswordMutation.mutate({
        userId: selectedUserId,
        newPassword: passwordForm.new_password,
      });
    }
  };

  const handleDeleteUser = (userId: number) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      deleteUserMutation.mutate(userId);
    }
  };

  const handleCleanup = () => {
    if (window.confirm('Are you sure you want to run system cleanup?')) {
      cleanupMutation.mutate();
    }
  };

  const openPasswordModal = (userId: number) => {
    setSelectedUserId(userId);
    setShowPasswordModal(true);
    setPasswordForm({ new_password: '' });
  };

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      email: user.email,
      password: '',
      is_admin: user.is_admin,
    });
  };

  const openCreateUser = () => {
    setShowCreateUser(true);
    setUserForm({
      username: '',
      email: '',
      password: '',
      is_admin: false,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isRemoteSession ? `Settings: ${selectedClient?.client_name}` : 'Settings'}
          </h1>
          <p className="text-gray-600">
            {isRemoteSession 
              ? `Viewing settings for remote client ${selectedClient?.client_name}`
              : 'Manage system configuration and users'}
          </p>
        </div>
        <a
          href="https://speedbits.io"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary flex items-center space-x-2"
        >
          <BookOpen className="w-4 h-4" />
          <span>Docs/Help</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Remote Session Banner */}
      {isRemoteSession && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
          <div className="flex items-center">
            <Server className="w-5 h-5 text-blue-600 mr-2" />
            <p className="text-sm text-blue-700">
              <strong>Remote Client Settings:</strong> You are viewing settings for <strong>{selectedClient?.client_name}</strong>. 
              Some configuration options are read-only or not available for remote clients.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {/* Operating Mode - Hide in remote session (can't change client's mode remotely) */}
          {!isRemoteSession && (
            <button
              onClick={() => setActiveTab('mode')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'mode'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Server className="w-4 h-4 inline mr-2" />
              Operating Mode
            </button>
          )}
          {/* Client Configuration - Hide in remote session (doesn't make sense) */}
          {effectiveMode === 'client' && !isRemoteSession && (
            <button
              onClick={() => setActiveTab('client-config')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'client-config'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Server className="w-4 h-4 inline mr-2" />
              Client Configuration
            </button>
          )}
          {/* Connection Configuration - Director only, hide in remote session */}
          {effectiveMode === 'director' && !isRemoteSession && (
            <button
              onClick={() => setActiveTab('connection-config')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'connection-config'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Globe className="w-4 h-4 inline mr-2" />
              Connection Configuration
            </button>
          )}
          {/* Domain & Security - Hide in remote session (local instance config) */}
          {!isRemoteSession && (
            <button
              onClick={() => setActiveTab('domain')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'domain'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Globe className="w-4 h-4 inline mr-2" />
              Domain & Security
            </button>
          )}
          {/* Vault tab - Only show for Director mode (not in remote session - vault is Director-only) */}
          {effectiveMode === 'director' && !isRemoteSession && (
            <button
              onClick={() => setActiveTab('vault')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'vault'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Shield className="w-4 h-4 inline mr-2" />
              Vault
            </button>
          )}
          {/* Export/Import - Hide in remote session (local instance config) */}
          {!isRemoteSession && (
            <button
              onClick={() => setActiveTab('export-import')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'export-import'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Package className="w-4 h-4 inline mr-2" />
              Export / Import
            </button>
          )}
          <button
            onClick={() => setActiveTab('system')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'system'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            <SettingsIcon className="w-4 h-4 inline mr-2" />
            System Settings
          </button>
          {user?.is_admin && (
            <button
              onClick={() => setActiveTab('users')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'users'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Users className="w-4 h-4 inline mr-2" />
              User Management
            </button>
          )}
        </nav>
      </div>

      {/* Operating Mode Tab */}
      {activeTab === 'mode' && (
        <ModeSettings />
      )}

      {/* Client Configuration Tab */}
      {activeTab === 'client-config' && effectiveMode === 'client' && (
        <ClientConfiguration />
      )}

      {/* Connection Configuration Tab - Only on Director when not in remote session */}
      {activeTab === 'connection-config' && effectiveMode === 'director' && (
        <ConnectionConfiguration />
      )}

      {/* Domain & Security Tab */}
      {activeTab === 'domain' && (
        <DomainSettings />
      )}

      {/* Vault Tab - Director only (for managing client passphrases centrally) */}
      {activeTab === 'vault' && effectiveMode === 'director' && !isRemoteSession && (
        <VaultManagement />
      )}

      {/* Export/Import Tab */}
      {activeTab === 'export-import' && !isRemoteSession && (
        <ExportImportSettings />
      )}

      {/* System Settings Tab */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          {loadingSettings ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading system settings...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* System Settings Form */}
              <div className="bg-white p-6 rounded-lg border">
                <h3 className="text-lg font-medium text-gray-900 mb-4">System Configuration</h3>
                <form onSubmit={handleSystemSettingsSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Backup Timeout (seconds)
                    </label>
                    <input
                      type="number"
                      value={systemForm.backup_timeout || ''}
                      onChange={(e) => setSystemForm({ ...systemForm, backup_timeout: Number(e.target.value) })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min="300"
                      max="86400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Concurrent Backups
                    </label>
                    <input
                      type="number"
                      value={systemForm.max_concurrent_backups || ''}
                      onChange={(e) => setSystemForm({ ...systemForm, max_concurrent_backups: Number(e.target.value) })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min="1"
                      max="10"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Log Retention (days)
                    </label>
                    <input
                      type="number"
                      value={systemForm.log_retention_days || ''}
                      onChange={(e) => setSystemForm({ ...systemForm, log_retention_days: Number(e.target.value) })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min="1"
                      max="365"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Cleanup Retention (days)
                    </label>
                    <input
                      type="number"
                      value={systemForm.cleanup_retention_days || ''}
                      onChange={(e) => setSystemForm({ ...systemForm, cleanup_retention_days: Number(e.target.value) })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min="1"
                      max="365"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={systemForm.email_notifications || false}
                      onChange={(e) => setSystemForm({ ...systemForm, email_notifications: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label className="ml-2 text-sm text-gray-700">Enable Email Notifications</label>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={systemForm.auto_cleanup || false}
                      onChange={(e) => setSystemForm({ ...systemForm, auto_cleanup: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label className="ml-2 text-sm text-gray-700">Enable Auto Cleanup</label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Webhook URL
                    </label>
                    <input
                      type="url"
                      value={systemForm.webhook_url || ''}
                      onChange={(e) => setSystemForm({ ...systemForm, webhook_url: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="https://example.com/webhook"
                    />
                  </div>

                  {/* Database Dump Directory */}
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
                      <Database className="w-4 h-4" />
                      Database Dump Directory
                    </h4>
                    <p className="text-xs text-gray-500 mb-3">
                      When backing up databases (MariaDB, MySQL, PostgreSQL, MongoDB, MSSQL),
                      borgmatic-ui first dumps them to a temporary directory, then includes the
                      dump files in the Borg archive. Large databases can produce multi-GB dumps.
                    </p>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-3 text-xs text-blue-800 space-y-1">
                      <p><strong>Default:</strong> <code className="bg-white px-1 py-0.5 rounded">/tmp</code> (inside the container). This is fine for most setups.</p>
                      <p><strong>When to change:</strong> If your databases are large (1 GB+), the container filesystem may run out of space. Mount an external volume (e.g. <code className="bg-white px-1 py-0.5 rounded">/mnt/db-dumps</code>) and set it here.</p>
                      <p><strong>Cleanup:</strong> Dump files are automatically removed after each backup run and before the next run of the same job. No manual cleanup needed.</p>
                      <p><strong>Changing at any time:</strong> You can update this path whenever you like. The new value applies when a backup job configuration is saved/updated. Existing jobs keep their current dump path until they are saved again.</p>
                    </div>
                    <PathSelectorField
                      value={systemForm.dump_temp_dir || '/tmp'}
                      onChange={(val) => { setSystemForm({ ...systemForm, dump_temp_dir: val }); setDumpDirTest({ loading: false, result: null }); }}
                      placeholder="/tmp"
                      selectMode="directories"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTestDumpDir}
                        disabled={dumpDirTest.loading}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {dumpDirTest.loading
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing...</>
                          : <><FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Test Folder</>
                        }
                      </button>
                      {dumpDirTest.result && !dumpDirTest.result.error && dumpDirTest.result.writable && (
                        <span className="inline-flex items-center text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Writable
                          {dumpDirTest.result.free_space != null && (
                            <span className="ml-1.5 text-green-600">
                              &mdash; {(dumpDirTest.result.free_space / (1024 * 1024 * 1024)).toFixed(1)} GB free
                            </span>
                          )}
                        </span>
                      )}
                      {dumpDirTest.result && (dumpDirTest.result.error || !dumpDirTest.result.writable) && (
                        <span className="inline-flex items-center text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                          <AlertCircle className="w-3.5 h-3.5 mr-1" />
                          {dumpDirTest.result.error || 'Directory is not writable'}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={updateSystemSettingsMutation.isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {updateSystemSettingsMutation.isLoading ? 'Saving...' : 'Save Settings'}
                  </button>
                </form>
              </div>

              {/* System Information */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-lg border">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">System Information</h3>
                  <div className="space-y-3">
                    <div className="flex items-center">
                      <Server className="w-4 h-4 text-gray-400 mr-3" />
                      <span className="text-sm text-gray-600">App Version:</span>
                      <span className="ml-auto text-sm font-medium">{systemForm.app_version}</span>
                    </div>
                    <div className="flex items-center">
                      <Shield className="w-4 h-4 text-gray-400 mr-3" />
                      <span className="text-sm text-gray-600">Borgmatic Version:</span>
                      <span className="ml-auto text-sm font-medium">{systemForm.borgmatic_version}</span>
                    </div>
                    <div className="flex items-center">
                      <Shield className="w-4 h-4 text-gray-400 mr-3" />
                      <span className="text-sm text-gray-600">Edition:</span>
                      <span className={`ml-auto text-sm font-medium ${appEdition === 'commercial' ? 'text-green-600' : 'text-gray-600'}`}>
                        {appEdition === 'commercial' ? 'Commercial' : appEdition === 'community' ? 'Community' : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg border">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">System Maintenance</h3>
                  <button
                    onClick={handleCleanup}
                    disabled={cleanupMutation.isLoading}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {cleanupMutation.isLoading ? 'Running...' : 'Run System Cleanup'}
                  </button>
                  <p className="mt-2 text-xs text-gray-500">
                    Cleans up old logs, temporary files, and expired backups
                  </p>
                </div>

                {/* Archive Cache Section */}
                <div className="bg-white p-6 rounded-lg border">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <Database className="w-5 h-5 mr-2 text-blue-600" />
                    Archive Cache (Redis)
                  </h3>
                  
                  {loadingCache ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-500">Loading cache status...</p>
                    </div>
                  ) : cacheStatus?.data?.cache ? (
                    <div className="space-y-4">
                      {/* Connection Status */}
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center">
                          {cacheStatus.data.cache.connected ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500 mr-2" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                          )}
                          <span className="text-sm font-medium">
                            {cacheStatus.data.cache.connected ? 'Connected' : 'Disconnected'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {cacheStatus.data.cache.host}:{cacheStatus.data.cache.port}
                        </span>
                      </div>

                      {cacheStatus.data.cache.connected && (
                        <>
                          {/* Cache Statistics */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-blue-50 rounded-lg">
                              <div className="flex items-center text-blue-700 mb-1">
                                <HardDrive className="w-4 h-4 mr-1" />
                                <span className="text-xs font-medium">Memory Used</span>
                              </div>
                              <p className="text-lg font-semibold text-blue-900">
                                {cacheStatus.data.cache.memory_used || 'N/A'}
                              </p>
                            </div>
                            <div className="p-3 bg-green-50 rounded-lg">
                              <div className="flex items-center text-green-700 mb-1">
                                <Database className="w-4 h-4 mr-1" />
                                <span className="text-xs font-medium">Cached Entries</span>
                              </div>
                              <p className="text-lg font-semibold text-green-900">
                                {cacheStatus.data.cache.archive_entries ?? cacheStatus.data.cache.keys_count ?? 0}
                              </p>
                            </div>
                          </div>

                          {/* Flush Cache Button */}
                          {user?.is_admin && (
                            <button
                              onClick={() => {
                                if (window.confirm('Are you sure you want to flush the archive cache? This will clear all cached archive listings.')) {
                                  flushCacheMutation.mutate();
                                }
                              }}
                              disabled={flushCacheMutation.isLoading}
                              className="w-full flex justify-center py-2 px-4 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {flushCacheMutation.isLoading ? 'Flushing...' : 'Flush Archive Cache'}
                            </button>
                          )}
                        </>
                      )}

                      {!cacheStatus.data.cache.connected && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-sm text-yellow-800">
                            <strong>Note:</strong> Redis cache is not connected. Archive browsing for Borg 1.x repositories will fetch full listings on each request, which may be slower for large archives.
                          </p>
                        </div>
                      )}

                      {/* Info about caching */}
                      <p className="text-xs text-gray-500 mt-2">
                        Archive cache stores file listings from Borg 1.x repositories to enable faster browsing. 
                        Borg 2.0 repositories use native depth-limited listing and don't require caching.
                      </p>

                      {/* Refresh Button */}
                      <button
                        onClick={() => refetchCache()}
                        className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Refresh Status
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Unable to load cache status</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User Management Tab */}
      {activeTab === 'users' && user?.is_admin && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">User Management</h3>
            <button
              onClick={openCreateUser}
              className="flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </button>
          </div>

          {loadingUsers ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading users...</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Login
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {usersData?.data?.users?.map((user: User) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{user.username}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                          }`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_admin
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                          }`}>
                          {user.is_admin ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => openEditUser(user)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openPasswordModal(user.id)}
                            className="text-yellow-600 hover:text-yellow-900"
                          >
                            <Key className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit User Modal */}
      {(showCreateUser || editingUser) && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingUser ? 'Edit User' : 'Create User'}
              </h3>
              <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    type="text"
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                {!editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                )}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={userForm.is_admin}
                    onChange={(e) => setUserForm({ ...userForm, is_admin: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Admin User</label>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateUser(false);
                      setEditingUser(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    {editingUser ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Reset Password</h3>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(e) => setPasswordForm({ new_password: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordModal(false);
                      setSelectedUserId(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Reset Password
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings; 