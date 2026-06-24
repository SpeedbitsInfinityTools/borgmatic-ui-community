import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { templatesAPI, repositoriesAPI, logsAPI, sshKeysAPI, systemConfigAPI } from '../services/api'
import { FileText, Plus, Edit2, Trash2, Copy, Send, Clock, Database, Upload, Wrench, Shield, CheckCircle, AlertTriangle, FolderPlus, HardDrive, Download, ArrowRight, Server, Monitor, KeyRound, Lock, Eye, EyeOff } from 'lucide-react'
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
  const navigate = useNavigate()
  const userTemplateFileInputRef = useRef<HTMLInputElement>(null)
  const [deletingUserTemplate, setDeletingUserTemplate] = useState<{ id: string; name: string } | null>(null)
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
  // Default to "select" since reusing an existing repository is the common case.
  const [repoOption, setRepoOption] = useState<'create' | 'select'>('select')
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
  // Backup source path (data path for Infinity Tools)
  const [backupSourcePath, setBackupSourcePath] = useState('/host/opt/speedbits')
  // Which built-in template the activation modal is currently activating
  const [activeTemplate, setActiveTemplate] = useState<'infinity-tools' | 'linux-server'>('infinity-tools')
  // Selected backup categories (Linux Server template)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [showLinuxDetails, setShowLinuxDetails] = useState(false)
  // Tracks whether category defaults have been applied for the open modal session,
  // so we initialize them once even if the template status loads after the modal opens.
  const linuxDefaultsAppliedRef = useRef(false)

  // Linux Server template: backup target (local server vs. remote over SSH/SFTP)
  const [linuxTarget, setLinuxTarget] = useState<'local' | 'remote'>('local')
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState<number>(22)
  const [sshUsername, setSshUsername] = useState('')
  const [sshAuthMethod, setSshAuthMethod] = useState<'key' | 'password'>('key')
  const [sshKeyId, setSshKeyId] = useState<string>('')
  const [sshPassword, setSshPassword] = useState('')
  const [showSshPassword, setShowSshPassword] = useState(false)
  const [sshTestResult, setSshTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message?: string }>({ status: 'idle' })

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
  // Get discovered paths for auto-populating the backup source
  const discoveredPaths = infinityToolsStatus?.discovered_paths
  const suggestedBackupSource = discoveredPaths?.suggested_backup_source || '/host/opt/speedbits'

  // Fetch Linux Server template status (+ definition with categories)
  const { data: linuxServerData, refetch: refetchLinuxServer } = useQuery({
    queryKey: ['linux-server-template'],
    queryFn: () => templatesAPI.getLinuxServerStatus(),
  })
  const linuxServerStatus = linuxServerData?.data?.data
  const isLinuxServerActivated = linuxServerStatus?.activated || false
  const linuxServerTemplate = linuxServerStatus?.template
  const linuxCategories: Array<{ id: string; label: string; description: string; default: boolean }> =
    linuxServerTemplate?.categories || []
  const isLinuxTemplate = activeTemplate === 'linux-server'
  // Database auto-discovery and disaster-recovery capture only work for the local
  // server, so they are hidden when backing up a remote target over SSH/SFTP.
  const visibleLinuxCategories = linuxTarget === 'remote'
    ? linuxCategories.filter((c) => c.id !== 'databases' && c.id !== 'dr_extras')
    : linuxCategories

  // Fetch existing repositories for selection
  const { data: repositoriesData } = useQuery({
    queryKey: ['repositories'],
    queryFn: () => repositoriesAPI.getRepositoriesFast(),
  })
  const existingRepositories = repositoriesData?.data?.data?.repositories || []

  // SSH keys for the remote (SSH/SFTP) Linux backup target. Encrypted keys are
  // not usable for sshfs mounts, so they are filtered out of the picker.
  const { data: sshKeysData } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: () => sshKeysAPI.getSSHKeys(),
    enabled: showActivationModal && isLinuxTemplate,
  })
  const sshKeys: Array<{ id: string | number; name: string; key_type: string; is_encrypted?: boolean }> =
    sshKeysData?.data?.ssh_keys || sshKeysData?.data?.data?.ssh_keys || []
  const selectableSshKeys = sshKeys.filter((k) => !k.is_encrypted)

  // sshfs availability — remote sources are sshfs-mounted at backup time, which
  // needs FUSE enabled on the borgmatic-ui container. Surface a warning if not.
  const { data: sshfsStatusData } = useQuery({
    queryKey: ['sshfs-status'],
    queryFn: () => systemConfigAPI.getSshfsStatus(),
    enabled: showActivationModal && isLinuxTemplate && linuxTarget === 'remote',
  })
  const sshfsAvailable = sshfsStatusData?.data?.data?.available !== false

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

  const resetSshTest = () => {
    setSshTestResult({ status: 'idle' })
  }

  // Test the remote SSH/SFTP connection by listing the remote root — the same
  // code path the backup uses to reach the server, so success here means the
  // credentials and connectivity are good.
  const testSshConnection = async () => {
    const host = sshHost.trim()
    const username = sshUsername.trim()
    if (!host || !username) {
      toast.error('Enter the SSH host and username first.')
      return
    }
    if (sshAuthMethod === 'key' && !sshKeyId) {
      toast.error('Select an SSH key first.')
      return
    }
    if (sshAuthMethod === 'password' && !sshPassword) {
      toast.error('Enter the SSH password first.')
      return
    }

    const baseConn = {
      host,
      port: Number.isInteger(sshPort) ? sshPort : 22,
      username,
      ssh_key_id: sshAuthMethod === 'key' ? (sshKeyId as any) : undefined,
      ssh_auth_method: sshAuthMethod,
      ssh_password: sshAuthMethod === 'password' ? sshPassword : undefined,
      remote_path: '/',
    }
    const extractErr = (err: any) =>
      err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Connection failed'

    setSshTestResult({ status: 'testing', message: 'Connecting...' })
    try {
      // Remote backups mount files via sshfs (SFTP), so SFTP is the
      // authoritative test for whether the backup will work.
      const res: any = await repositoriesAPI.sshBrowse({ ...baseConn, use_sftp: true })
      if (res.data?.success) {
        setSshTestResult({ status: 'success', message: 'Connection successful (SFTP)' })
        return
      }
      throw new Error(res.data?.error || res.data?.detail || 'Connection failed')
    } catch (sftpErr: any) {
      const sftpDetail = extractErr(sftpErr)
      // Disambiguate: a plain SSH login (shell) can work while the SFTP
      // subsystem is disabled. Probe shell access so the message is precise.
      let shellOk = false
      try {
        const shellRes: any = await repositoriesAPI.sshBrowse({ ...baseConn, use_sftp: false })
        shellOk = !!shellRes.data?.success
      } catch {
        shellOk = false
      }
      if (shellOk) {
        setSshTestResult({
          status: 'error',
          message: `SSH login works, but SFTP failed: ${sftpDetail} Remote backups mount files over SFTP (sshfs), so the server must allow SFTP access (enable the SFTP subsystem in sshd).`,
        })
      } else {
        setSshTestResult({ status: 'error', message: sftpDetail })
      }
    }
  }

  const closeActivationModal = () => {
    setShowActivationModal(false)
    setPassphrase('')
    setConfirmPassphrase('')
    setShowPassphrase(false)
    setPassphraseError(null)
    resetRepoTest()
    linuxDefaultsAppliedRef.current = false
    // Reset backup source path to suggested value
    setBackupSourcePath(suggestedBackupSource)
    // Reset remote (SSH) target state
    setLinuxTarget('local')
    setSshHost('')
    setSshPort(22)
    setSshUsername('')
    setSshAuthMethod('key')
    setSshKeyId('')
    setSshPassword('')
    setShowSshPassword(false)
    resetSshTest()
  }

  const openActivationModalFor = (templateId: 'infinity-tools' | 'linux-server') => {
    setActiveTemplate(templateId)
    setRepoOption('select')
    setLinuxTarget('local')
    resetRepoTest()
    resetSshTest()
    if (templateId === 'linux-server') {
      // Apply category defaults now if the template is already loaded; otherwise
      // the effect below initializes them once the status query resolves.
      const cats = linuxCategories.length > 0
        ? linuxCategories
        : (linuxServerTemplate?.categories || [])
      if (cats.length > 0) {
        setSelectedCategories(cats.filter((c: any) => c.default).map((c: any) => c.id))
        linuxDefaultsAppliedRef.current = true
      } else {
        setSelectedCategories([])
        linuxDefaultsAppliedRef.current = false
      }
      // Use the backend template's repository path so the UI matches what the
      // server would create (env-driven; works for Docker and native installs).
      setCustomRepoPath(linuxServerTemplate?.repository?.path || '/backup-destination/borgmatic-repo')
    } else {
      setBackupSourcePath(suggestedBackupSource)
      setCustomRepoPath('/host/opt/speedbits-backup/borgmatic-repo')
    }
    setShowActivationModal(true)
  }

  // Initialize Linux category defaults once the template status resolves, in case
  // the activation modal was opened before the query finished loading.
  useEffect(() => {
    if (
      showActivationModal &&
      activeTemplate === 'linux-server' &&
      !linuxDefaultsAppliedRef.current &&
      linuxCategories.length > 0
    ) {
      setSelectedCategories(linuxCategories.filter((c) => c.default).map((c) => c.id))
      linuxDefaultsAppliedRef.current = true
    }
  }, [showActivationModal, activeTemplate, linuxCategories.length])

  // Drop local-only categories when switching to a remote (SSH/SFTP) target.
  useEffect(() => {
    resetSshTest()
    if (linuxTarget === 'remote') {
      setSelectedCategories((prev) => prev.filter((id) => id !== 'databases' && id !== 'dr_extras'))
    }
  }, [linuxTarget])

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
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

  // Saved user templates (exported from backup jobs or imported from a file)
  const { data: userTemplatesData } = useQuery({
    queryKey: ['user-templates'],
    queryFn: () => templatesAPI.listUserTemplates(),
  })
  const userTemplates: Array<{ id: string; name: string; description?: string; created_at?: string; template: any }> =
    userTemplatesData?.data?.data?.templates || []

  const saveUserTemplateMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string; template: any }) =>
      templatesAPI.saveUserTemplate(payload),
    onSuccess: () => {
      toast.success('Template imported')
      queryClient.invalidateQueries({ queryKey: ['user-templates'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to import template')
    },
  })

  const deleteUserTemplateMutation = useMutation({
    mutationFn: (id: string) => templatesAPI.deleteUserTemplate(id),
    onSuccess: () => {
      toast.success('Template deleted')
      queryClient.invalidateQueries({ queryKey: ['user-templates'] })
      setDeletingUserTemplate(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete template')
    },
  })

  const handleImportUserTemplateFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const MAX_TEMPLATE_SIZE = 1024 * 1024 // 1MB
    if (file.size > MAX_TEMPLATE_SIZE) {
      toast.error('Template file is too large (max 1MB).')
      if (userTemplateFileInputRef.current) userTemplateFileInputRef.current.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error('Invalid template file format.')
          return
        }
        if (
          !parsed.name ||
          !Array.isArray(parsed.sources) || parsed.sources.length === 0 ||
          !Array.isArray(parsed.repositories) || parsed.repositories.length === 0
        ) {
          toast.error('Invalid template: name, sources, and repositories are required.')
          return
        }
        saveUserTemplateMutation.mutate({
          name: parsed.name,
          description: typeof parsed.description === 'string' ? parsed.description : '',
          template: parsed,
        })
      } catch {
        toast.error('Failed to parse template file. Please ensure it is valid JSON.')
      }
    }
    reader.readAsText(file)

    if (userTemplateFileInputRef.current) {
      userTemplateFileInputRef.current.value = ''
    }
  }

  const handleUseUserTemplate = (entry: { template: any }) => {
    // Hand off to the Backups page, which opens the create wizard prefilled.
    navigate('/backups', { state: { useTemplate: entry.template } })
  }

  const handleDownloadUserTemplate = (entry: { name: string; template: any }) => {
    const blob = new Blob([JSON.stringify(entry.template, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${entry.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  // Infinity Tools activation mutation
  const activateInfinityToolsMutation = useMutation({
    mutationFn: (options: { repoOption: 'create' | 'select', repoPath?: string, repoId?: string, logPath?: string, borgVersion?: string, passphrase?: string, backupSourcePath?: string }) =>
      templatesAPI.activateInfinityTools({
        passphrase: options.passphrase || 'AUTO_GENERATE',
        repository_option: options.repoOption,
        repository_path: options.repoPath,
        repository_id: options.repoId,
        log_file_path: options.logPath,
        borg_version: options.borgVersion,
        backup_source_path: options.backupSourcePath
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

  // Linux Server activation mutation
  const activateLinuxServerMutation = useMutation({
    mutationFn: (options: { categories: string[], repoOption: 'create' | 'select', repoPath?: string, repoId?: string, logPath?: string, borgVersion?: string, passphrase?: string, sourceType?: 'local' | 'remote', ssh?: any }) =>
      templatesAPI.activateLinuxServer({
        categories: options.categories,
        passphrase: options.passphrase || 'AUTO_GENERATE',
        repository_option: options.repoOption,
        repository_path: options.repoPath,
        repository_id: options.repoId,
        log_file_path: options.logPath,
        borg_version: options.borgVersion,
        source_type: options.sourceType || 'local',
        ssh: options.sourceType === 'remote' ? options.ssh : undefined,
      }),
    onSuccess: (response) => {
      const warnings = response.data?.warnings || []
      const partialSuccess = response.data?.partial_success

      if (partialSuccess && warnings.length > 0) {
        toast.success('Linux Server backup partially activated!', { duration: 6000 })
        warnings.forEach((warning: string) => {
          toast.error(`⚠️ ${warning}`, { duration: 8000 })
        })
      } else {
        toast.success('Linux Server backup activated! Repository passphrase saved.')
      }

      refetchLinuxServer()
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
      setShowLinuxDetails(false)
      closeActivationModal()
    },
    onError: (error: any) => {
      const errorData = error.response?.data
      const errorCode = errorData?.error_code
      const detail = errorData?.detail || 'Failed to activate Linux Server template'

      if (errorCode === 'ALREADY_ACTIVATED') {
        toast.error('Template is already activated. Refresh the page to see current status.')
      } else {
        toast.error(detail, { duration: 6000 })
      }
    },
  })

  // Linux Server deactivation mutation
  const deactivateLinuxServerMutation = useMutation({
    mutationFn: () => templatesAPI.deactivateLinuxServer(),
    onSuccess: () => {
      toast.success('Linux Server template deactivated')
      refetchLinuxServer()
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setShowLinuxDetails(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to deactivate template')
    },
  })

  const isActivating = isLinuxTemplate
    ? activateLinuxServerMutation.isLoading
    : activateInfinityToolsMutation.isLoading

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
      toast.error('Please click "Test Connection" for the repository before activating.')
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

    if (isLinuxTemplate) {
      if (selectedCategories.length === 0) {
        toast.error('Select at least one backup category before activating.')
        return
      }

      // Validate the remote (SSH/SFTP) target before activating.
      let sshPayload: any = undefined
      if (linuxTarget === 'remote') {
        if (!sshHost.trim() || !sshUsername.trim()) {
          toast.error('Enter the remote SSH host and username.')
          return
        }
        if (sshAuthMethod === 'key' && !sshKeyId) {
          toast.error('Select an SSH key for key authentication.')
          return
        }
        if (sshAuthMethod === 'password' && !sshPassword) {
          toast.error('Enter the SSH password for password authentication.')
          return
        }
        sshPayload = {
          host: sshHost.trim(),
          port: sshPort,
          username: sshUsername.trim(),
          auth_method: sshAuthMethod,
          ssh_key_id: sshAuthMethod === 'key' ? sshKeyId : undefined,
          ssh_password: sshAuthMethod === 'password' ? sshPassword : undefined,
          use_sftp: true,
        }
      }

      activateLinuxServerMutation.mutate({
        categories: selectedCategories,
        repoOption,
        // For "select", send the selected repo's path so the backend can match it
        // even when the repo has no stable id (synthetic "repo-legacy-N" ids).
        repoPath: repoOption === 'create' ? customRepoPath : selectedRepo?.path,
        repoId: repoOption === 'select' ? selectedRepoId : undefined,
        logPath: normalizedLogPath,
        borgVersion: repoOption === 'create' ? borgVersion : undefined,
        passphrase: repoOption === 'create' ? passphrase : undefined,
        sourceType: linuxTarget,
        ssh: sshPayload,
      })
      return
    }

    activateInfinityToolsMutation.mutate({
      repoOption,
      // For "select", send the selected repo's path as a fallback match key.
      repoPath: repoOption === 'create' ? customRepoPath : selectedRepo?.path,
      repoId: repoOption === 'select' ? selectedRepoId : undefined,
      logPath: normalizedLogPath,
      borgVersion: repoOption === 'create' ? borgVersion : undefined,
      passphrase: repoOption === 'create' ? passphrase : undefined,
      backupSourcePath: backupSourcePath
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
              One-click backup solution for Infinity Tools installations. The data path is auto-detected and can be changed during activation.
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
                    onClick={() => openActivationModalFor('infinity-tools')}
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
                      <li>Sources: {infinityToolsTemplate.filesBackup?.sources?.join(', ') || suggestedBackupSource}</li>
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

      {/* Linux Server Quick Setup Card */}
      <div className="card bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-emerald-100 rounded-lg">
            <HardDrive className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              Linux Server Backup Template
              {isLinuxServerActivated && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Activated
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Category-based backup for a generic Linux server. Tick what to back up (home, /etc, Docker volumes, web sites, databases, ...) and it creates editable backup jobs you can fine-tune afterwards.
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <FileText className="w-3 h-3 mr-1" />
                /home, /etc, /var/www, ...
              </span>
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <Database className="w-3 h-3 mr-1" />
                Auto-discover databases
              </span>
              <span className="inline-flex items-center px-2 py-1 bg-white rounded">
                <Shield className="w-3 h-3 mr-1" />
                Disaster-recovery state
              </span>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {!isLinuxServerActivated ? (
                <>
                  <button
                    onClick={() => openActivationModalFor('linux-server')}
                    disabled={activateLinuxServerMutation.isLoading}
                    className="btn-primary text-sm"
                  >
                    {activateLinuxServerMutation.isLoading ? 'Activating...' : 'Activate Template'}
                  </button>
                  <button
                    onClick={() => setShowLinuxDetails(!showLinuxDetails)}
                    className="btn-secondary text-sm"
                  >
                    {showLinuxDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowLinuxDetails(!showLinuxDetails)}
                    className="btn-secondary text-sm"
                  >
                    {showLinuxDetails ? 'Hide Details' : 'View Configuration'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to deactivate the Linux Server template? This will remove all associated backup jobs and schedules.')) {
                        deactivateLinuxServerMutation.mutate()
                      }
                    }}
                    disabled={deactivateLinuxServerMutation.isLoading}
                    className="btn-danger text-sm"
                  >
                    {deactivateLinuxServerMutation.isLoading ? 'Deactivating...' : 'Deactivate'}
                  </button>
                </>
              )}
            </div>

            {showLinuxDetails && linuxCategories.length > 0 && (
              <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">Available Backup Categories</h4>
                <ul className="space-y-2 text-sm">
                  {linuxCategories.map((cat) => (
                    <li key={cat.id} className="flex items-start gap-2">
                      <span className={`mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${cat.default ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      <span>
                        <span className="font-medium text-gray-800">{cat.label}</span>
                        {cat.default && <span className="ml-2 text-xs text-emerald-600">(on by default)</span>}
                        <span className="block text-gray-500">{cat.description}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">
                  Activation creates editable backup jobs. In Docker, host paths are read from the <code className="bg-gray-100 px-1 rounded">/host</code> mount; disaster-recovery and firewall capture is best-effort.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* My Saved Templates */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">My Saved Templates</h2>
            <p className="mt-1 text-sm text-gray-500">
              Templates you exported from backup jobs or imported from a file. Use one to create a new backup job pre-filled with its settings.
            </p>
          </div>
          <button
            onClick={() => userTemplateFileInputRef.current?.click()}
            className="btn-secondary flex items-center space-x-2 whitespace-nowrap flex-shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Import Template</span>
          </button>
          <input
            ref={userTemplateFileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportUserTemplateFile}
            className="hidden"
          />
        </div>

        {userTemplates.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg">
            <FileText className="w-10 h-10 mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No saved templates yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              On the Backup Jobs page, use "Export Template" → "Save to Templates page", or import a template file here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {userTemplates.map((entry) => (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-4 flex flex-col">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0">
                    <FileText className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-gray-900 truncate" title={entry.name}>{entry.name}</h3>
                    {entry.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{entry.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {Array.isArray(entry.template?.sources) ? entry.template.sources.length : 0} source(s)
                      {entry.created_at ? ` · ${new Date(entry.created_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => handleUseUserTemplate(entry)}
                    className="btn-primary text-xs flex items-center gap-1 flex-1 justify-center"
                  >
                    Use Template
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDownloadUserTemplate(entry)}
                    className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                    title="Download as file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeletingUserTemplate({ id: entry.id, name: entry.name })}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                    title="Delete template"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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

      {/* Delete Saved Template Confirmation */}
      {deletingUserTemplate && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
          <div className="relative mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
            <div className="flex items-start mb-4">
              <Trash2 className="h-6 w-6 text-red-600 flex-shrink-0" />
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">Delete Template</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Really delete <span className="font-semibold text-gray-900">"{deletingUserTemplate.name}"</span>? This only removes the saved template, not any existing backup jobs.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end space-x-3">
              <button
                onClick={() => setDeletingUserTemplate(null)}
                disabled={deleteUserTemplateMutation.isLoading}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteUserTemplateMutation.mutate(deletingUserTemplate.id)}
                disabled={deleteUserTemplateMutation.isLoading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleteUserTemplateMutation.isLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
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
            <div className={`px-6 py-4 border-b border-gray-200 flex-shrink-0 ${isLinuxTemplate ? 'bg-gradient-to-r from-emerald-50 to-teal-50' : 'bg-gradient-to-r from-blue-50 to-indigo-50'}`}>
              <div className="flex items-center gap-3">
                {isLinuxTemplate
                  ? <HardDrive className="w-6 h-6 text-emerald-600" />
                  : <Wrench className="w-6 h-6 text-blue-600" />}
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    {isLinuxTemplate ? 'Activate Linux Server Backup' : 'Activate Infinity Tools Backup'}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {isLinuxTemplate ? 'Pick what to back up and where to store it' : 'Choose how to store your backups'}
                  </p>
                </div>
              </div>
            </div>

            {/* Body - scrollable */}
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {isLinuxTemplate ? (
                <>
                  {/* Backup target: local server vs. remote over SSH/SFTP */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Backup target</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setLinuxTarget('local')}
                        className={`flex items-center gap-2 p-3 border rounded-lg text-left transition-colors ${linuxTarget === 'local' ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <Monitor className={`w-5 h-5 ${linuxTarget === 'local' ? 'text-emerald-600' : 'text-gray-400'}`} />
                        <span>
                          <span className="block text-sm font-medium text-gray-900">This server</span>
                          <span className="block text-xs text-gray-500">Where borgmatic runs</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinuxTarget('remote')}
                        className={`flex items-center gap-2 p-3 border rounded-lg text-left transition-colors ${linuxTarget === 'remote' ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <Server className={`w-5 h-5 ${linuxTarget === 'remote' ? 'text-emerald-600' : 'text-gray-400'}`} />
                        <span>
                          <span className="block text-sm font-medium text-gray-900">Remote server</span>
                          <span className="block text-xs text-gray-500">Over SSH / SFTP</span>
                        </span>
                      </button>
                    </div>

                    {linuxTarget === 'remote' && (
                      <div className="mt-2 space-y-3 p-3 border border-teal-200 bg-teal-50 rounded-lg">
                        {!sshfsAvailable && (
                          <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>
                              SSH/SFTP sources are mounted with <span className="font-mono">sshfs</span>, which needs FUSE enabled on the
                              borgmatic-ui container. It looks unavailable here, so the backup may fail until FUSE/sshfs is enabled.
                            </span>
                          </div>
                        )}

                        {/* Host / Port / Username */}
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-7">
                            <label className="block text-xs font-medium text-gray-600 mb-0.5">Host *</label>
                            <input
                              type="text"
                              value={sshHost}
                              onChange={(e) => { setSshHost(e.target.value); resetSshTest() }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                              placeholder="server.example.com"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-0.5">Port</label>
                            <input
                              type="number"
                              value={sshPort}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10)
                                setSshPort(Number.isNaN(v) ? 22 : v)
                                resetSshTest()
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                              placeholder="22"
                              min={1}
                              max={65535}
                            />
                          </div>
                          <div className="col-span-3">
                            <label className="block text-xs font-medium text-gray-600 mb-0.5">Username *</label>
                            <input
                              type="text"
                              value={sshUsername}
                              onChange={(e) => { setSshUsername(e.target.value); resetSshTest() }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                              placeholder="root"
                            />
                          </div>
                        </div>

                        {/* Auth method */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Authentication</label>
                          <div className="flex bg-gray-100 rounded p-0.5 max-w-[260px]">
                            <button
                              type="button"
                              onClick={() => { setSshAuthMethod('key'); resetSshTest() }}
                              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${sshAuthMethod === 'key' ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                            >
                              <KeyRound className="w-3 h-3" /> SSH Key
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSshAuthMethod('password'); resetSshTest() }}
                              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${sshAuthMethod === 'password' ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                            >
                              <Lock className="w-3 h-3" /> Password
                            </button>
                          </div>
                        </div>

                        {sshAuthMethod === 'key' ? (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-0.5">SSH Key *</label>
                            <select
                              value={sshKeyId}
                              onChange={(e) => { setSshKeyId(e.target.value); resetSshTest() }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                            >
                              <option value="">Select an SSH key…</option>
                              {selectableSshKeys.map((k) => (
                                <option key={k.id} value={String(k.id)}>
                                  {k.name} ({k.key_type})
                                </option>
                              ))}
                            </select>
                            {selectableSshKeys.length === 0 && (
                              <p className="mt-1 text-xs text-gray-500">
                                No usable SSH keys yet. Add an unencrypted key under <span className="font-medium">SSH Keys</span> in the sidebar, or use password auth.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-0.5">SSH Password *</label>
                            <div className="relative">
                              <input
                                type={showSshPassword ? 'text' : 'password'}
                                value={sshPassword}
                                onChange={(e) => { setSshPassword(e.target.value); resetSshTest() }}
                                className="w-full px-2 py-1 pr-8 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                placeholder="Enter SSH password"
                                autoComplete="new-password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSshPassword((v) => !v)}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                title={showSshPassword ? 'Hide password' : 'Show password'}
                              >
                                {showSshPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">Stored encrypted in the password vault.</p>
                          </div>
                        )}

                        {/* Test connection */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={testSshConnection}
                            disabled={sshTestResult.status === 'testing'}
                            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Server className="w-3.5 h-3.5" />
                            {sshTestResult.status === 'testing' ? 'Testing...' : 'Test Connection'}
                          </button>
                          {sshTestResult.status === 'success' && (
                            <span className="flex items-center gap-1 text-xs text-green-700">
                              <CheckCircle className="w-3.5 h-3.5" /> {sshTestResult.message || 'Connection successful'}
                            </span>
                          )}
                        </div>
                        {sshTestResult.status === 'error' && (
                          <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span className="break-words">{sshTestResult.message || 'Connection failed'}</span>
                          </div>
                        )}

                        <p className="text-xs text-teal-800">
                          The remote folders are temporarily sshfs-mounted while the backup runs. Databases and disaster-recovery
                          capture are skipped for remote targets (they only work on the local server).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Backup Categories (Linux Server) */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">What to back up</label>
                    <p className="text-xs text-gray-500">
                      Ticked categories become the sources of editable backup jobs. You can refine each job afterwards in the Backups page.
                    </p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {visibleLinuxCategories.length === 0 ? (
                        <p className="p-3 text-sm text-amber-600">Loading categories...</p>
                      ) : (
                        visibleLinuxCategories.map((cat) => (
                          <label key={cat.id} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={selectedCategories.includes(cat.id)}
                              onChange={() => toggleCategory(cat.id)}
                              className="mt-1 h-4 w-4 text-emerald-600 rounded"
                            />
                            <span>
                              <span className="font-medium text-sm text-gray-900">{cat.label}</span>
                              <span className="block text-xs text-gray-500">{cat.description}</span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {linuxTarget === 'remote'
                        ? 'Paths are read from the remote server over SFTP. Make sure your SSH user can read them.'
                        : 'In Docker, host paths are read from the /host mount. Disaster-recovery and firewall capture is best-effort and depends on host tooling/permissions.'}
                    </p>
                  </div>
                </>
              ) : (
                /* Backup Source Path (Data Path) - Infinity Tools */
                <div className="space-y-2">
                  <PathSelectorField
                    label="Infinity Tools Data Path"
                    value={backupSourcePath}
                    onChange={setBackupSourcePath}
                    placeholder="/host/opt/speedbits"
                    helperText="Path to your Infinity Tools data directory. This is where your applications and configurations are stored."
                    selectMode="directories"
                    inputClassName="text-sm"
                  />
                  {discoveredPaths?.discovered && (
                    <p className="text-xs text-green-600">
                      ✅ Auto-discovered from <code className="bg-green-50 px-1 rounded">/etc/infinitytools.conf</code>
                    </p>
                  )}
                  {discoveredPaths && !discoveredPaths.discovered && (
                    <p className="text-xs text-amber-600">
                      ⚠️ Using default path (no infinitytools.conf found)
                    </p>
                  )}
                </div>
              )}

              {/* Repository Option Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">Repository Option</label>

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
                          placeholder={isLinuxTemplate ? (linuxServerTemplate?.repository?.path || '/backup-destination/borgmatic-repo') : '/host/opt/speedbits-backup/borgmatic-repo'}
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
                  {isLinuxTemplate ? (
                    <>
                      <li>
                        Creates an editable files backup job from your selected categories
                        {linuxTarget === 'remote' && <> on <span className="font-medium">{sshUsername || 'user'}@{sshHost || 'remote host'}</span> (via sshfs/SFTP)</>}
                      </li>
                      {selectedCategories.includes('databases') && <li>Auto-discovers databases and creates a separate database backup job</li>}
                      <li>{selectedCategories.includes('databases') ? 'Sets up daily backup schedules (files at 2 AM, databases at 3 AM)' : 'Sets up a daily files backup schedule (2 AM)'}</li>
                      <li>{repoOption === 'create' ? 'Uses your passphrase for repository encryption' : 'Uses the existing repository encryption'}</li>
                    </>
                  ) : (
                    <>
                      <li>Creates backup jobs for files and databases</li>
                      <li>Sets up daily backup schedules (files at 2 AM, databases at 3 AM)</li>
                      <li>{repoOption === 'create' ? 'Uses your passphrase for repository encryption' : 'Uses the existing repository encryption'}</li>
                    </>
                  )}
                </ul>
              </div>
            </div>

            {/* Footer - fixed */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3 flex-shrink-0">
              <button
                onClick={closeActivationModal}
                className="btn-secondary"
                disabled={isActivating}
              >
                Cancel
              </button>
              <button
                onClick={handleActivate}
                className="btn-primary flex items-center gap-2"
                disabled={isActivating || (repoOption === 'select' && !selectedRepoId) || (isLinuxTemplate && selectedCategories.length === 0)}
              >
                {isActivating ? (
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
            {isActivating && (
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

