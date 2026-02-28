import { useState } from 'react';
import { Key, Eye, EyeOff, AlertTriangle, CheckCircle, Loader2, X, Lock } from 'lucide-react';
import { repositoriesAPI } from '../../services/api';
import { toast } from 'react-hot-toast';

interface PassphraseVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  repository: {
    id: string;
    name?: string;
    label?: string;
    path: string;
    encryption?: string;
  };
  message?: string;
}

export default function PassphraseVerifyModal({
  isOpen,
  onClose,
  onSuccess,
  repository,
  message
}: PassphraseVerifyModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleVerify = async () => {
    if (!passphrase.trim()) {
      setError('Please enter a passphrase');
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      // Save and verify the passphrase
      const response = await repositoriesAPI.updatePassphrase(repository.id, passphrase, true);
      
      if (response.data.success) {
        toast.success('Passphrase verified and saved');
        setPassphrase('');
        onSuccess();
      } else {
        setError(response.data.detail || 'Passphrase verification failed');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Verification failed';
      
      // Check for specific borg errors
      if (errorMsg.includes('passphrase') || errorMsg.includes('incorrect') || errorMsg.includes('Wrong')) {
        setError('Incorrect passphrase. Please try again.');
      } else if (errorMsg.includes('timeout') || errorMsg.includes('Timed out')) {
        setError('Connection timed out. The repository may be unreachable.');
      } else {
        setError(errorMsg);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !verifying) {
      handleVerify();
    }
  };

  const displayName = repository.name || repository.label || repository.path;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-amber-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Lock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Passphrase Required
                  </h3>
                  <p className="text-sm text-gray-500">
                    {repository.encryption || 'encrypted'} repository
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Info message */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <Key className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">{displayName}</p>
                  <p className="text-blue-600 text-xs mt-1 break-all">{repository.path}</p>
                </div>
              </div>
            </div>

            {message && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-800">{message}</p>
                </div>
              </div>
            )}

            {/* Passphrase input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Repository Passphrase
              </label>
              <div className="relative">
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter the repository passphrase"
                  className={`input w-full pr-10 ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                  autoFocus
                  disabled={verifying}
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This is the passphrase used to encrypt the Borg repository
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="btn-secondary"
              disabled={verifying}
            >
              Cancel
            </button>
            <button
              onClick={handleVerify}
              disabled={verifying || !passphrase.trim()}
              className="btn-primary flex items-center space-x-2"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Verify & Save</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

