import React from 'react';
import {
  Plus,
  Trash2,
  Check,
  HardDrive,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { getSafeDisplayPath } from '../../utils/repositoryUtils';

export interface WizardStepRepositoriesProps {
  formData: any;
  setFormData: (fd: any) => void;
  errors: Record<string, string>;
  mode?: string;
  availableRepositories: any[];
  isLoadingRepos: boolean;
  availableSSHKeys: any[];
  toggleRepository: (repo: any) => void;
}

const WizardStepRepositories: React.FC<WizardStepRepositoriesProps> = ({
  formData, setFormData, errors, mode,
  availableRepositories, isLoadingRepos, availableSSHKeys, toggleRepository,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-2">
          {mode === 'template' ? 'Configure Repository Templates' : 'Select Target Repositories'} <span className="text-red-500">*</span>
        </h4>
        <p className="text-sm text-gray-500">
          {mode === 'template'
            ? 'Define repository path patterns. Variables: {hostname}, {client_id}, {date}'
            : 'Choose at least one repository where backups will be stored'
          }
        </p>
      </div>

      {errors.repositories && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{errors.repositories}</p>
        </div>
      )}

      {mode === 'template' ? (
        <TemplateRepositories formData={formData} setFormData={setFormData} availableSSHKeys={availableSSHKeys} />
      ) : (
        <ProductionRepositories
          formData={formData}
          availableRepositories={availableRepositories}
          isLoadingRepos={isLoadingRepos}
          toggleRepository={toggleRepository}
        />
      )}
    </div>
  );
};

interface TemplateRepositoriesProps {
  formData: any;
  setFormData: (fd: any) => void;
  availableSSHKeys: any[];
}

const TemplateRepositories: React.FC<TemplateRepositoriesProps> = ({ formData, setFormData, availableSSHKeys }) => {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <p className="text-sm text-blue-700">
          <strong>Repository templates</strong> define where backups will be stored when deployed to clients.
          Use path patterns with variables that will be expanded during deployment:
        </p>
        <ul className="mt-2 text-xs text-blue-600 space-y-1 ml-4 list-disc">
          <li><code className="bg-blue-100 px-1 rounded">{'{hostname}'}</code> - Client's hostname</li>
          <li><code className="bg-blue-100 px-1 rounded">{'{client_id}'}</code> - Unique client identifier</li>
          <li><code className="bg-blue-100 px-1 rounded">{'{date}'}</code> - Current date (YYYY-MM-DD)</li>
        </ul>
      </div>

      {formData.repositories.map((repo: any, index: number) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="font-medium text-gray-900">Repository Template {index + 1}</h5>
            <button
              onClick={() => {
                setFormData({
                  ...formData,
                  repositories: formData.repositories.filter((_: any, i: number) => i !== index)
                });
              }}
              className="text-red-600 hover:text-red-800"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repository Name</label>
            <input
              type="text"
              value={repo.label || repo.name || ''}
              onChange={(e) => {
                const updated = [...formData.repositories];
                updated[index] = { ...updated[index], label: e.target.value, name: e.target.value };
                setFormData({ ...formData, repositories: updated });
              }}
              placeholder="e.g., Primary Backup Repository"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Path Pattern</label>
            <input
              type="text"
              value={repo.path_pattern || repo.path || ''}
              onChange={(e) => {
                const updated = [...formData.repositories];
                updated[index] = { ...updated[index], path_pattern: e.target.value, path: e.target.value };
                setFormData({ ...formData, repositories: updated });
              }}
              placeholder="/backup/borg/{hostname}"
              className="input w-full font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Example: <code className="bg-gray-100 px-1 rounded">/backup/borg/{'{hostname}'}/primary</code>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Encryption</label>
              <select
                value={repo.encryption || 'repokey-blake2-aes-ocb'}
                onChange={(e) => {
                  const updated = [...formData.repositories];
                  updated[index] = { ...updated[index], encryption: e.target.value };
                  setFormData({ ...formData, repositories: updated });
                }}
                className="input w-full"
              >
                <optgroup label="Recommended (Borg 2.0)">
                  <option value="repokey-blake2-aes-ocb">repokey-blake2-aes-ocb (Recommended)</option>
                  <option value="repokey-blake2-chacha20-poly1305">repokey-blake2-chacha20 (Older CPUs)</option>
                </optgroup>
                <optgroup label="Key in Repository">
                  <option value="repokey-aes-ocb">repokey-aes-ocb</option>
                  <option value="repokey-chacha20-poly1305">repokey-chacha20-poly1305</option>
                </optgroup>
                <optgroup label="Key in File">
                  <option value="keyfile-blake2-aes-ocb">keyfile-blake2-aes-ocb</option>
                  <option value="keyfile-blake2-chacha20-poly1305">keyfile-blake2-chacha20</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Repository Type</label>
              <select
                value={repo.repository_type || 'local'}
                onChange={(e) => {
                  const updated = [...formData.repositories];
                  updated[index] = { ...updated[index], repository_type: e.target.value };
                  setFormData({ ...formData, repositories: updated });
                }}
                className="input w-full"
              >
                <option value="local">Local</option>
                <option value="ssh">SSH</option>
                <option value="sftp">SFTP</option>
                <option value="s3">S3</option>
                <option value="rclone">Rclone</option>
              </select>
            </div>
          </div>

          {(repo.repository_type === 'ssh' || repo.repository_type === 'sftp') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SSH Key <span className="text-red-500">*</span>
              </label>
              <select
                value={repo.ssh_key_id || ''}
                onChange={(e) => {
                  const updated = [...formData.repositories];
                  updated[index] = { ...updated[index], ssh_key_id: e.target.value };
                  setFormData({ ...formData, repositories: updated });
                }}
                className="input w-full"
              >
                <option value="">Select SSH Key</option>
                {availableSSHKeys.map((key: any) => (
                  <option key={key.id} value={key.id}>
                    {key.name} ({key.username}@{key.hostname})
                  </option>
                ))}
              </select>
              {availableSSHKeys.length === 0 && (
                <p className="mt-1 text-xs text-yellow-600">
                  No SSH keys available. Create one in Settings → SSH Keys.
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={() => {
          setFormData({
            ...formData,
            repositories: [
              ...formData.repositories,
              {
                id: `repo-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                name: `Repository ${formData.repositories.length + 1}`,
                label: `Repository ${formData.repositories.length + 1}`,
                path_pattern: '/backup/borg/{hostname}',
                path: '/backup/borg/{hostname}',
                encryption: 'repokey-blake2-aes-ocb',
                repository_type: 'local'
              }
            ]
          });
        }}
        className="btn-secondary w-full flex items-center justify-center space-x-2"
      >
        <Plus className="w-4 h-4" />
        <span>Add Repository Template</span>
      </button>
    </div>
  );
};

interface ProductionRepositoriesProps {
  formData: any;
  availableRepositories: any[];
  isLoadingRepos: boolean;
  toggleRepository: (repo: any) => void;
}

const ProductionRepositories: React.FC<ProductionRepositoriesProps> = ({
  formData, availableRepositories, isLoadingRepos, toggleRepository,
}) => {
  return (
    <>
      {!isLoadingRepos && availableRepositories.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableRepositories.map((repo: any) => {
              const isSelected = formData.repositories.some((r: any) => r.path === repo.path);
              return (
                <div
                  key={repo.path}
                  onClick={() => toggleRepository(repo)}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all overflow-hidden ${isSelected
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                    }`}
                >
                  <div className="flex items-start space-x-3">
                    <HardDrive className={`w-6 h-6 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                    <div className="min-w-0 flex-1">
                      <h5 className="font-medium text-gray-900">{repo.name}</h5>
                      <p className="text-sm text-gray-500 break-all">{getSafeDisplayPath(repo.path)}</p>
                      <div className="flex items-center mt-1 space-x-2 text-xs text-gray-500">
                        <span className="bg-gray-100 px-2 py-0.5 rounded">{repo.encryption}</span>
                        <span className="bg-gray-100 px-2 py-0.5 rounded">{repo.compression}</span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoadingRepos && (
        <div className="text-center py-8 text-gray-500">
          <Loader2 className="w-12 h-12 mx-auto mb-2 text-blue-500 animate-spin" />
          <p>Loading repositories...</p>
        </div>
      )}

      {!isLoadingRepos && availableRepositories.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <HardDrive className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p>No repositories available. Please create a repository first.</p>
        </div>
      )}
    </>
  );
};

export default WizardStepRepositories;
