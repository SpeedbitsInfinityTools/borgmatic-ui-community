import { useState, useEffect, useRef } from 'react';
import { Server, Monitor, Users, AlertTriangle, RefreshCw, AlertCircle, ArrowLeftRight, ToggleLeft, ToggleRight, Link2, Unlink, FolderOpen, Trash2 } from 'lucide-react';
import { identityAPI } from '../services/api';
import { toast } from 'react-hot-toast';

export default function ModeSettings() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Switch mode state (for director switch - destructive)
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [switchConfirmation, setSwitchConfirmation] = useState('');
  const [switchingMode, setSwitchingMode] = useState(false);

  // Toggle standalone state (non-destructive)
  const [togglingStandalone, setTogglingStandalone] = useState(false);

  // Factory reset state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [regenerateSecretKey, setRegenerateSecretKey] = useState(false);
  const resetModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  // Scroll reset modal to top when opened
  useEffect(() => {
    if (showResetModal && resetModalRef.current) {
      resetModalRef.current.scrollTop = 0;
    }
  }, [showResetModal]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const response = await identityAPI.getStatus();
      const data = response.data.data;
      setStatus(data);
    } catch (err: any) {
      console.error('Failed to fetch identity status:', err);
      setError(err.response?.data?.detail || 'Failed to load mode settings');
    } finally {
      setLoading(false);
    }
  };


  const handleSwitchMode = async () => {
    if (switchConfirmation !== 'switch') {
      toast.error('You must type "switch" to confirm');
      return;
    }

    // Director mode switch uses the old destructive endpoint
    // From director -> standalone, from client/standalone -> director
    const newMode = status.mode === 'director' ? 'standalone' : 'director';

    try {
      setSwitchingMode(true);
      const response = await identityAPI.switchMode(newMode, switchConfirmation);
      const data = response.data.data;

      // Show different message based on mode and restart requirement
      if (data.requires_restart && newMode === 'director') {
        toast.success(`Mode switched to Director. HTTPS enabled - please restart the server!`, { duration: 5000 });
      } else {
        toast.success(`Mode switched to ${data.new_mode}. Reloading...`);
      }

      // Show what was lost
      if (data.data_lost && data.data_lost.length > 0) {
        console.warn('Data lost during mode switch:', data.data_lost);
      }

      // Reload after longer delay if restart needed
      const delay = (data.requires_restart && newMode === 'director') ? 6000 : 2000;
      setTimeout(() => {
        window.location.reload();
      }, delay);
    } catch (err: any) {
      console.error('Failed to switch mode:', err);
      toast.error(err.response?.data?.detail || 'Failed to switch mode');
      setSwitchingMode(false);
    }
  };

  // Toggle between standalone and client modes (non-destructive)
  const handleToggleStandalone = async () => {
    try {
      setTogglingStandalone(true);
      const response = await identityAPI.toggleStandalone();
      const data = response.data.data;

      toast.success(data.message);

      // Refresh status after a short delay
      setTimeout(() => {
        fetchStatus();
        setTogglingStandalone(false);
      }, 500);
    } catch (err: any) {
      console.error('Failed to toggle mode:', err);
      toast.error(err.response?.data?.detail || 'Failed to toggle mode');
      setTogglingStandalone(false);
    }
  };

  // Factory reset the entire instance
  const handleFactoryReset = async () => {
    if (resetConfirmation !== 'RESET') {
      toast.error('You must type "RESET" to confirm');
      return;
    }

    try {
      setResetting(true);
      const response = await identityAPI.factoryReset(resetConfirmation, regenerateSecretKey);
      const data = response.data.data;

      // Show what was deleted
      if (data.deleted && data.deleted.length > 0) {
        console.log('Factory reset deleted:', data.deleted);
      }
      if (data.errors && data.errors.length > 0) {
        console.warn('Factory reset errors:', data.errors);
      }

      toast.success('Factory reset complete! Reloading...', { duration: 3000 });

      // Reload after delay
      setTimeout(() => {
        window.location.href = '/'; // Go to login page
      }, 2000);
    } catch (err: any) {
      console.error('Failed to factory reset:', err);
      toast.error(err.response?.data?.detail || 'Failed to factory reset');
      setResetting(false);
    }
  };

  const getModeIcon = () => {
    switch (status?.mode) {
      case 'standalone':
        return <Server className="w-6 h-6 text-green-600" />;
      case 'client':
        return <Monitor className="w-6 h-6 text-blue-600" />;
      case 'director':
        return <Users className="w-6 h-6 text-purple-600" />;
      default:
        return <Server className="w-6 h-6 text-gray-600" />;
    }
  };

  const getModeLabel = () => {
    switch (status?.mode) {
      case 'standalone':
        return 'Standalone Mode';
      case 'client':
        return 'Client Mode';
      case 'director':
        return 'Director Mode';
      default:
        return 'Not Configured';
    }
  };

  const getModeColor = () => {
    switch (status?.mode) {
      case 'standalone':
        return 'green';
      case 'client':
        return 'blue';
      case 'director':
        return 'purple';
      default:
        return 'gray';
    }
  };

  const isClientOrStandalone = status?.mode === 'client' || status?.mode === 'standalone';


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Mode */}
      <div className="card">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Operating Mode</h3>
          <p className="mt-1 text-sm text-gray-500">
            Configure how this Borgmatic Director UI instance operates
          </p>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className={`flex items-center space-x-4 p-4 bg-${getModeColor()}-50 border border-${getModeColor()}-200 rounded-lg`}>
            <div className={`p-3 bg-${getModeColor()}-100 rounded-lg`}>
              {getModeIcon()}
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-gray-900">{getModeLabel()}</h4>
              <p className="text-sm text-gray-600">
                {status?.mode === 'standalone' && 'Managing local backups independently'}
                {status?.mode === 'client' && 'Can connect to a Director for remote management'}
                {status?.mode === 'director' && 'Central management server for multiple clients'}
              </p>
            </div>
          </div>

          {/* Standalone ↔ Client Toggle (non-destructive) */}
          {isClientOrStandalone && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">
                    {status?.mode === 'standalone' ? 'Enable Client Mode' : 'Switch to Standalone'}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {status?.mode === 'standalone' 
                      ? 'Enable client mode to connect to a Director server for remote management.'
                      : 'Disconnect from Director and manage backups independently. This will clear your Director connection settings.'
                    }
                  </p>
                </div>
                <button
                  onClick={handleToggleStandalone}
                  disabled={togglingStandalone}
                  className={`ml-4 flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                    status?.mode === 'standalone'
                      ? 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                      : 'bg-green-100 hover:bg-green-200 text-green-700'
                  } ${togglingStandalone ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {togglingStandalone ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : status?.mode === 'standalone' ? (
                    <>
                      <Link2 className="w-5 h-5" />
                      <span>Enable Client</span>
                    </>
                  ) : (
                    <>
                      <Unlink className="w-5 h-5" />
                      <span>Go Standalone</span>
                    </>
                  )}
                </button>
              </div>
              {status?.mode === 'client' && status?.identity?.director_url && (
                <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                  <strong>Note:</strong> You are currently connected to <code className="bg-yellow-100 px-1 rounded">{status.identity.director_url}</code>. 
                  Switching to standalone will disconnect and clear this configuration.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Note: Client Configuration has moved to Settings → Client Configuration tab */}
      {/* Note: Director Configuration has moved to Settings → Connection Configuration tab */}

      {/* Data Paths */}
      {status?.paths && (
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <FolderOpen className="w-5 h-5 text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-900">Data Storage Paths</h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Where configuration and data files are stored for this mode
            </p>
          </div>

          <div className="p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-600">Configuration</span>
                <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono text-gray-800">
                  {status.paths.config}
                </code>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-600">Data</span>
                <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono text-gray-800">
                  {status.paths.data}
                </code>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-600">Logs</span>
                <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono text-gray-800">
                  {status.paths.logs}
                </code>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-600">Backups</span>
                <code className="text-sm bg-gray-100 px-2 py-1 rounded font-mono text-gray-800">
                  {status.paths.backups}
                </code>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              <strong>Note:</strong> In production, paths are mode-specific:
              <ul className="mt-1 ml-4 list-disc">
                <li>Client/Standalone: <code className="bg-blue-100 px-1 rounded">/opt/speedbits/borgmatic-ui-client/</code></li>
                <li>Director: <code className="bg-blue-100 px-1 rounded">/opt/speedbits/borgmatic-ui-director/</code></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* DANGER ZONE: Switch to/from Director Mode (destructive operation) */}
      {status?.mode && (
        <div className="card border-2 border-red-300">
          <div className="p-6 bg-red-50 border-b border-red-200">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="text-lg font-semibold text-red-900">Danger Zone</h3>
            </div>
            <p className="mt-1 text-sm text-red-700">
              Irreversible actions that will result in data loss
            </p>
          </div>

          <div className="p-6">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  {status.mode === 'director' ? 'Switch to Client/Standalone' : 'Switch to Director Mode'}
                </h4>
                <p className="text-sm text-gray-600 mb-2">
                  {status.mode === 'director' ? (
                    <>Switch from <span className="font-semibold text-purple-600">Director</span> to <span className="font-semibold text-blue-600">Client/Standalone</span> mode</>
                  ) : (
                    <>Switch from <span className="font-semibold text-blue-600">{status.mode === 'standalone' ? 'Standalone' : 'Client'}</span> to <span className="font-semibold text-purple-600">Director</span> mode</>
                  )}
                </p>

                <p className="text-xs text-gray-500 mb-4 bg-gray-50 p-2 rounded border border-gray-200">
                  {status.mode === 'director' ? (
                    <><strong>Warning:</strong> This will delete all registered clients and their approval history.</>
                  ) : (
                    <><strong>Warning:</strong> This will generate a new cryptographic identity and enable Director mode. Your backup configurations will be preserved.</>
                  )}
                </p>

                <button
                  onClick={() => setShowSwitchModal(true)}
                  className="btn-danger flex items-center space-x-2"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  <span>{status.mode === 'director' ? 'Switch to Client/Standalone' : 'Switch to Director'}</span>
                </button>
              </div>

              {/* Factory Reset */}
              <div className="pt-4 border-t border-red-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Factory Reset
                </h4>
                <p className="text-sm text-gray-600 mb-2">
                  Completely reset this Borgmatic UI instance to a fresh state
                </p>

                <p className="text-xs text-gray-500 mb-4 bg-gray-50 p-2 rounded border border-gray-200">
                  <strong>Warning:</strong> This will delete ALL configurations, repositories, schedules, SSH keys, 
                  passphrases, and return the system to initial setup. Your admin login will be preserved.
                </p>

                <button
                  onClick={() => setShowResetModal(true)}
                  className="btn-danger flex items-center space-x-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Factory Reset</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Switch Mode Confirmation Modal */}
      {showSwitchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <div className="p-6 border-b border-gray-200 bg-red-50">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-6 h-6 text-red-600" />
                <h3 className="text-xl font-bold text-red-900">
                  Warning: Destructive Action
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <div className="flex">
                  <AlertCircle className="w-5 h-5 text-yellow-400 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-yellow-800">
                      This action will permanently delete data and seriously hamper your current configuration!
                    </h4>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">The following data will be PERMANENTLY DELETED:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                  {status.mode === 'director' && (
                    <>
                      <li>All registered and approved clients</li>
                      <li>Client approval history and connection logs</li>
                      <li>Director server state</li>
                    </>
                  )}
                  {(status.mode === 'client' || status.mode === 'standalone') && (
                    <>
                      <li>Director connection settings (if any)</li>
                      <li>Client approval status</li>
                      <li>Connection authentication</li>
                    </>
                  )}
                  <li>Current cryptographic identity (new keys will be generated)</li>
                </ul>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-semibold text-gray-900 mb-2">What will be preserved:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  <li>Local backup configurations</li>
                  <li>Backup schedules</li>
                  <li>Repository settings</li>
                  <li>Backup archives</li>
                </ul>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Type <span className="text-red-600 font-mono">switch</span> to confirm:
                </label>
                <input
                  type="text"
                  value={switchConfirmation}
                  onChange={(e) => setSwitchConfirmation(e.target.value)}
                  placeholder="Type 'switch' here"
                  className="input w-full"
                  autoFocus
                  disabled={switchingMode}
                />
              </div>

              {switchConfirmation && switchConfirmation !== 'switch' && (
                <p className="text-sm text-red-600">
                  ⚠️ You must type exactly "switch" (without quotes)
                </p>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowSwitchModal(false);
                  setSwitchConfirmation('');
                }}
                className="btn-secondary"
                disabled={switchingMode}
              >
                Cancel
              </button>
              <button
                onClick={handleSwitchMode}
                disabled={switchConfirmation !== 'switch' || switchingMode}
                className="btn-danger flex items-center space-x-2"
              >
                {switchingMode ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Switching...</span>
                  </>
                ) : (
                  <>
                    <ArrowLeftRight className="w-4 h-4" />
                    <span>Switch to {status.mode === 'director' ? 'Standalone' : 'Director'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory Reset Confirmation Modal */}
      {showResetModal && (
        <div ref={resetModalRef} className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200 bg-red-600">
              <div className="flex items-center space-x-3">
                <Trash2 className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white">
                  Factory Reset - Complete Data Deletion
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-red-100 border-l-4 border-red-600 p-4">
                <div className="flex">
                  <AlertTriangle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-800">
                      This action will permanently delete ALL your data and configurations!
                    </h4>
                    <p className="text-sm text-red-700 mt-1">
                      This cannot be undone. Make sure you have backups of any important data.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">The following will be PERMANENTLY DELETED:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 bg-gray-50 p-3 rounded border">
                  <li>All backup job configurations</li>
                  <li>All repository settings and connections</li>
                  <li>All saved backup schedules</li>
                  <li>All SSH keys and credentials</li>
                  <li>All encrypted repository passphrases</li>
                  <li>Operating mode configuration</li>
                  <li>Director client registrations (if in Director mode)</li>
                  <li>Template configurations</li>
                  <li>Deployment configurations</li>
                </ul>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-semibold text-gray-900 mb-2">What will be PRESERVED:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-green-700 bg-green-50 p-3 rounded border border-green-200">
                  <li>Admin login credentials (so you can log back in)</li>
                  <li>SECRET_KEY (for security)</li>
                  <li>SSL certificates (if generated)</li>
                  <li><strong>Actual backup archives</strong> in your repositories (untouched)</li>
                </ul>
              </div>

              {/* Option to regenerate SECRET_KEY */}
              <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regenerateSecretKey}
                    onChange={(e) => setRegenerateSecretKey(e.target.checked)}
                    className="mt-1 h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                    disabled={resetting}
                  />
                  <div className="ml-3">
                    <span className="font-semibold text-yellow-800">Also regenerate SECRET_KEY</span>
                    <p className="text-sm text-yellow-700 mt-1">
                      Creates a completely new encryption key. After reset, you will need to 
                      <strong> re-enter all repository passphrases</strong> when accessing encrypted repositories.
                    </p>
                    {regenerateSecretKey && (
                      <p className="text-sm text-red-700 mt-2 font-medium">
                        ⚠️ Any encrypted data from the old key will be unrecoverable!
                      </p>
                    )}
                  </div>
                </label>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Type <span className="text-red-600 font-mono">RESET</span> to confirm:
                </label>
                <input
                  type="text"
                  value={resetConfirmation}
                  onChange={(e) => setResetConfirmation(e.target.value)}
                  placeholder="Type 'RESET' here"
                  className="input w-full"
                  autoFocus
                  disabled={resetting}
                />
              </div>

              {resetConfirmation && resetConfirmation !== 'RESET' && (
                <p className="text-sm text-red-600">
                  ⚠️ You must type exactly "RESET" (uppercase, without quotes)
                </p>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmation('');
                  setRegenerateSecretKey(false);
                }}
                className="btn-secondary"
                disabled={resetting}
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={resetConfirmation !== 'RESET' || resetting}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md font-medium flex items-center space-x-2 disabled:opacity-50"
              >
                {resetting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Factory Reset</span>
                  </>
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

