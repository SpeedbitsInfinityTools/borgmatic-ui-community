import React from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Cloud,
  Code,
  Play,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import PathSelectorField from '../PathSelectorField';

export interface WizardStepScriptsProps {
  formData: any;
  setFormData: (fd: any) => void;

  customHookInput: { before_backup: string; after_backup: string; on_error: string };
  setCustomHookInput: React.Dispatch<React.SetStateAction<{ before_backup: string; after_backup: string; on_error: string }>>;

  availableScripts: any[];

  syncConfig: {
    enabled: boolean;
    type: 'local' | 'rclone';
    localPath: string;
    rcloneRemote: string;
    rclonePath: string;
  };
  setSyncConfig: React.Dispatch<React.SetStateAction<{
    enabled: boolean;
    type: 'local' | 'rclone';
    localPath: string;
    rcloneRemote: string;
    rclonePath: string;
  }>>;
  rcloneRemotes: Array<{ name: string; type: string }>;
  loadingRcloneRemotes: boolean;
  loadRcloneRemotes: () => void;
  generateSyncCommand: () => string;
}

const WizardStepScripts: React.FC<WizardStepScriptsProps> = ({
  formData, setFormData,
  customHookInput, setCustomHookInput,
  availableScripts,
  syncConfig, setSyncConfig,
  rcloneRemotes, loadingRcloneRemotes, loadRcloneRemotes, generateSyncCommand,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-2">
          Backup Scripts (Optional)
        </h4>
        <p className="text-sm text-gray-500">
          Run custom scripts before or after your backup. This is optional - skip if you don't need custom automation.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">What are backup scripts?</p>
            <p className="text-blue-700">
              Scripts let you automate tasks around your backups. Common uses include:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-blue-700">
              <li><strong>Before backup:</strong> Stop services, dump databases, create snapshots</li>
              <li><strong>After backup:</strong> Restart services, send notifications, cleanup temp files</li>
              <li><strong>On error:</strong> Alert administrators, rollback changes</li>
            </ul>
            <p className="mt-2 text-blue-600">
              💡 Manage your script library in the <a href="/scripts" className="underline font-medium">Scripts page</a>
            </p>
          </div>
        </div>
      </div>

      {/* Before Backup Scripts */}
      <HookSection
        title="Before Backup"
        subtitle="Runs before the backup starts"
        icon={<Play className="w-5 h-5 text-blue-600" />}
        hookType="before_backup"
        hooks={formData.hooks.before_backup}
        formData={formData}
        setFormData={setFormData}
        customHookInput={customHookInput}
        setCustomHookInput={setCustomHookInput}
        availableScripts={availableScripts}
      />

      {/* After Backup Scripts */}
      <HookSection
        title="After Backup"
        subtitle="Runs after successful backup"
        icon={<CheckCircle className="w-5 h-5 text-green-600" />}
        hookType="after_backup"
        hooks={formData.hooks.after_backup}
        formData={formData}
        setFormData={setFormData}
        customHookInput={customHookInput}
        setCustomHookInput={setCustomHookInput}
        availableScripts={availableScripts}
      />

      {/* Sync Repository to Cloud */}
      <div className="bg-white border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-600" />
            <h5 className="font-medium text-gray-900">Sync Repository to Cloud</h5>
            <span className="text-xs text-gray-500">Sync after each backup (Borg 1.x alternative)</span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={syncConfig.enabled}
              onChange={(e) => setSyncConfig({ ...syncConfig, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {syncConfig.enabled && (
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              <strong>💡 Note:</strong> This uses <code>rclone sync</code> to copy your repository to a cloud destination after each backup.
              Ideal for Borg 1.x users who want cloud redundancy. For native cloud storage, use Borg 2.x repositories.
            </div>

            {/* Destination Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sync Destination</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSyncConfig({ ...syncConfig, type: 'local' })}
                  className={`flex-1 px-3 py-2 text-sm border rounded-lg ${
                    syncConfig.type === 'local'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <FolderOpen className="w-4 h-4 inline mr-1" />
                  Local/Mounted Path
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSyncConfig({ ...syncConfig, type: 'rclone' });
                    if (rcloneRemotes.length === 0) {
                      loadRcloneRemotes();
                    }
                  }}
                  className={`flex-1 px-3 py-2 text-sm border rounded-lg ${
                    syncConfig.type === 'rclone'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Cloud className="w-4 h-4 inline mr-1" />
                  Rclone Remote
                </button>
              </div>
            </div>

            {/* Local Path */}
            {syncConfig.type === 'local' && (
              <PathSelectorField
                label="Destination Path"
                value={syncConfig.localPath}
                onChange={(path) => setSyncConfig({ ...syncConfig, localPath: path })}
                placeholder="/mnt/cloud-backup or /path/to/mounted/rclone"
                helperText="Enter a local path or mounted rclone remote (e.g., using Rclone Director UI)"
                selectMode="directories"
                required
                error={!syncConfig.localPath.trim() ? 'Destination path is required' : undefined}
              />
            )}

            {/* Rclone Remote */}
            {syncConfig.type === 'rclone' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rclone Remote <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    {rcloneRemotes.length > 0 ? (
                      <select
                        value={syncConfig.rcloneRemote}
                        onChange={(e) => setSyncConfig({ ...syncConfig, rcloneRemote: e.target.value })}
                        className={`flex-1 px-3 py-2 border rounded-lg text-sm ${
                          !syncConfig.rcloneRemote.trim() ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                      >
                        <option value="">Select a remote...</option>
                        {rcloneRemotes.map((remote) => (
                          <option key={remote.name} value={remote.name}>
                            {remote.name} ({remote.type})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={syncConfig.rcloneRemote}
                        onChange={(e) => setSyncConfig({ ...syncConfig, rcloneRemote: e.target.value })}
                        placeholder="remote-name"
                        className={`flex-1 px-3 py-2 border rounded-lg text-sm ${
                          !syncConfig.rcloneRemote.trim() ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={loadRcloneRemotes}
                      disabled={loadingRcloneRemotes}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingRcloneRemotes ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  {!syncConfig.rcloneRemote.trim() && (
                    <p className="mt-1 text-xs text-red-500">
                      ⚠️ Rclone remote is required
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    💡 Configure rclone remotes with{' '}
                    <a href="https://speedbits.io/infinity-tools" target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800">
                      Rclone Director UI
                    </a>{' '}
                    or <code>rclone config</code>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Remote Path
                  </label>
                  <input
                    type="text"
                    value={syncConfig.rclonePath}
                    onChange={(e) => setSyncConfig({ ...syncConfig, rclonePath: e.target.value })}
                    placeholder="backups/borg (optional)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </>
            )}

            {/* Preview of generated command */}
            {((syncConfig.type === 'local' && syncConfig.localPath) ||
              (syncConfig.type === 'rclone' && syncConfig.rcloneRemote)) && (
              <div className="p-2 bg-gray-50 border border-gray-200 rounded">
                <div className="text-xs font-medium text-gray-500 mb-1">Generated after_backup hook:</div>
                <code className="text-xs text-gray-700 break-all">{generateSyncCommand()}</code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* On Error Scripts */}
      <HookSection
        title="On Error"
        subtitle="Runs if backup fails"
        icon={<AlertCircle className="w-5 h-5 text-red-600" />}
        hookType="on_error"
        hooks={formData.hooks.on_error}
        formData={formData}
        setFormData={setFormData}
        customHookInput={customHookInput}
        setCustomHookInput={setCustomHookInput}
        availableScripts={availableScripts}
      />

      {/* Skip info */}
      {formData.hooks.before_backup.length === 0 &&
        formData.hooks.after_backup.length === 0 &&
        formData.hooks.on_error.length === 0 && (
          <div className="text-center py-4 text-gray-500 text-sm">
            No scripts configured. You can skip this step if you don't need custom automation.
          </div>
        )}
    </div>
  );
};

interface HookSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  hookType: 'before_backup' | 'after_backup' | 'on_error';
  hooks: string[];
  formData: any;
  setFormData: (fd: any) => void;
  customHookInput: { before_backup: string; after_backup: string; on_error: string };
  setCustomHookInput: React.Dispatch<React.SetStateAction<{ before_backup: string; after_backup: string; on_error: string }>>;
  availableScripts: any[];
}

const HookSection: React.FC<HookSectionProps> = ({
  title, subtitle, icon, hookType, hooks,
  formData, setFormData, customHookInput, setCustomHookInput, availableScripts,
}) => {
  const removeHook = (index: number) => {
    const newHooks = [...hooks];
    newHooks.splice(index, 1);
    setFormData({ ...formData, hooks: { ...formData.hooks, [hookType]: newHooks } });
  };

  const addFromLibrary = (scriptId: string) => {
    const script = availableScripts.find((s: any) => s.id === scriptId);
    if (script) {
      setFormData({
        ...formData,
        hooks: { ...formData.hooks, [hookType]: [...hooks, script.script] },
      });
    }
  };

  const addCustom = () => {
    const val = customHookInput[hookType].trim();
    if (val) {
      setFormData({
        ...formData,
        hooks: { ...formData.hooks, [hookType]: [...hooks, val] },
      });
      setCustomHookInput({ ...customHookInput, [hookType]: '' });
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h5 className="font-medium text-gray-900">{title}</h5>
        <span className="text-xs text-gray-500">{subtitle}</span>
      </div>

      {hooks.length > 0 && (
        <div className="space-y-2 mb-3">
          {hooks.map((hook: string, index: number) => (
            <div key={index} className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
              <Code className="w-4 h-4 text-gray-400" />
              <code className="flex-1 text-sm text-gray-700 truncate">{hook}</code>
              <button type="button" onClick={() => removeHook(index)} className="text-red-500 hover:text-red-700">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value=""
          onChange={(e) => { if (e.target.value) addFromLibrary(e.target.value); }}
        >
          <option value="">Select from library...</option>
          {availableScripts
            .filter((s: any) => s.hook_type === hookType)
            .map((script: any) => (
              <option key={script.id} value={script.id}>{script.name}</option>
            ))
          }
        </select>
        <span className="text-gray-400 self-center">or</span>
        <input
          type="text"
          value={customHookInput[hookType]}
          onChange={(e) => setCustomHookInput({ ...customHookInput, [hookType]: e.target.value })}
          placeholder="Custom command..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customHookInput[hookType].trim()}
          className="btn-secondary text-sm"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default WizardStepScripts;
