import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { Save, Download, Upload, CheckCircle, AlertCircle, RotateCcw, AlertTriangle, FileText } from 'lucide-react'
import { yamlEditorAPI } from '../services/api'
import { toast } from 'react-hot-toast'

const Config: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [configContent, setConfigContent] = useState('')
  const [originalContent, setOriginalContent] = useState('') // Track original content for revert
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [validationMessage, setValidationMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [validationWarnings, setValidationWarnings] = useState<string[]>([])
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const queryClient = useQueryClient()

  // Load list of available YAML files
  const { data: filesData, isLoading: loadingFiles } = useQuery({
    queryKey: ['yaml-files'],
    queryFn: yamlEditorAPI.getFiles,
    onSuccess: (data: any) => {
      const files = data?.data?.data?.files || []
      // Auto-select first file if none selected
      if (files.length > 0 && !selectedFile) {
        setSelectedFile(files[0].filename)
      }
    }
  })

  const files = filesData?.data?.data?.files || []

  // Load content of selected file
  const { isLoading: loadingConfig } = useQuery({
    queryKey: ['yaml-file-content', selectedFile],
    queryFn: () => yamlEditorAPI.getFile(selectedFile!),
    enabled: !!selectedFile,
    onSuccess: (data: any) => {
      const content = data?.data?.data?.content || ''
      setConfigContent(content)
      setOriginalContent(content)
      // Reset validation when switching files
      setIsValid(null)
      setValidationErrors([])
      setValidationWarnings([])
    }
  })

  // Save configuration mutation
  const saveMutation = useMutation({
    mutationFn: () => yamlEditorAPI.saveFile(selectedFile!, configContent),
    onSuccess: () => {
      toast.success('Configuration saved successfully!')
      setShowSaveConfirm(false)
      setOriginalContent(configContent)
      queryClient.invalidateQueries({ queryKey: ['yaml-file-content', selectedFile] })
      queryClient.invalidateQueries({ queryKey: ['yaml-files'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] }) // Refresh backups list
    },
    onError: (error: any) => {
      toast.error(`Failed to save configuration: ${error.response?.data?.error || error.message}`)
      setShowSaveConfirm(false)
    }
  })

  // Validate configuration mutation
  const validateMutation = useMutation({
    mutationFn: () => yamlEditorAPI.validateContent(configContent, selectedFile || undefined),
    onSuccess: ({ data }: any) => {
      if (data.data?.valid) {
        setIsValid(true)
        setValidationMessage('Configuration is valid!')
        setValidationErrors([])
        setValidationWarnings(data.data?.warnings || [])
        toast.success('Configuration is valid!')
      } else {
        setIsValid(false)
        setValidationMessage('Configuration validation failed')

        // Handle different error formats
        let errors = []
        if (data.data?.errors && Array.isArray(data.data.errors)) {
          errors = data.data.errors.filter((error: string) => error && error.trim() !== '')
        } else if (data.error) {
          errors = [data.error]
        } else {
          errors = ['Configuration validation failed']
        }

        setValidationErrors(errors)
        setValidationWarnings(data.data?.warnings || [])
        toast.error('Configuration validation failed')
      }
    },
    onError: (error: any) => {
      setIsValid(false)
      setValidationMessage('Configuration validation failed')

      // Handle different error formats
      let errors = []
      if (error.response?.data?.error) {
        errors = [error.response.data.error]
      } else if (error.response?.data?.data?.errors && Array.isArray(error.response.data.data.errors)) {
        errors = error.response.data.data.errors.filter((error: string) => error && error.trim() !== '')
      } else {
        errors = ['Configuration validation failed']
      }

      setValidationErrors(errors)
      setValidationWarnings([])
      toast.error('Configuration validation failed')
    }
  })

  // Handle configuration validation
  const handleValidate = () => {
    if (!configContent.trim()) {
      toast.error('Please enter configuration content first')
      return
    }
    validateMutation.mutate(configContent)
  }

  // Handle configuration save
  const handleSave = () => {
    if (!configContent.trim()) {
      toast.error('Please enter configuration content first')
      return
    }
    setShowSaveConfirm(true)
  }

  const handleConfirmSave = () => {
    saveMutation.mutate()
  }

  // Get backups for selected file
  const { data: backupsData, isLoading: loadingBackups } = useQuery({
    queryKey: ['file-backups', selectedFile],
    queryFn: () => yamlEditorAPI.getFileBackups(selectedFile!),
    enabled: !!selectedFile,
  })

  const fileBackups = backupsData?.data?.data?.backups || []
  const hasBackups = fileBackups.length > 0
  const hasUnsavedChanges = configContent !== originalContent

  // Revert to last saved version (undo current changes)
  const handleRevertChanges = () => {
    if (!hasUnsavedChanges) {
      toast.info('No changes to revert')
      return
    }
    
    if (window.confirm('Discard all unsaved changes and revert to the last saved version?')) {
      setConfigContent(originalContent)
      setIsValid(null)
      setValidationErrors([])
      setValidationWarnings([])
      toast.success('Changes reverted')
    }
  }

  // Revert to a previous backup version
  const handleRevertToPrevious = async () => {
    if (!selectedFile) {
      toast.error('No file selected')
      return
    }

    if (!hasBackups) {
      toast.error('No backup versions available for this file. Backups are created automatically when you save changes.')
      return
    }

    // Get the most recent backup
    const latestBackup = fileBackups[0]
    if (window.confirm(`Do you want to restore "${selectedFile}" to the backup from ${new Date(latestBackup.timestamp).toLocaleString()}?\n\nThis will replace the current content. You can review and save to apply.`)) {
      try {
        const response = await yamlEditorAPI.restoreFromBackup(selectedFile, latestBackup.filename)
        const restoredContent = response.data?.data?.content || ''
        setConfigContent(restoredContent)
        toast.success('Backup version restored! Review and save to apply.')
        setIsValid(null)
      } catch (error: any) {
        toast.error(`Failed to restore: ${error.response?.data?.error || error.message}`)
      }
    }
  }

  // Handle file download
  const handleDownload = () => {
    if (!selectedFile) {
      toast.error('No file selected')
      return
    }

    const blob = new Blob([configContent], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile // Use the actual filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`${selectedFile} downloaded!`)
  }

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setConfigContent(content)
      toast.success('Configuration file loaded!')
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">YAML Editor</h1>
        <p className="text-gray-600 mt-1">Manage your Borgmatic configuration files</p>
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex">
            <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="ml-3">
              <p className="text-sm text-yellow-800">
                <strong>Warning:</strong> This is for manually editing your Borgmatic settings. Please be careful as you may easily overwrite what you have. We recommend backing up the settings by <strong>downloading</strong> them before making changes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* File Selector & Action Buttons */}
      <div className="bg-white p-4 rounded-lg shadow space-y-4">
        {/* File Selector */}
        <div className="flex items-center space-x-3 pb-4 border-b border-gray-200">
          <FileText className="h-5 w-5 text-gray-400" />
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Editing:
          </label>
          <select
            value={selectedFile || ''}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={loadingFiles || files.length === 0}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            {files.length === 0 ? (
              <option value="">No backup configurations found</option>
            ) : (
              files.map((file: any) => (
                <option key={file.filename} value={file.filename}>
                  {file.displayName} {file.parseError ? '(Parse Error)' : ''}
                </option>
              ))
            )}
          </select>
          {loadingFiles && (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleValidate}
              disabled={validateMutation.isLoading || !selectedFile}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {validateMutation.isLoading ? (
                'Validating...'
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Validate
                </>
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={saveMutation.isLoading || !selectedFile}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isLoading ? (
                'Saving...'
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Configuration
                </>
              )}
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Revert unsaved changes */}
            <button
              onClick={handleRevertChanges}
              disabled={!selectedFile || !hasUnsavedChanges}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Discard unsaved changes and revert to last saved version"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Revert Changes
            </button>

            {/* Revert to backup version */}
            <button
              onClick={handleRevertToPrevious}
              disabled={!selectedFile || loadingBackups || !hasBackups}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasBackups 
                ? `Restore from backup (${fileBackups.length} backup${fileBackups.length === 1 ? '' : 's'} available)` 
                : 'No backups available yet - backups are created when you save'
              }
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Restore Backup {hasBackups && `(${fileBackups.length})`}
            </button>

            <label className={`inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${!selectedFile ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}>
              <Upload className="h-4 w-4 mr-2" />
              Upload
              <input
                type="file"
                accept=".yaml,.yml"
                onChange={handleFileUpload}
                disabled={!selectedFile}
                className="hidden"
              />
            </label>

            <button
              onClick={handleDownload}
              disabled={!configContent || !selectedFile}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title={`Download ${selectedFile || 'current file'}`}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </button>
          </div>
        </div>
      </div>

      {/* Validation Status */}
      {isValid !== null && (
        <div className={`p-4 rounded-lg ${isValid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}>
          <div className="flex items-center mb-2">
            {isValid ? (
              <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            )}
            <span className={`text-sm font-medium ${isValid ? 'text-green-800' : 'text-red-800'
              }`}>
              {validationMessage}
            </span>
          </div>

          {/* Display Errors */}
          {validationErrors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-medium text-red-800 mb-2">Validation Errors:</h4>
              <div className="bg-red-100 border border-red-300 rounded p-3">
                <ul className="space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index} className="text-sm text-red-800 font-mono">
                      • {error}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Display Warnings */}
          {validationWarnings.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-medium text-yellow-800 mb-2">Validation Warnings:</h4>
              <div className="bg-yellow-100 border border-yellow-300 rounded p-3">
                <ul className="space-y-1">
                  {validationWarnings.map((warning, index) => (
                    <li key={index} className="text-sm text-yellow-800 font-mono">
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Help for fixing errors - Show actual error messages */}
          {!isValid && validationErrors.length > 0 && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
              <h4 className="text-sm font-medium text-blue-800 mb-1">How to fix:</h4>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• Check the error messages above for specific issues</li>
                <li>• Ensure YAML syntax is correct (proper indentation, no typos)</li>
                <li>• Verify that values match expected types (integers, strings, etc.)</li>
                <li>• Remove any unsupported configuration sections</li>
                <li>• Use the templates as a starting point for valid configurations</li>
                <li>• If you see Python traceback errors, check for malformed YAML or invalid configuration structure</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Configuration Editor */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Configuration Editor</h3>
              <p className="text-sm text-gray-600">
                {selectedFile ? `Editing: ${selectedFile}` : 'Select a file to edit'}
              </p>
            </div>
            {backupsData?.data?.data?.backups?.length > 0 && (
              <div className="text-xs text-gray-500">
                {backupsData.data.data.backups.length} backup{backupsData.data.data.backups.length !== 1 ? 's' : ''} available
              </div>
            )}
          </div>
        </div>

        <div className="p-4">
          {loadingConfig ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading configuration...</p>
            </div>
          ) : !selectedFile ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>Please select a backup configuration file to edit</p>
            </div>
          ) : (
            <textarea
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
              placeholder="# Borgmatic Configuration
# Edit your configuration here...

repositories:
  - path: /path/to/repo
    label: my-repo

storage:
  compression: lz4
  encryption: repokey

retention:
  keep_daily: 7
  keep_weekly: 4
  keep_monthly: 6

hooks:
  before_backup:
    - echo 'Starting backup...'
  after_backup:
    - echo 'Backup completed!'"
              className="w-full h-96 p-4 border border-gray-300 rounded-md font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-lg font-medium text-blue-900 mb-2">Configuration Help</h3>
        <div className="text-sm text-blue-800 space-y-2">
          <p><strong>Repositories:</strong> Define the paths to your Borg repositories</p>
          <p><strong>Storage:</strong> Configure compression and encryption settings</p>
          <p><strong>Retention:</strong> Set how long to keep backups</p>
          <p><strong>Hooks:</strong> Add scripts to run before/after backups</p>
          <p><strong>Validation:</strong> Always validate your configuration before saving</p>
        </div>
      </div>

      {/* Save Confirmation Modal */}
      {showSaveConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center mb-4">
                <AlertTriangle className="h-6 w-6 text-yellow-600 mr-3" />
                <h3 className="text-lg font-medium text-gray-900">Confirm Save</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Do you really want to save to production? Please remember to download your old configuration before proceeding.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowSaveConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  No
                </button>
                <button
                  onClick={handleConfirmSave}
                  disabled={saveMutation.isLoading}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {saveMutation.isLoading ? 'Saving...' : 'Yes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Config 