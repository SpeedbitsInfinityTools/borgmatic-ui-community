import React, { useState } from 'react';
import { X, Send, Eye, EyeOff, AlertTriangle, Shield, CheckCircle } from 'lucide-react';
import { deploymentsAPI, vaultAPI } from '../services/api';
import { toast } from 'react-hot-toast';

interface Repository {
  id: string;
  name: string;
  path: string;
  path_pattern?: string;
  encryption: string;
  repository_type: string;
  ssh_key_id?: string;
  passphrase?: string;
}

interface DeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: {
    id: string;
    name: string;
    type: string;
    config: any;
  };
  selectedClients: string[];
  onSuccess?: () => void;
}

const DeploymentModal: React.FC<DeploymentModalProps> = ({
  isOpen,
  onClose,
  template,
  selectedClients,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Vault Password, 2: Repository Config, 3: Deploying
  const [masterPassword, setMasterPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  // Initialize repositories from template
  React.useEffect(() => {
    if (isOpen && template.config?.repositories) {
      const repos = template.config.repositories.map((repo: any, index: number) => ({
        id: repo.id || `repo-${index}`,
        name: repo.name || `Repository ${index + 1}`,
        path: repo.path || repo.path_pattern || '',
        path_pattern: repo.path_pattern || repo.path,
        encryption: repo.encryption || 'repokey-blake2',
        repository_type: repo.repository_type || 'local',
        ssh_key_id: repo.ssh_key_id,
        passphrase: '', // Empty by default, will be filled
      }));
      setRepositories(repos);
    }
  }, [isOpen, template]);

  const handleVerifyMasterPassword = async () => {
    if (!masterPassword) {
      toast.error('Master password is required');
      return;
    }

    setIsVerifying(true);
    try {
      await vaultAPI.verify(masterPassword);
      setStep(2);
      toast.success('Master password verified');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Invalid master password');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDeploy = async () => {
    // Validate that we have repositories
    if (repositories.length === 0) {
      toast.error('No repositories configured in this template');
      return;
    }

    // Validate that all repositories have passphrases
    const missingPassphrases = repositories.filter(repo => !repo.passphrase);
    if (missingPassphrases.length > 0) {
      toast.error('All repositories require passphrases');
      return;
    }

    setIsDeploying(true);
    setStep(3);

    try {
      // Deploy to clients
      await deploymentsAPI.deploy({
        template_type: template.type,
        template_id: template.id,
        client_ids: selectedClients,
        master_password: masterPassword,
        repository_configs: repositories,
      });

      toast.success(`Deployment initiated for ${selectedClients.length} client(s)`);

      if (onSuccess) {
        onSuccess();
      }

      // Close after short delay to show success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Deployment failed');
      setStep(2); // Go back to allow retry
    } finally {
      setIsDeploying(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setMasterPassword('');
    setRepositories([]);
    setShowPassword(false);
    onClose();
  };

  const updateRepositoryPassphrase = (repoId: string, passphrase: string) => {
    setRepositories(prev =>
      prev.map(repo =>
        repo.id === repoId ? { ...repo, passphrase } : repo
      )
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Send className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="text-xl font-bold text-gray-900">Deploy Template</h3>
                <p className="text-sm text-gray-600">
                  {template.name} → {selectedClients.length} client(s)
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isDeploying}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-grow">
          {/* Step 1: Master Password Verification */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
                <div className="flex">
                  <Shield className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-blue-800">
                      Vault Password Required
                    </h4>
                    <p className="mt-1 text-sm text-blue-700">
                      Enter your master vault password to decrypt repository passphrases for deployment.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Master Vault Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    placeholder="Enter your master password"
                    className="input w-full pr-10"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyMasterPassword()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Repository Configuration */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-green-50 border-l-4 border-green-400 p-4">
                <div className="flex">
                  <CheckCircle className="w-5 h-5 text-green-400 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-green-800">
                      Master Password Verified
                    </h4>
                    <p className="mt-1 text-sm text-green-700">
                      Configure repository passphrases for deployment
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-gray-900">Repository Passphrases</h4>
                {repositories.map((repo) => (
                  <div key={repo.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="mb-2">
                      <p className="text-sm font-medium text-gray-900">{repo.name}</p>
                      <p className="text-xs text-gray-500">{repo.path_pattern || repo.path}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Passphrase
                      </label>
                      <input
                        type="password"
                        value={repo.passphrase || ''}
                        onChange={(e) => updateRepositoryPassphrase(repo.id, e.target.value)}
                        placeholder="Enter repository passphrase"
                        className="input w-full text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <div className="flex">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-yellow-800">
                      Security Notice
                    </h4>
                    <p className="mt-1 text-sm text-yellow-700">
                      Passphrases will be encrypted with your master password and stored securely in the vault.
                      They will be deployed to clients for repository initialization.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Deploying */}
          {step === 3 && (
            <div className="space-y-4 text-center py-8">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto"></div>
              <h4 className="text-lg font-semibold text-gray-900">Deploying...</h4>
              <p className="text-sm text-gray-600">
                Initializing repositories on {selectedClients.length} client(s)
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
          {step === 1 && (
            <>
              <button
                onClick={handleClose}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyMasterPassword}
                disabled={!masterPassword || isVerifying}
                className="btn-primary"
              >
                {isVerifying ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="btn-secondary"
              >
                Back
              </button>
              <button
                onClick={handleDeploy}
                disabled={isDeploying || repositories.some(r => !r.passphrase)}
                className="btn-primary"
              >
                Deploy to Clients
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeploymentModal;

