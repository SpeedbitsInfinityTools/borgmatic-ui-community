import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { templatesAPI, repositoriesAPI, logsAPI } from '../services/api'
import { FileText, Plus, Edit2, Trash2, Copy, Send, Clock, Database, Upload, Wrench, Shield, CheckCircle, AlertTriangle, FolderPlus, HardDrive } from 'lucide-react'
import { toast } from 'react-hot-toast'
import BackupWizard from '../components/BackupWizard'
import DeploymentModal from '../components/DeploymentModal'
import PathSelectorField from '../components/PathSelectorField'
import { getSafeDisplayPath } from '../utils/repositoryUtils'
import { useDirector } from '../contexts/DirectorContext'

interface Template {
  id: string
  type: string
  name: string
  description: string
  config: any
  created_at: string
  updated_at: string
  created_by: string
  sources_summary?: any[]
  repositories_summary?: any[]
  schedule_id?: string | null
}

export default function Templates() {
  const queryClient = useQueryClient()
  const { selectedClient } = useDirector()
  // Convert single selected client to array format for deployment
  const selectedClients = selectedClient ? [selectedClient.client_id] : []
  const [showWizard, setShowWizard] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deployingTemplate, setDeployingTemplate] = useState<Template | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [showInfinityToolsDetails, setShowInfinityToolsDetails] = useState(false)
  const [showActivationModal, setShowActivationModal] = useState(false)
  const [repoOption, setRepoOption] = useState<'create' | 'select'>('create')
  const [selectedRepoId, setSelectedRepoId] = useState<string>('')
  const [customRepoPath, setCustomRepoPath] = useState('/host/opt/speedbits-backup/borgmatic-repo')
  const [repoTestResult, setRepoTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message?: string; key?: string }>({ status: 'idle' })
  const [logFilePath, setLogFilePath] = useState('')
  const [borgVersion, setBorgVersion] = useState<'1.x' | '2.x'>('1.x')
  // Passphrase state for template activation
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [passphraseError, setPassphraseError] = useState<string | null>(null)

  // Fetch log settings to get the suggested log path
  const { data: logSettingsData } = useQuery({
    queryKey: ['log-settings'],
    queryFn: () => logsAPI.getSettings(),
    enabled: showActivationModal, // Only fetch when activation modal is open
    onSuccess: (response) => {
      // Set the suggested log path if not already set
      const suggestedPath = response?.data?.data?.suggested_log_path
      if (suggestedPath && !logFilePath) {
        setLogFilePath(suggestedPath)
      }
    }
  })

  // Fetch templates
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesAPI.getTemplates(),
    // No auto-refetch - templates don't change frequently
  })

  const templates = templatesData?.data?.data?.backups || []

  // Fetch Infinity Tools template status
  const { data: infinityToolsData, refetch: refetchInfinityTools } = useQuery({
    queryKey: ['infinity-tools-template'],
    queryFn: () => templatesAPI.getInfinityToolsStatus(),
  })

  const infinityToolsStatus = infinityToolsData?.data?.data
  const isInfinityToolsActivated = infinityToolsStatus?.activated || false
  // Use template from status or find it from templates list as fallback
  const infinityToolsTemplate = infinityToolsStatus?.template || templates.find((t: Template) => t.id === 'infinity-tools')

  // Fetch existing repositories for selection
  const { data: repositoriesData } = useQuery({
    queryKey: ['repositories'],
    queryFn: () => repositoriesAPI.getRepositoriesFast(),
  })
  const existingRepositories = repositoriesData?.data?.data?.repositories || []
  const selectedRepo = useMemo(() => {
    if (!selectedRepoId) return null
    return existingRepositories.find((repo: any) => repo.id === selectedRepoId) || null
  }, [existingRepositories, selectedRepoId])

  const repoTestKey = repoOption === 'create'
    ? `create:${customRepoPath}`
    : `select:${selectedRepoId || ''}`

  const resetRepoTest = () => {
    setRepoTestResult({ status: 'idle' })
  }

  const closeActivationModal = () => {
    setShowActivationModal(false)
    setPassphrase('')
    setConfirmPassphrase('')
    setShowPassphrase(false)
    setPassphraseError(null)
    resetRepoTest()
  }

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesAPI.deleteTemplate(id),
    onSuccess: () => {
      toast.success('Template deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setDeleteConfirm(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete template')
    },
  })

  // Clone mutation
  const cloneMutation = useMutation({
    mutationFn: (template: Template) => {
      const clonedData = {
        ...template,
        name: `${template.name} (Copy)`,
        type: 'backup',
      }
      delete clonedData.id
      delete clonedData.created_at
      delete clonedData.updated_at
      return templatesAPI.createTemplate(clonedData)
    },
    onSuccess: () => {
      toast.success('Template cloned successfully')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to clone template')
    },
  })

  // Import mutation
  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return templatesAPI.importTemplate(formData)
    },
    onSuccess: () => {
      toast.success('Template imported successfully')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setShowImportModal(false)
      setImportFile(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to import template')
    },
  })

  // Infinity Tools activation mutation
  const activateInfinityToolsMutation = useMutation({
    mutationFn: (options: { repoOption: 'create' | 'select', repoPath?: string, repoId?: string, logPath?: string, borgVersion?: string, passphrase?: string }) =>
      templatesAPI.activateInfinityTools({
        passphrase: options.passphrase || 'AUTO_GENERATE',
        repository_option: options.repoOption,
        repository_path: options.repoPath,
        repository_id: options.repoId,
        log_file_path: options.logPath,
        borg_version: options.borgVersion
      }),
    onSuccess: (response) => {
      const passphrase = response.data?.data?.passphrase
      const warnings = response.data?.warnings || []
      const partialSuccess = response.data?.partial_success
      
      if (partialSuccess && warnings.length > 0) {
        toast.success('Infinity Tools backup partially activated!', { duration: 6000 })
        warnings.forEach((warning: string) => {
          toast.error(`⚠️ ${warning}`, { duration: 8000 })
        })
      } else {
        toast.success('Infinity Tools backup activated! Repository passphrase saved.')
      }
      
      refetchInfinityTools()
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
      setShowInfinityToolsDetails(false)
      closeActivationModal()

      // Show passphrase info (but don't log the actual passphrase!)
      if (passphrase) {
        toast.success(`Passphrase saved to: ${response.data?.data?.passphrase_file}`, { duration: 8000 })
      }
    },
    onError: (error: any) => {
      const errorData = error.response?.data
      const errorCode = errorData?.error_code
      const detail = errorData?.detail || 'Failed to activate Infinity Tools template'

      // Show more helpful message based on error code
      if (errorCode === 'REPO_EXISTS') {
        toast.error(detail, { duration: 6000 })
      } else if (errorCode === 'PERMISSION_DENIED') {
        toast.error(detail, { duration: 6000 })
      } else if (errorCode === 'ALREADY_ACTIVATED') {
        toast.error('Template is already activated. Refresh the page to see current status.')
      } else {
        toast.error(detail)
      }
    },
  })

  // Normalize log file path - ensure it ends with .log
  const normalizeLogPath = (path: string): string => {
    if (!path || path.trim() === '') return '';
    const trimmed = path.trim();
    // If path already ends with .log, use as-is
    if (trimmed.toLowerCase().endsWith('.log')) {
      return trimmed;
    }
    // Otherwise, append /borgmatic.log (assuming it's a directory)
    return trimmed.endsWith('/') ? `${trimmed}borgmatic.log` : `${trimmed}/borgmatic.log`;
  };

  const handleActivate = () => {
    if (!isRepoTestValid) {
      toast.error('Please click "Test Connection" before activating the template.')
      return
    }
    
    // Validate passphrase only when creating new repository
    if (repoOption === 'create') {
      if (!passphrase || passphrase.length < 5) {
        setPassphraseError('Passphrase must be at least 5 characters')
        toast.error('Passphrase must be at least 5 characters')
        return
      }
      if (passphrase !== confirmPassphrase) {
        setPassphraseError('Passphrases do not match')
        toast.error('Passphrases do not match')
        return
      }
      setPassphraseError(null)
    }
    
    const normalizedLogPath = normalizeLogPath(logFilePath);
    
    activateInfinityToolsMutation.mutate({
      repoOption,
      repoPath: repoOption === 'create' ? customRepoPath : undefined,
      repoId: repoOption === 'select' ? selectedRepoId : undefined,
      logPath: normalizedLogPath,
      borgVersion: repoOption === 'create' ? borgVersion : undefined,
      passphrase: repoOption === 'create' ? passphrase : undefined
    })
  }

  const testTemplateRepoConnection = async () => {
    if (repoOption === 'create') {
      if (!customRepoPath || customRepoPath.trim().length === 0) {
        toast.error('Please enter a repository path first')
        return
      }
      setRepoTestResult({ status: 'testing', message: 'Testing local path...', key: repoTestKey })
      try {
        const response = await fetch('/api/repositories/test-connection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
          },
          body: JSON.stringify({
            repository_type: 'local',
            path: customRepoPath
          })
        })
        const result = await response.json()
        if (result.success) {
          if (result.data?.requires_creation) {
            setRepoTestResult({
              status: 'error',
              message: 'Path does not exist. Create it first or choose an existing directory.',
              key: repoTestKey
            })
            return
          }
          setRepoTestResult({
            status: 'success',
            message: result.data?.message || 'Path exists and is writable',
            key: repoTestKey
          })
        } else {
          setRepoTestResult({
            status: 'error',
            message: result.detail || 'Connection test failed',
            key: repoTestKey
          })
        }
      } catch (error: any) {
        setRepoTestResult({
          status: 'error',
          message: error.message || 'Failed to test connection',
          key: repoTestKey
        })
      }
      return
    }

    if (!selectedRepo) {
      toast.error('Please select a repository first')
      return
    }

    const repoType = selectedRepo.repository_type || selectedRepo.type || 'local'
    const payload: any = { repository_type: repoType }

    if (repoType === 'local') {
      payload.path = selectedRepo.path
    } else if (repoType === 'ssh' || repoType === 'sftp' || repoType === 'hetzner') {
      payload.host = selectedRepo.host
      payload.port = selectedRepo.port || (repoType === 'hetzner' ? 23 : 22)
      payload.username = selectedRepo.username
      payload.ssh_key_id = selectedRepo.ssh_key_id
      payload.ssh_auth_method = selectedRepo.ssh_auth_method
    } else if (repoType === 'rclone') {
      payload.rclone_remote = selectedRepo.rclone_remote
      payload.rclone_path = selectedRepo.rclone_path
    } else if (repoType === 's3') {
      payload.s3_endpoint = selectedRepo.s3_endpoint
      payload.s3_bucket = selectedRepo.s3_bucket
      payload.s3_region = selectedRepo.s3_region
      payload.s3_access_key = selectedRepo.s3_access_key
      payload.s3_secret_key = selectedRepo.s3_secret_key
    }

    if (repoType === 's3' && (!payload.s3_access_key || !payload.s3_secret_key)) {
      setRepoTestResult({
        status: 'error',
        message: 'S3 credentials are not available here. Test the connection in Repositories and try again.',
        key: repoTestKey
      })
      return
    }

    setRepoTestResult({ status: 'testing', message: `Testing ${repoType} connection...`, key: repoTestKey })
    try {
      const response = await fetch('/api/repositories/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (result.success) {
        setRepoTestResult({
          status: 'success',
          message: result.data?.message || 'Connection successful and writable',
          key: repoTestKey
        })
      } else {
        setRepoTestResult({
          status: 'error',
          message: result.detail || 'Connection test failed',
          key: repoTestKey
        })
      }
    } catch (error: any) {
      setRepoTestResult({
        status: 'error',
        message: error.message || 'Failed to test connection',
        key: repoTestKey
      })
    }
  }

  const isRepoTestValid = repoTestResult.status === 'success' && repoTestResult.key === repoTestKey

  // Infinity Tools deactivation mutation
  const deactivateInfinityToolsMutation = useMutation({
    mutationFn: () => templatesAPI.deactivateInfinityTools(),
    onSuccess: () => {
      toast.success('Infinity Tools template deactivated')
      refetchInfinityTools()
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setShowInfinityToolsDetails(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to deactivate template')
    },
  })

  const handleCreate = () => {
    setEditingTemplate(null)
    setShowWizard(true)
  }

  const handleEdit = (template: Template) => {
    setEditingTemplate(template)
    setShowWizard(true)
  }

  const handleClone = (template: Template) => {
    cloneMutation.mutate(template)
  }

  const handleImport = () => {
    setShowImportModal(true)
  }

  const handleImportSubmit = () => {
    if (!importFile) {
      toast.error('Please select a file to import')
      return
    }
    importMutation.mutate(importFile)
  }

  const handleDeploy = (template: Template) => {
    if (selectedClients.length === 0) {
      toast.error('Please select at least one client from the dashboard')
      return
    }
    setDeployingTemplate(template)
  }

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      deleteMutation.mutate(id)
    } else {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(null), 3000)
    }
  }

  const handleWizardSuccess = () => {
    setShowWizard(false)
    setEditingTemplate(null)
    queryClient.invalidateQueries({ queryKey: ['templates'] })
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'schedule':
        return <Clock className="w-5 h-5 text-blue-600" />
      case 'repository':
        return <Database className="w-5 h-5 text-green-600" />
      default:
        return <FileText className="w-5 h-5 text-purple-600" />
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Backup Templates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create reusable backup configurations to deploy across multiple clients
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Backup templates are models for backup jobs, which you want to run on remote servers.
          </p>
        </div>
        <div className="flex space-x-2">
          <button onClick={handleCreate} className="btn-primary flex items-center space-x-2 whitespace-nowrap flex-shrink-0">
            <Plus className="w-4 h-4" />
            <span>Create Template</span>
          </button>
          <button onClick={handleImport} className="btn-secondary flex items-center space-x-2 whitespace-nowrap flex-shrink-0">
            <Upload className="w-4 h-4" />
            <span>Import Template</span>
          </button>
        </div>
      </div>

      {/* Infinity Tools Quick Setup Card */}
      <div className="card bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Wrench className="w-8 h-8 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              Infinity Tools Backup Template
              {isInfinityToolsActivated && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Activated
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              One-click backup solution for Infinity Tools installations. Automatically backs up all applications and databases in <code className="text-xs bg-white px-1 py-0.5 rounded">/opt/speedbits</code>.
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <Database className="w-3 h-3 mr-1" />
                Hourly database backups
              </span>
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <FileText className="w-3 h-3 mr-1" />
                Daily file backups
              </span>
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <Shield className="w-3 h-3 mr-1" />
                Ransomware protection
              </span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {!isInfinityToolsActivated ? (
                <>
                  <button
                    onClick={() => setShowActivationModal(true)}
                    disabled={activateInfinityToolsMutation.isLoading}
                    className="btn-primary text-sm"
                  >
                    {activateInfinityToolsMutation.isLoading ? 'Activating...' : 'Activate Template'}
                  </button>
                  <button
                    onClick={() => setShowInfinityToolsDetails(!showInfinityToolsDetails)}
                    className="btn-secondary text-sm"
                  >
                    {showInfinityToolsDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowInfinityToolsDetails(!showInfinityToolsDetails)}
                    className="btn-secondary text-sm"
                  >
                    {showInfinityToolsDetails ? 'Hide Details' : 'View Configuration'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to deactivate the Infinity Tools template? This will remove all associated backup jobs and schedules.')) {
                        deactivateInfinityToolsMutation.mutate()
                      }
                    }}
                    disabled={deactivateInfinityToolsMutation.isLoading}
                    className="btn-danger text-sm"
                  >
                    {deactivateInfinityToolsMutation.isLoading ? 'Deactivating...' : 'Deactivate'}
                  </button>
                </>
              )}
            </div>

            {/* Details Panel - Now shows even when not activated */}
            {showInfinityToolsDetails && infinityToolsTemplate && (
              <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">Configuration Details</h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Repository:</span>
                    <div className="mt-1 text-gray-600">{infinityToolsTemplate.repository?.path || '/opt/speedbits-backup/borgmatic-repo'}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Files Backup:</span>
                    <ul className="mt-1 text-gray-600 list-disc list-inside">
                      <li>Sources: {infinityToolsTemplate.filesBackup?.sources?.join(', ') || '/opt/speedbits'}</li>
                      <li>Schedule: {infinityToolsTemplate.filesBackup?.schedule?.cron || '0 2 * * *'} ({infinityToolsTemplate.metadata?.backup_frequency?.files || 'Daily at 2 AM'})</li>
                      <li>Retention: {infinityToolsTemplate.filesBackup?.retention?.keep_daily || 7} daily, {infinityToolsTemplate.filesBackup?.retention?.keep_weekly || 4} weekly, {infinityToolsTemplate.filesBackup?.retention?.keep_monthly || 6} monthly</li>
                    </ul>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Database Backup:</span>
                    <ul className="mt-1 text-gray-600 list-disc list-inside">
                      <li>Sources: {infinityToolsTemplate.databaseBackup?.sources?.join(', ') || '/opt/speedbits/database-dumps'}</li>
                      <li>Schedule: {infinityToolsTemplate.databaseBackup?.schedule?.cron || '0 * * * *'} ({infinityToolsTemplate.metadata?.backup_frequency?.databases || 'Every hour'})</li>
                      <li>Auto-discovery: {infinityToolsTemplate.databaseBackup?.auto_discover ? 'Enabled' : 'Disabled'}</li>
                    </ul>
                  </div>
                  <div className="pt-2 border-t border-gray-200">
                    <span className="font-medium text-gray-700 flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Protection Features:
                    </span>
                    <ul className="mt-1 text-gray-600 list-disc list-inside">
                      <li>Canary file ransomware detection</li>
                      <li>Repository integrity checks every {infinityToolsTemplate.protection?.consistency_checks?.frequency || '2 weeks'}</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
            {/* Show message if template data not available */}
            {showInfinityToolsDetails && !infinityToolsTemplate && (
              <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-yellow-700">Template details are loading or not available. Please try refreshing the page.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Templates List */}
      <div className="card">
        {templates.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500 mb-4">No templates yet</p>
            <button onClick={handleCreate} className="btn-primary">
              Create your first template
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Template
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Configuration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {templates.map((template: Template) => (
                  <tr key={template.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getIcon(template.type)}
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">{template.name}</div>
                          {template.description && (
                            <div className="text-sm text-gray-500">{template.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {template.sources_summary?.length || 0} source{template.sources_summary?.length !== 1 ? 's' : ''}
                        {' • '}
                        {template.repositories_summary?.length || 0} repo{template.repositories_summary?.length !== 1 ? 's' : ''}
                        {template.schedule_id && ' • Scheduled'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {new Date(template.created_at).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-400">
                        by {template.created_by}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleEdit(template)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4 inline" />
                      </button>
                      <button
                        onClick={() => handleClone(template)}
                        className="text-green-600 hover:text-green-900"
                        title="Clone"
                        disabled={cloneMutation.isLoading}
                      >
                        <Copy className="w-4 h-4 inline" />
                      </button>
                      <button
                        onClick={() => handleDeploy(template)}
                        className="text-purple-600 hover:text-purple-900"
                        title="Deploy to clients"
                      >
                        <Send className="w-4 h-4 inline" />
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className={`${deleteConfirm === template.id
                          ? 'text-red-900 font-bold'
                          : 'text-red-600 hover:text-red-900'
                          }`}
                        title={deleteConfirm === template.id ? 'Click again to confirm' : 'Delete'}
                        disabled={deleteMutation.isLoading}
                      >
                        <Trash2 className="w-4 h-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Wizard Modal */}
      {showWizard && (
        <BackupWizard
          onClose={() => {
            setShowWizard(false)
            setEditingTemplate(null)
          }}
          onSuccess={handleWizardSuccess}
          editBackup={editingTemplate}
          mode="template"
        />
      )}

      {/* Deployment Modal */}
      {deployingTemplate && (
        <DeploymentModal
          isOpen={true}
          onClose={() => setDeployingTemplate(null)}
          template={deployingTemplate}
          selectedClients={selectedClients}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['deployments'] })
          }}
        />
      )}

      {/* Import Template Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full m-4">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Import Template</h3>
              <p className="mt-1 text-sm text-gray-500">
                Upload a JSON template file to import
              </p>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select File
                  </label>
                  <input
                    type="file"
                    accept=".json,.yml,.yaml"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Accepted formats: JSON, YAML
                  </p>
                </div>

                {importFile && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Selected:</strong> {importFile.name}
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                      Size: {(importFile.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportFile(null)
                }}
                className="btn-secondary"
                disabled={importMutation.isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                className="btn-primary"
                disabled={!importFile || importMutation.isLoading}
              >
                {importMutation.isLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Infinity Tools Activation Modal */}
      {showActivationModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-start justify-center py-8">
          <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[calc(100vh-4rem)] flex flex-col">
            {/* Header - fixed */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Wrench className="w-6 h-6 text-blue-600" />
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Activate Infinity Tools Backup</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Choose how to store your backups
                  </p>
                </div>
              </div>
            </div>

            {/* Body - scrollable */}
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {/* Repository Option Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">Repository Option</label>

                {/* Create New Repository */}
                <label className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${repoOption === 'create' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="repoOption"
                    value="create"
                    checked={repoOption === 'create'}
                    onChange={() => {
                      setRepoOption('create')
                      resetRepoTest()
                    }}
                    className="mt-1 h-4 w-4 text-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                      <FolderPlus className="w-4 h-4 text-blue-600" />
                      <span className="font-medium text-gray-900">Create New Repository</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Create a new Borg repository at a path you specify
                    </p>
                    {repoOption === 'create' && (
                      <div className="mt-3 space-y-3">
                        {/* Warning about same disk */}
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-xs text-amber-800">
                            <strong>⚠️ Important:</strong> Storing backups on the same disk as your data is not recommended.
                            If the disk fails, you lose both your data and backups.
                          </p>
                          <p className="text-xs text-amber-700 mt-2">
                            <strong>Better options:</strong> Use a mounted network drive, NAS, or cloud storage path.
                            You can mount external storage to any path (e.g., <code className="bg-amber-100 px-1 rounded">/mnt/backup-drive</code>).
                          </p>
                          <p className="text-xs text-gray-600 mt-2">
                            <strong>For advanced users:</strong> We recommend setting up a repository first in{' '}
                            <a href="/repositories" className="text-blue-600 hover:underline">Repositories</a>{' '}
                            with SSH connection to another Borg server or Borg-compatible cloud storage, then select "Use Existing Repository" below.
                          </p>
                        </div>

                        <PathSelectorField
                          label="Repository Path"
                          value={customRepoPath}
                          onChange={(path) => {
                            setCustomRepoPath(path)
                            resetRepoTest()
                          }}
                          placeholder="/host/opt/speedbits-backup/borgmatic-repo"
                          helperText="Path where the encrypted Borg repository will be created. Use the folder icon to browse and create directories."
                          selectMode="directories"
                          inputClassName="text-sm"
                        />

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={testTemplateRepoConnection}
                            disabled={repoTestResult.status === 'testing'}
                            className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {repoTestResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
                          </button>
                          {repoTestResult.status !== 'idle' && (
                            <span className={`text-xs ${repoTestResult.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                              {repoTestResult.message || (repoTestResult.status === 'success' ? 'Connection OK' : 'Test failed')}
                            </span>
                          )}
                        </div>

                        {/* Borg Version Selection */}
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Borg Version</label>
                          <select
                            value={borgVersion}
                            onChange={(e) => setBorgVersion(e.target.value as '1.x' | '2.x')}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="1.x">Borg 1.x (Stable, Production-Ready)</option>
                            <option value="2.x">Borg 2.x (Improved, not yet for production)</option>
                          </select>
                          {borgVersion === '2.x' && (
                            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                              <strong>⚠️ Warning:</strong> Borg 2.x offers modern encryption and faster deduplication, but the Borg team does not recommend it for production use yet. Use at your own discretion!
                            </div>
                          )}
                          <p className="mt-1 text-xs text-gray-500">
                            {borgVersion === '1.x' 
                              ? '📦 Recommended for production. Widely deployed and battle-tested.'
                              : '🧪 Beta software with improved features but potential stability issues.'}
                          </p>
                        </div>

                        {/* Passphrase Fields */}
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Repository Passphrase <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type={showPassphrase ? "text" : "password"}
                                value={passphrase}
                                onChange={(e) => {
                                  setPassphrase(e.target.value)
                                  if (passphraseError) setPassphraseError(null)
                                }}
                                className={`w-full px-3 py-2 text-sm border rounded-md focus:ring-blue-500 focus:border-blue-500 ${passphraseError ? 'border-red-500' : 'border-gray-300'}`}
                                placeholder="Enter passphrase (min. 5 characters)"
                                minLength={5}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassphrase(!showPassphrase)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
                              >
                                {showPassphrase ? 'Hide' : 'Show'}
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              This passphrase encrypts your backups. Keep it safe - you need it for restores!
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Confirm Passphrase <span className="text-red-500">*</span>
                            </label>
                            <input
                              type={showPassphrase ? "text" : "password"}
                              value={confirmPassphrase}
                              onChange={(e) => {
                                setConfirmPassphrase(e.target.value)
                                if (passphraseError) setPassphraseError(null)
                              }}
                              className={`w-full px-3 py-2 text-sm border rounded-md focus:ring-blue-500 focus:border-blue-500 ${passphraseError || (passphrase && confirmPassphrase && passphrase !== confirmPassphrase) ? 'border-red-500' : 'border-gray-300'}`}
                              placeholder="Confirm passphrase"
                              minLength={5}
                            />
                            {passphraseError && (
                              <p className="mt-1 text-xs text-red-600">{passphraseError}</p>
                            )}
                            {!passphraseError && passphrase && confirmPassphrase && passphrase !== confirmPassphrase && (
                              <p className="mt-1 text-xs text-red-600">Passphrases do not match</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </label>

                {/* Use Existing Repository */}
                <label className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${repoOption === 'select' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="repoOption"
                    value="select"
                    checked={repoOption === 'select'}
                    onChange={() => {
                      setRepoOption('select')
                      resetRepoTest()
                    }}
                    className="mt-1 h-4 w-4 text-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-green-600" />
                      <span className="font-medium text-gray-900">Use Existing Repository</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Select an already configured repository
                    </p>
                    {repoOption === 'select' && (
                      <div className="mt-3">
                        {existingRepositories.length > 0 ? (
                          <select
                            value={selectedRepoId}
                            onChange={(e) => {
                              setSelectedRepoId(e.target.value)
                              resetRepoTest()
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Select a repository...</option>
                            {existingRepositories.map((repo: any) => (
                              <option key={repo.id} value={repo.id}>
                                {repo.name || getSafeDisplayPath(repo.path)} ({repo.type || 'local'})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">
                            No existing repositories found. Create one in the Repositories page first, or use "Create New Repository" option.
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={testTemplateRepoConnection}
                            disabled={repoTestResult.status === 'testing' || !selectedRepoId}
                            className="flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {repoTestResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
                          </button>
                          {repoTestResult.status !== 'idle' && (
                            <span className={`text-xs ${repoTestResult.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                              {repoTestResult.message || (repoTestResult.status === 'success' ? 'Connection OK' : 'Test failed')}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {/* Log File Path */}
              <div className="space-y-3">
                <PathSelectorField
                  label="Log File (full path, e.g. /var/log/borgmatic.log)"
                  value={logFilePath}
                  onChange={setLogFilePath}
                  onBrowseSelect={(path) => {
                    // When selecting from browser, auto-append borgmatic.log if it's a directory
                    if (path && !path.includes('.')) {
                      return path.endsWith('/') ? `${path}borgmatic.log` : `${path}/borgmatic.log`;
                    }
                    return path;
                  }}
                  placeholder={logSettingsData?.data?.data?.suggested_log_path || '/host/opt/speedbits-backup/logs/borgmatic.log'}
                  helperText="Select a directory and we'll use 'borgmatic.log' as the filename, or type a custom path. Logs are automatically rotated (max 30MB) and cleaned up after 30 days."
                  selectMode="directories"
                  inputClassName="text-sm"
                />
                {logFilePath && !logFilePath.toLowerCase().endsWith('.log') && (
                  <p className="text-xs text-amber-600 -mt-2">
                    📁 Will save as: <code className="bg-amber-50 px-1 rounded">{normalizeLogPath(logFilePath)}</code>
                  </p>
                )}
                {logSettingsData?.data?.data?.suggested_log_path && !logFilePath && (
                  <p className="text-xs text-blue-600 -mt-2">
                    💡 Using system default: <code className="bg-blue-50 px-1 rounded">{logSettingsData.data.data.suggested_log_path}</code>
                  </p>
                )}
              </div>

              {/* Info Box */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                <strong>What happens when you activate:</strong>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Creates backup jobs for files and databases</li>
                  <li>Sets up daily backup schedules (files at 2 AM, databases at 3 AM)</li>
                  <li>{repoOption === 'create' ? 'Uses your passphrase for repository encryption' : 'Uses the existing repository encryption'}</li>
                </ul>
              </div>
            </div>

            {/* Footer - fixed */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3 flex-shrink-0">
              <button
                onClick={closeActivationModal}
                className="btn-secondary"
                disabled={activateInfinityToolsMutation.isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleActivate}
                className="btn-primary flex items-center gap-2"
                disabled={activateInfinityToolsMutation.isLoading || (repoOption === 'select' && !selectedRepoId)}
              >
                {activateInfinityToolsMutation.isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Activating...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Activate Template
                  </>
                )}
              </button>
            </div>

            {/* Loading overlay when activating */}
            {activateInfinityToolsMutation.isLoading && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">Setting up your backup...</p>
                    <p className="text-xs text-blue-600">This may take a few minutes. Please wait while we initialize the repository and configure backups.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

