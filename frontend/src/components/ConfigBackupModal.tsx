import { useEffect, useState } from 'react';
import { X, Download, AlertCircle } from 'lucide-react';
import { dashboardAPI } from '../services/api';

interface ConfigBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ConfigBackupModal({ isOpen, onClose }: ConfigBackupModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'view' | 'download'>('view');

  useEffect(() => {
    if (isOpen) {
      setStep('view');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  const handleDownloadMasterKey = async () => {
    try {
      setLoading(true);
      setError(null);

      const resp = await dashboardAPI.downloadVaultMasterKey();
      const blob = new Blob([resp.data], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.secret_key';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Failed to download vault master key:', err);
      setError('Failed to download vault master key');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Call API to download ZIP
      const token = localStorage.getItem('access_token');
      const response = await fetch('/api/dashboard/download-config-zip', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download backup');
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'borgmatic-director-ui-backup.bac.zip';
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="(.+)"/);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setStep('download');
    } catch (err: any) {
      console.error('Failed to download backup:', err);
      setError('Failed to download backup ZIP');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Download Borgmatic-UI Configuration Backup
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            )}

            {step === 'view' && (
              <>
                {/* Warning */}
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-yellow-900">Important: Back up your vault master key!</h3>
                      <p className="mt-1 text-sm text-yellow-800">
                        Your passphrase vault is encrypted with a master key stored in <span className="font-mono">.secret_key</span>. If you lose it, you cannot decrypt stored passphrases, SSH secrets, or database credentials.
                      </p>
                      <p className="mt-2 text-sm font-semibold text-yellow-900">
                        ⚠️ Store <span className="font-mono">.secret_key</span> in a safe place (e.g. password manager / offline backup).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Master key download */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleDownloadMasterKey}
                    disabled={loading}
                    className="btn-secondary flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Vault Master Key (.secret_key)</span>
                  </button>
                  <button
                    onClick={handleDownloadZip}
                    disabled={loading}
                    className="btn-primary flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Backup ZIP</span>
                  </button>
                </div>

                {/* What's Included */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">What Will Be Backed Up:</h3>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-1">Configuration Files (config/):</h4>
                        <ul className="space-y-1 text-sm text-gray-600 ml-4">
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span>All backup job configurations (borgmatic.d/*.yaml)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span>Repository definitions (repositories-unused.yaml)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span>Backup metadata and schedules (backups-metadata.yaml, saved_schedules.yaml)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span>Retention profiles (retention-profiles.yaml)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span>Admin user configuration (admin.yaml)</span>
                          </li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-1">Encrypted Data (data/):</h4>
                        <ul className="space-y-1 text-sm text-gray-600 ml-4">
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            <span>Repository passphrases (encrypted with backup password)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            <span>SSH private keys and passwords (encrypted)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            <span>Database credentials (encrypted)</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            <span>Director/Client authentication keys (encrypted)</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                    <p className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                      <strong>Note:</strong> Logs are excluded from the backup to reduce file size. You can restore this backup on a new Borgmatic Director UI installation using the Import feature in Settings.
                    </p>
                  </div>
                </div>
              </>
            )}

            {step === 'download' && (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Backup Downloaded Successfully!</h3>
                <p className="text-sm text-gray-600">
                  Your configuration backup has been downloaded. Store it in a safe location along with your backup password.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
            {step === 'view' && (
              <>
                <button
                  onClick={onClose}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDownloadZip}
                  className="btn-primary flex items-center space-x-2"
                  disabled={loading}
                >
                  <Download className="w-4 h-4" />
                  <span>{loading ? 'Preparing...' : 'Download Backup'}</span>
                </button>
              </>
            )}
            {step === 'download' && (
              <button
                onClick={onClose}
                className="btn-primary"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

