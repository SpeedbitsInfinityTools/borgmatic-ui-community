import React from 'react';
import {
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import PathSelectorField from '../PathSelectorField';

export interface WizardStepAdvancedProps {
  formData: any;
  setFormData: (fd: any) => void;
  hasLocalFolderSources: boolean;
  patternErrors: Record<number, string>;
  addExcludePattern: () => void;
  removeExcludePattern: (index: number) => void;
  updateExcludePattern: (index: number, value: string) => void;
  createCanaryFile: (filePath: string) => void;
  canaryFileCreating: boolean;
}

const WizardStepAdvanced: React.FC<WizardStepAdvancedProps> = ({
  formData, setFormData,
  hasLocalFolderSources,
  patternErrors,
  addExcludePattern, removeExcludePattern, updateExcludePattern,
  createCanaryFile, canaryFileCreating,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-2">
          Advanced Settings
        </h4>
        <p className="text-sm text-gray-500">
          Optional configuration for fine-tuning your backup
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - General Settings */}
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Rate Limit (KB/s)
            </label>
            <input
              type="number"
              value={formData.upload_rate_limit}
              onChange={(e) =>
                setFormData({ ...formData, upload_rate_limit: parseInt(e.target.value) || 0 })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="0 = unlimited"
            />
            <p className="mt-1 text-xs text-gray-500">0 = unlimited bandwidth</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Check Frequency
            </label>
            <select
              value={formData.check_frequency}
              onChange={(e) =>
                setFormData({ ...formData, check_frequency: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="1 week">Weekly</option>
              <option value="2 weeks">Every 2 weeks</option>
              <option value="1 month">Monthly</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">How often to check repository integrity</p>
          </div>

          <div>
            <PathSelectorField
              label="Log File Path (Optional)"
              value={formData.log_file}
              onChange={(value) => setFormData({ ...formData, log_file: value })}
              placeholder="Use system-managed location"
              selectMode="both"
              helperText="Leave empty to use the system-managed log location with automatic rotation and cleanup."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Archive Name Format
            </label>
            <input
              type="text"
              value={formData.archive_name_format}
              onChange={(e) =>
                setFormData({ ...formData, archive_name_format: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={formData.name
                ? `{hostname}-${formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-{now}`
                : '{hostname}-{now}'}
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave empty to auto-generate from backup name. Variables:{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{'{hostname}'}</code>,{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{'{now}'}</code>,{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{'{user}'}</code>
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="exclude_caches"
              checked={formData.exclude_caches}
              onChange={(e) =>
                setFormData({ ...formData, exclude_caches: e.target.checked })
              }
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="exclude_caches" className="ml-2 block text-sm text-gray-700">
              Exclude cache directories automatically
              <span className="block text-xs text-gray-500 mt-1">
                Excludes directories containing a CACHEDIR.TAG file (standard cache marker)
              </span>
            </label>
          </div>

          {/* Ransomware Detection (Canary File) */}
          {hasLocalFolderSources && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start">
                <input
                  type="checkbox"
                  id="canary_file_enabled"
                  checked={formData.canary_file_enabled}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      canary_file_enabled: e.target.checked,
                      canary_file_path: e.target.checked ? formData.canary_file_path : ''
                    });
                  }}
                  className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded mt-1"
                />
                <label htmlFor="canary_file_enabled" className="ml-2 block text-sm text-gray-700">
                  <span className="font-medium text-amber-800">Ransomware Detection (Canary File)</span>
                  <span className="block text-xs text-gray-600 mt-1">
                    Select a file that will be monitored before each backup. If the file is altered or deleted,
                    the backup will stop and alert you - an early warning sign of potential ransomware activity.
                  </span>
                </label>
              </div>

              {formData.canary_file_enabled && (
                <div className="ml-6 space-y-3">
                  <PathSelectorField
                    label="Canary File"
                    value={formData.canary_file_path}
                    onChange={(value) => setFormData({ ...formData, canary_file_path: value })}
                    placeholder="/home/user/documents/important-file.txt"
                    selectMode="both"
                    helperText="Select an existing file or enter a path to auto-create one"
                  />

                  {formData.canary_file_path && !formData.canary_file_path.includes('.') && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const timestamp = Date.now().toString(36);
                          const randomPart = Math.random().toString(36).substring(2, 8);
                          const canaryPath = `${formData.canary_file_path}/canary_${timestamp}_${randomPart}.dat`;
                          createCanaryFile(canaryPath);
                        }}
                        disabled={canaryFileCreating}
                        className="btn-secondary text-xs flex items-center gap-1"
                      >
                        {canaryFileCreating ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            Auto-create canary file in this folder
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-amber-700">
                    <strong>Tip:</strong> Choose a file you rarely modify, or create a new canary file.
                    The file's hash will be verified before each backup.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Auto-break Stale Locks Option */}
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
            <div className="flex items-start">
              <input
                type="checkbox"
                id="auto_break_lock"
                checked={formData.auto_break_lock}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    auto_break_lock: e.target.checked,
                  });
                }}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
              />
              <label htmlFor="auto_break_lock" className="ml-2 block text-sm text-gray-700">
                <span className="font-medium text-blue-800">Auto-break Stale Locks</span>
                <span className="block text-xs text-gray-600 mt-1">
                  Automatically break repository locks before running this backup. Useful if backups
                  occasionally fail due to stale locks from interrupted previous runs.
                </span>
                <span className="block text-xs text-amber-600 mt-1">
                  <strong>Note:</strong> Only enable this if you're sure no other backup process is running
                  against the same repository, as breaking an active lock could cause data corruption.
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Column - Exclude Patterns */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Exclude Patterns
            </label>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-700 font-medium mb-2">Pattern Formats:</p>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>• <strong>Glob:</strong> <code className="bg-white px-1 py-0.5 rounded">*.log</code>, <code className="bg-white px-1 py-0.5 rounded">*.tmp</code></li>
                <li>• <strong>Paths:</strong> <code className="bg-white px-1 py-0.5 rounded">/tmp/*</code>, <code className="bg-white px-1 py-0.5 rounded">/var/cache</code></li>
                <li>• <strong>Regex:</strong> <code className="bg-white px-1 py-0.5 rounded">re:.*\.pyc$</code></li>
                <li>• <strong>Shell:</strong> <code className="bg-white px-1 py-0.5 rounded">sh:**/*.o</code></li>
                <li>• <strong>Prefix:</strong> <code className="bg-white px-1 py-0.5 rounded">pp:/home/user/temp</code></li>
              </ul>
            </div>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {formData.exclude_patterns.map((pattern: string, index: number) => (
              <div key={index} className="space-y-1">
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => updateExcludePattern(index, e.target.value)}
                    className={`flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${patternErrors[index] ? 'border-red-500' : 'border-gray-300'
                      }`}
                    placeholder="e.g., *.log or /tmp/* or re:.*\.tmp$"
                  />
                  <button
                    onClick={() => removeExcludePattern(index)}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {patternErrors[index] && (
                  <p className="text-xs text-red-600 ml-1">
                    {patternErrors[index]} - Check format above
                  </p>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addExcludePattern}
            className="btn-secondary text-sm flex items-center space-x-1 w-full justify-center"
          >
            <Plus className="w-4 h-4" />
            <span>Add Exclude Pattern</span>
          </button>
        </div>
      </div>

      {/* YAML Editor Hint */}
      <div className="mt-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-xs text-gray-600">
          <strong>💡 Tip:</strong> If you need to edit the configuration file (YAML) directly later,
          you can use the <a href="/config" className="text-blue-600 hover:underline font-medium">YAML Editor</a> from the main menu
          for advanced options not available in this wizard.
        </p>
      </div>
    </div>
  );
};

export default WizardStepAdvanced;
