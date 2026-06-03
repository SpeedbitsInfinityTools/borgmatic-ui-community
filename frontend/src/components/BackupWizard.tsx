import React from 'react';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useBackupWizard } from './wizard/useBackupWizard';
import WizardStepSources from './wizard/WizardStepSources';
import WizardStepRepositories from './wizard/WizardStepRepositories';
import WizardStepScripts from './wizard/WizardStepScripts';
import WizardStepAdvanced from './wizard/WizardStepAdvanced';
import WizardModals from './wizard/WizardModals';
import QuickAddScheduleModal from './wizard/QuickAddScheduleModal';

type WizardMode = 'production' | 'template' | 'from-template';

interface BackupWizardProps {
  onClose: () => void;
  onSuccess: () => void;
  editBackup?: any;
  mode?: WizardMode;
  templateData?: any;
}

const BackupWizard: React.FC<BackupWizardProps> = ({
  onClose,
  onSuccess,
  editBackup,
  mode = 'production',
  templateData
}) => {
  const w = useBackupWizard({ onClose, onSuccess, editBackup, mode, templateData });
  const [showQuickSchedule, setShowQuickSchedule] = React.useState(false);

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-5xl bg-white rounded-lg shadow-xl flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4 px-6 pt-5 flex-shrink-0">
          <h3 className="text-2xl font-bold text-gray-900">
            {editBackup ? 'Edit' : 'Create'} {mode === 'template' ? 'Template' : 'Backup'} Configuration
          </h3>
          <button onClick={w.handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="mt-6 px-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            {w.steps.map((step, index) => (
              <React.Fragment key={step.number}>
                <div className="flex flex-col items-center flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (w.formData.name.trim() || step.number === 1) {
                        w.setCurrentStep(step.number);
                      } else {
                        toast.error('Please enter a backup name first');
                      }
                    }}
                    className={`flex items-center justify-center w-12 h-12 rounded-full border-2 transition-colors cursor-pointer hover:scale-110 ${step.number === w.currentStep
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : step.number < w.currentStep
                        ? 'border-green-600 bg-green-600 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:border-blue-400'
                      } ${!w.formData.name.trim() && step.number !== 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={!w.formData.name.trim() && step.number !== 1 ? 'Please enter a name first' : `Go to ${step.name}`}
                  >
                    {step.number < w.currentStep ? (
                      <Check className="w-6 h-6" />
                    ) : (
                      <step.icon className="w-6 h-6" />
                    )}
                  </button>
                  <span className="mt-2 text-xs font-medium text-gray-700">{step.name}</span>
                </div>
                {index < w.steps.length - 1 && (
                  <div className={`h-1 flex-1 mx-2 ${step.number < w.currentStep ? 'bg-green-600' : 'bg-gray-300'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {/* Step 1: Basic Settings */}
          {w.currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Backup Name *</label>
                <input
                  type="text"
                  value={w.formData.name}
                  onChange={(e) => w.setFormData({ ...w.formData, name: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${w.errors.name ? 'border-red-500' : 'border-gray-300'}`}
                  placeholder="e.g., webapp-daily-backup"
                />
                {w.errors.name && <p className="mt-1 text-sm text-red-600">{w.errors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={w.formData.description}
                  onChange={(e) => w.setFormData({ ...w.formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Optional description for this backup configuration"
                />
              </div>

              {mode === 'template' && w.operatingMode === 'director' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Schedule (Cron Expression) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={w.formData.cron_expression}
                    onChange={(e) => w.setFormData({ ...w.formData, cron_expression: e.target.value })}
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${w.errors.cron_expression ? 'border-red-500' : 'border-gray-300'}`}
                    placeholder="0 2 * * *"
                  />
                  {w.errors.cron_expression && <p className="mt-1 text-sm text-red-600">{w.errors.cron_expression}</p>}
                  <p className="mt-2 text-xs text-gray-500">Format: minute hour day month weekday</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-gray-700">Examples:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Every hour', value: '0 * * * *' },
                        { label: 'Daily at 2 AM', value: '0 2 * * *' },
                        { label: 'Daily at midnight', value: '0 0 * * *' },
                        { label: 'Every 6 hours', value: '0 */6 * * *' },
                        { label: 'Weekly (Sunday)', value: '0 3 * * 0' },
                        { label: 'Monthly (1st)', value: '0 2 1 * *' },
                      ].map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => w.setFormData({ ...w.formData, cron_expression: preset.value })}
                          className={`px-2 py-1.5 text-xs rounded border transition-colors text-left ${w.formData.cron_expression === preset.value
                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">{preset.label}</div>
                          <div className="font-mono text-xs text-gray-500">{preset.value}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Schedule (Optional)</label>
                  <div className="flex gap-2">
                    <select
                      value={w.formData.schedule_id || ''}
                      onChange={(e) => w.setFormData({ ...w.formData, schedule_id: e.target.value || null })}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">No schedule (manual only)</option>
                      {w.schedules.map((schedule: any) => (
                        <option key={schedule.id} value={schedule.id}>
                          {schedule.name} - {schedule.cron_expression}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowQuickSchedule(true)}
                      className="flex items-center gap-1 px-3 py-2 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex-shrink-0"
                      title="Create a new schedule without leaving this wizard"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Schedule</span>
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">⚠️ Backups without a schedule will be created as inactive</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Sources */}
          {w.currentStep === 2 && (
            <WizardStepSources
              formData={w.formData} setFormData={w.setFormData} errors={w.errors}
              mode={mode} operatingMode={w.operatingMode}
              addSource={w.addSource} removeSource={w.removeSource}
              updateSource={w.updateSource} trimSourceField={w.trimSourceField}
              getDefaultPort={w.getDefaultPort} getMssqlAuthHint={w.getMssqlAuthHint}
              browseDatabases={w.browseDatabases} testDatabaseConnection={w.testDatabaseConnection}
              testingDbConnectionIndex={w.testingDbConnectionIndex}
              dbConnectionTestErrors={w.dbConnectionTestErrors}
              dismissDbConnectionTestError={w.dismissDbConnectionTestError}
              openDiscoveryOptions={w.openDiscoveryOptions} isDiscovering={w.isDiscovering}
              checkMssqlTools={w.checkMssqlTools} checkAwsTools={w.checkAwsTools}
              mssqlToolCheck={w.mssqlToolCheck} awsToolCheck={w.awsToolCheck}
              dbHelpExpanded={w.dbHelpExpanded} setDbHelpExpanded={w.setDbHelpExpanded}
              gitHelpExpanded={w.gitHelpExpanded} setGitHelpExpanded={w.setGitHelpExpanded}
              showGitPat={w.showGitPat} setShowGitPat={w.setShowGitPat}
              gitDiscoveredReposBySource={w.gitDiscoveredReposBySource} setGitDiscoveredReposBySource={w.setGitDiscoveredReposBySource}
              gitSelectedReposBySource={w.gitSelectedReposBySource} setGitSelectedReposBySource={w.setGitSelectedReposBySource}
              isDiscoveringGitReposBySource={w.isDiscoveringGitReposBySource} setIsDiscoveringGitReposBySource={w.setIsDiscoveringGitReposBySource}
              showGitRepoResultsBySource={w.showGitRepoResultsBySource} setShowGitRepoResultsBySource={w.setShowGitRepoResultsBySource}
              gitTestResultBySource={w.gitTestResultBySource} setGitTestResultBySource={w.setGitTestResultBySource}
              isTestingGitConnectionBySource={w.isTestingGitConnectionBySource} setIsTestingGitConnectionBySource={w.setIsTestingGitConnectionBySource}
              commercialFeatures={w.commercialFeatures}
            />
          )}

          {/* Step 3: Repositories */}
          {w.currentStep === 3 && (
            <WizardStepRepositories
              formData={w.formData} setFormData={w.setFormData} errors={w.errors} mode={mode}
              availableRepositories={w.availableRepositories} isLoadingRepos={w.isLoadingRepos}
              availableSSHKeys={w.availableSSHKeys} toggleRepository={w.toggleRepository}
            />
          )}

          {/* Step 4: Retention */}
          {w.currentStep === 4 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">Retention Policy</h4>
                  <p className="text-sm text-gray-500">Choose how long to keep backup archives</p>
                </div>
                <button
                  onClick={() => {
                    w.setCustomRetention({ name: '', description: '', keep_hourly: 0, keep_daily: 7, keep_weekly: 4, keep_monthly: 6, keep_yearly: 1 });
                    w.setShowRetentionModal(true);
                  }}
                  className="btn-secondary text-sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Custom
                </button>
              </div>

              {w.errors.retention && (
                <div className="flex items-center text-red-600 bg-red-50 p-3 rounded">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {w.errors.retention}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {w.retentionProfiles.map((profile: any) => {
                  const isSelected = w.formData.retention_profile_id === profile.id;
                  return (
                    <div
                      key={profile.id}
                      onClick={() => w.setFormData({ ...w.formData, retention_profile_id: profile.id })}
                      className={`border-2 rounded-lg p-6 cursor-pointer transition-all ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="text-3xl">{profile.icon || '📊'}</div>
                        {isSelected && <Check className="w-5 h-5 text-blue-600" />}
                      </div>
                      <h5 className="font-bold text-gray-900 mb-1">{profile.name}</h5>
                      <p className="text-sm text-gray-600 mb-3">{profile.description}</p>
                      <div className="space-y-1 text-xs text-gray-600">
                        {profile.keep_hourly && <p>⏱ Hourly: {profile.keep_hourly}</p>}
                        {profile.keep_daily && <p>📅 Daily: {profile.keep_daily}</p>}
                        {profile.keep_weekly && <p>📆 Weekly: {profile.keep_weekly}</p>}
                        {profile.keep_monthly && <p>📊 Monthly: {profile.keep_monthly}</p>}
                        {profile.keep_yearly && <p>📈 Yearly: {profile.keep_yearly}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: Scripts (Hooks) */}
          {w.currentStep === 5 && (
            <WizardStepScripts
              formData={w.formData} setFormData={w.setFormData}
              customHookInput={w.customHookInput} setCustomHookInput={w.setCustomHookInput}
              availableScripts={w.availableScripts}
              syncConfig={w.syncConfig} setSyncConfig={w.setSyncConfig}
              rcloneRemotes={w.rcloneRemotes} loadingRcloneRemotes={w.loadingRcloneRemotes}
              loadRcloneRemotes={w.loadRcloneRemotes} generateSyncCommand={w.generateSyncCommand}
            />
          )}

          {/* Step 6: Advanced */}
          {w.currentStep === 6 && (
            <WizardStepAdvanced
              formData={w.formData} setFormData={w.setFormData}
              hasLocalFolderSources={w.hasLocalFolderSources} patternErrors={w.patternErrors}
              addExcludePattern={w.addExcludePattern} removeExcludePattern={w.removeExcludePattern}
              updateExcludePattern={w.updateExcludePattern}
              createCanaryFile={w.createCanaryFile} canaryFileCreating={w.canaryFileCreating}
            />
          )}
        </div>

        {/* Validation Result */}
        {w.validationResult.status && (
          <div className="mt-4">
            {w.validationResult.status === 'validating' && (
              <div className="flex items-center p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                <div>
                  <h4 className="text-sm font-medium text-blue-800">Validating Configuration...</h4>
                  <p className="text-xs text-blue-600 mt-1">Running borgmatic validation checks</p>
                </div>
              </div>
            )}
            {w.validationResult.status === 'valid' && (
              <div className="flex items-start p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-green-800">✅ Configuration Valid</h4>
                  <p className="text-xs text-green-600 mt-1">Backup configuration passed all borgmatic validation checks</p>
                </div>
              </div>
            )}
            {w.validationResult.status === 'invalid' && (
              <div className="flex items-start p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="ml-3 flex-1">
                  <h4 className="text-sm font-medium text-red-800">❌ Validation Failed</h4>
                  <p className="text-xs text-red-700 mt-1 font-mono whitespace-pre-wrap">{w.validationResult.error}</p>
                  <p className="text-xs text-red-600 mt-2">The backup was saved but marked as inactive. Please fix the errors and try again.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 pb-5 px-6 flex-shrink-0 bg-gray-50">
          <button
            onClick={w.handlePrevious}
            disabled={w.currentStep === 1 || w.isSubmitting}
            className="btn-secondary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          <div className="flex items-center space-x-3">
            {w.validationResult.status === 'invalid' && (
              <button onClick={onClose} className="btn-secondary">Close & Review</button>
            )}

            {editBackup && (
              <button
                onClick={w.handleSubmit}
                disabled={w.isSubmitting || !w.formData.name.trim()}
                className="btn-primary flex items-center space-x-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!w.formData.name.trim() ? 'Please enter a backup name first' : ''}
              >
                {w.isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{w.validationResult.status === 'validating' ? 'Validating...' : 'Saving...'}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            )}

            {w.currentStep < w.steps.length ? (
              <button
                onClick={w.handleNext}
                disabled={w.isSubmitting || (w.currentStep === 1 && !w.formData.name.trim())}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={w.currentStep === 1 && !w.formData.name.trim() ? 'Please enter a backup name first' : ''}
              >
                <span>Next</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : !editBackup && (
              <button
                onClick={w.handleSubmit}
                disabled={w.isSubmitting || !w.formData.name.trim()}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!w.formData.name.trim() ? 'Please enter a backup name first (Step 1)' : ''}
              >
                {w.isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{w.validationResult.status === 'validating' ? 'Validating...' : 'Creating...'}</span>
                  </>
                ) : w.validationResult.status === 'invalid' ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Retry</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{mode === 'template' ? 'Create Template' : 'Create Backup'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <WizardModals
        showCloseConfirm={w.showCloseConfirm} setShowCloseConfirm={w.setShowCloseConfirm}
        onClose={onClose} saveAsDraftAndClose={w.saveAsDraftAndClose} isSavingDraft={w.isSavingDraft}
        showDiscoveryOptions={w.showDiscoveryOptions} setShowDiscoveryOptions={w.setShowDiscoveryOptions}
        discoveryOptions={w.discoveryOptions} setDiscoveryOptions={w.setDiscoveryOptions}
        availableNetworks={w.availableNetworks} isLoadingNetworks={w.isLoadingNetworks}
        handleAutoDiscover={w.handleAutoDiscover}
        retryDiscoveryAllNetworks={w.retryDiscoveryAllNetworks}
        discoveryDiagnostic={w.discoveryDiagnostic}
        showDiscoveryResults={w.showDiscoveryResults} setShowDiscoveryResults={w.setShowDiscoveryResults}
        discoveredDatabases={w.discoveredDatabases} selectedDatabases={w.selectedDatabases}
        toggleDatabaseSelection={w.toggleDatabaseSelection}
        selectAllDatabases={w.selectAllDatabases} deselectAllDatabases={w.deselectAllDatabases}
        addSelectedDatabases={w.addSelectedDatabases}
        dbBrowserState={w.dbBrowserState} setDbBrowserState={w.setDbBrowserState}
        selectDatabaseFromBrowser={w.selectDatabaseFromBrowser}
        showRetentionModal={w.showRetentionModal} setShowRetentionModal={w.setShowRetentionModal}
        customRetention={w.customRetention} setCustomRetention={w.setCustomRetention}
        createRetentionMutation={w.createRetentionMutation}
      />

      <QuickAddScheduleModal
        isOpen={showQuickSchedule}
        onClose={() => setShowQuickSchedule(false)}
        onCreated={(id) => w.setFormData({ ...w.formData, schedule_id: id })}
      />
    </div>
  );
};

export default BackupWizard;
