import { useState, useEffect } from 'react';
import { Server, Users, Monitor, CheckCircle, AlertCircle, Lock } from 'lucide-react';
import { identityAPI } from '../services/api';

interface InitialSetupModalProps {
  onComplete: () => void;
  editionPreview?: string; // For testing/preview: 'community' or 'commercial'
}

interface EditionInfo {
  edition: string;
  available_modes: string[];
}

export default function InitialSetupModal({ onComplete, editionPreview }: InitialSetupModalProps) {
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [editionInfo, setEditionInfo] = useState<EditionInfo | null>(null);

  // Fetch edition info on mount (or use preview if provided)
  useEffect(() => {
    const fetchEditionInfo = async () => {
      // If editionPreview is provided, use it for testing/preview
      if (editionPreview === 'community' || editionPreview === 'commercial') {
        setEditionInfo({
          edition: editionPreview,
          available_modes: editionPreview === 'community'
            ? ['standalone', 'client']
            : ['director', 'standalone', 'client'],
        });
        return;
      }

      // Otherwise fetch from backend
      try {
        const response = await identityAPI.getStatus();
        const data = response.data.data;
        setEditionInfo({
          edition: data.edition || 'commercial',
          available_modes: data.available_modes || ['director', 'standalone', 'client'],
        });
      } catch (err) {
        console.error('Failed to fetch edition info:', err);
        // Default to commercial if we can't fetch
        setEditionInfo({
          edition: 'commercial',
          available_modes: ['director', 'standalone', 'client'],
        });
      }
    };
    fetchEditionInfo();
  }, [editionPreview]);

  const modes = [
    {
      id: 'standalone',
      name: 'Standalone',
      icon: Server,
      description: 'Manage local backups independently',
      details: 'Run backups on this server with full local control. You can later enable Client mode to connect to a Director for remote management.',
      color: 'green',
      available: true,
    },
    {
      id: 'director',
      name: 'Director',
      icon: Users,
      description: 'Central management server',
      details: 'Manage multiple backup clients across your infrastructure from one place.',
      color: 'purple',
      available: editionInfo?.available_modes.includes('director') ?? true,
      upgradeMessage: editionInfo?.edition === 'community'
        ? 'Director mode is only available in the Commercial edition. You can purchase this at www.speedbits.io'
        : undefined,
    }
  ];

  const handleSubmit = async () => {
    if (!selectedMode) return;

    try {
      setLoading(true);
      setError(null);

      const response = await identityAPI.setMode(selectedMode);
      const data = response.data.data;

      setSuccess(true);

      // Check if restart is required (especially for Director mode with SSL)
      if (data.requires_restart) {
        setRequiresRestart(true);
      }

      // For Director mode, show message longer to explain HTTPS restart
      const delay = selectedMode === 'director' && data.requires_restart ? 5000 : 1500;

      // Wait a moment for the success message to be visible, then reload
      setTimeout(() => {
        // Force a full page reload to reinitialize the app with the new mode
        window.location.href = '/dashboard';
      }, delay);
    } catch (err: any) {
      console.error('Failed to set mode:', err);
      // Check for edition/upgrade error
      if (err.response?.status === 402 || err.response?.data?.upgrade_required) {
        setError(err.response?.data?.detail || 'This feature requires an upgrade');
      } else {
        setError(err.response?.data?.detail || 'Failed to set operating mode');
      }
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900 bg-opacity-75 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Server className="w-8 h-8 text-primary-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to Borgmatic Director UI!
          </h2>
          <p className="text-gray-600">
            Please select how you want to use this installation
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800 mb-1">
                {selectedMode === 'director' ? 'Director Mode' : 'Standalone Mode'} configured successfully!
              </p>
              {requiresRestart && selectedMode === 'director' && (
                <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-900">
                  <p className="font-semibold mb-1">⚠️ Server Restart Required</p>
                  <p className="mb-1">
                    Director mode uses HTTPS for secure connections. The server will need to restart to enable SSL.
                  </p>
                  <p className="font-medium">
                    Please restart your server after this page reloads for HTTPS to take effect.
                  </p>
                </div>
              )}
              {!requiresRestart && (
                <p className="text-xs text-green-700 mt-1">Redirecting to dashboard...</p>
              )}
            </div>
          </div>
        )}

        {/* Mode Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isSelected = selectedMode === mode.id;
            const isDisabled = !mode.available || loading || success;

            return (
              <button
                key={mode.id}
                onClick={() => mode.available && setSelectedMode(mode.id)}
                disabled={isDisabled}
                className={`
                  relative p-6 rounded-lg border-2 transition-all text-left
                  ${!mode.available ? 'opacity-60 cursor-not-allowed bg-gray-50' :
                    isSelected
                      ? `border-${mode.color}-500 bg-${mode.color}-50 shadow-lg`
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }
                  ${loading || success ? 'opacity-50 cursor-not-allowed' : mode.available ? 'cursor-pointer' : 'cursor-not-allowed'}
                `}
              >
                {/* Locked indicator for unavailable modes */}
                {!mode.available && (
                  <div className="absolute top-4 right-4 w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                    <Lock className="w-4 h-4 text-white" />
                  </div>
                )}

                {/* Selected indicator */}
                {isSelected && mode.available && (
                  <div className={`absolute top-4 right-4 w-6 h-6 bg-${mode.color}-500 rounded-full flex items-center justify-center`}>
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                )}

                {/* Icon */}
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-4 ${!mode.available ? 'bg-gray-200' :
                  isSelected ? `bg-${mode.color}-100` : 'bg-gray-100'
                  }`}>
                  <Icon className={`w-6 h-6 ${!mode.available ? 'text-gray-400' :
                    isSelected ? `text-${mode.color}-600` : 'text-gray-600'
                    }`} />
                </div>

                {/* Content */}
                <h3 className={`text-lg font-semibold mb-2 ${!mode.available ? 'text-gray-500' : 'text-gray-900'}`}>
                  {mode.name}
                </h3>
                <p className={`text-sm mb-3 ${!mode.available ? 'text-gray-400' : 'text-gray-600'}`}>
                  {mode.description}
                </p>
                <p className={`text-xs ${!mode.available ? 'text-gray-400' : 'text-gray-500'}`}>
                  {mode.details}
                </p>

                {/* Upgrade message for locked modes */}
                {!mode.available && mode.upgradeMessage && (
                  <div className="mt-4 p-4 bg-amber-50 border-2 border-amber-300 rounded-lg">
                    <p className="text-sm text-amber-900 font-semibold leading-relaxed">
                      Director mode is only available in the Commercial edition.
                    </p>
                    <a
                      href="https://www.speedbits.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center mt-2 text-base font-bold text-amber-700 hover:text-amber-900 underline hover:no-underline transition-colors"
                    >
                      Get Commercial Edition at www.speedbits.io →
                    </a>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Important Notes:</h4>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li><strong>Standalone/Client</strong> mode works standalone by default. When you connect to a Director in Settings, it automatically becomes Client mode.</li>
            <li><strong>Director</strong> mode listens on the HTTP server port (default 8000) for Socket.IO client connections.</li>
            <li>Both modes use Ed25519 encryption for secure communication</li>
            <li>You can change this later in Settings (requires restart)</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-4">
          <button
            onClick={handleSubmit}
            disabled={!selectedMode || loading || success}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                <span>Configuring...</span>
              </>
            ) : success ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Configured!</span>
              </>
            ) : (
              <>
                <span>Continue</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

