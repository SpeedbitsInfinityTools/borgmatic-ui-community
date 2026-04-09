import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  Trash2,
  FileText,
  Database,
  HardDrive,
  Clock,
  Settings,
  FolderPlus,
  AlertCircle,
  CheckCircle,
  Search,
  Loader2,
  List,
  Code,
  Play,
  AlertTriangle,
  Cloud,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { repositoriesAPI, backupsAPI, scheduleAPI, templatesAPI, sshKeysAPI, databaseDiscoveryAPI, identityAPI, scriptsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { getSafeDisplayPath } from '../utils/repositoryUtils';
import PathSelectorField from './PathSelectorField';

type WizardMode = 'production' | 'template' | 'from-template';

interface BackupWizardProps {
  onClose: () => void;
  onSuccess: () => void;
  editBackup?: any;
  mode?: WizardMode; // 'production' (default), 'template', or 'from-template'
  templateData?: any; // Pre-fill data when mode is 'from-template'
}

const BackupWizard: React.FC<BackupWizardProps> = ({
  onClose,
  onSuccess,
  editBackup,
  mode = 'production',
  templateData
}) => {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [operatingMode, setOperatingMode] = useState<string>('standalone');

  // Fetch operating mode
  useEffect(() => {
    const fetchMode = async () => {
      try {
        const response = await identityAPI.getStatus();
        setOperatingMode(response.data.data.mode);
      } catch (error) {
        console.error('Failed to fetch mode:', error);
      }
    };
    fetchMode();
  }, []);

  // Determine initial data source (edit, template, or fresh)
  const initialData = editBackup || templateData || {};

  // For templates, data is nested in config. For backups, it's at top level.
  const isEditingTemplate = editBackup && mode === 'template';
  const dataSource = isEditingTemplate ? initialData?.config || {} : initialData;

  const [formData, setFormData] = useState({
    // Step 1: Basic Settings
    name: initialData?.name || '',
    description: initialData?.description || '',
    schedule_id: dataSource?.schedule_id || null,
    cron_expression: dataSource?.cron_expression || '0 2 * * *', // Default: daily at 2 AM

    // Step 2: Sources
    sources: dataSource?.sources ||
      initialData?.sources_summary ||
      initialData?.config?.location?.source_directories?.map((dir: string) => ({
        type: 'local',
        path: dir,
      })) || [],

    // Step 3: Repositories
    repositories: dataSource?.repositories || initialData?.repositories_summary || [],

    // Step 4: Retention
    retention_profile_id: dataSource?.retention_profile_id || 'profile-standard',

    // Step 5: Scripts (hooks) - handled via formData.hooks

    // Step 6: Advanced
    exclude_patterns: dataSource?.exclude_patterns || [],
    exclude_caches: dataSource?.exclude_caches !== false,
    upload_rate_limit: dataSource?.upload_rate_limit || 0,
    archive_name_format: dataSource?.archive_name_format || '{hostname}-{now}',
    check_frequency: dataSource?.check_frequency || '2 weeks',
    log_file: dataSource?.log_file || '',
    log_level: dataSource?.log_level || 'info',
    hooks: {
      before_backup: dataSource?.hooks?.before_backup || [],
      after_backup: dataSource?.hooks?.after_backup || [],
      on_error: dataSource?.hooks?.on_error || [],
    },
    // Canary file for ransomware detection
    canary_file_enabled: dataSource?.canary_file_enabled || false,
    canary_file_path: dataSource?.canary_file_path || '',
    // Auto-break stale locks before backup
    auto_break_lock: dataSource?.auto_break_lock || false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [patternErrors, setPatternErrors] = useState<Record<number, string>>({});
  const [showCanaryFileBrowser, setShowCanaryFileBrowser] = useState(false);
  const [canaryFileCreating, setCanaryFileCreating] = useState(false);
  const [customHookInput, setCustomHookInput] = useState({ before_backup: '', after_backup: '', on_error: '' });
  
  // Sync to cloud state
  const [syncConfig, setSyncConfig] = useState({
    enabled: false,
    type: 'local' as 'local' | 'rclone',
    localPath: '',
    rcloneRemote: '',
    rclonePath: '',
  });
  const [rcloneRemotes, setRcloneRemotes] = useState<Array<{ name: string; type: string }>>([]);
  const [loadingRcloneRemotes, setLoadingRcloneRemotes] = useState(false);
  
  const [validationResult, setValidationResult] = useState<{
    status: 'validating' | 'valid' | 'invalid' | null;
    error: string | null;
  }>({ status: null, error: null });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Database auto-discovery state
  const [discoveredDatabases, setDiscoveredDatabases] = useState<any[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [showDiscoveryResults, setShowDiscoveryResults] = useState(false);
  const [showDiscoveryOptions, setShowDiscoveryOptions] = useState(false);
  const [discoveryOptions, setDiscoveryOptions] = useState({
    includeHost: true,
    networks: ['borgmatic-db'] as string[],
  });
  const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);
  const [isLoadingNetworks, setIsLoadingNetworks] = useState(false);

  // Custom retention profile state
  const [showRetentionModal, setShowRetentionModal] = useState(false);
  const [customRetention, setCustomRetention] = useState({
    name: '',
    description: '',
    keep_hourly: 0,
    keep_daily: 7,
    keep_weekly: 4,
    keep_monthly: 6,
    keep_yearly: 1,
  });

  // Database browser state
  const [dbBrowserState, setDbBrowserState] = useState<{
    isOpen: boolean;
    sourceIndex: number;
    isLoading: boolean;
    databases: string[];
    error: string | null;
  }>({
    isOpen: false,
    sourceIndex: -1,
    isLoading: false,
    databases: [],
    error: null,
  });
  const [testingDbConnectionIndex, setTestingDbConnectionIndex] = useState<number | null>(null);

  // Check if form has unsaved changes
  const hasUnsavedChanges = () => {
    return formData.name.trim() || formData.sources.length > 0 || formData.repositories.length > 0;
  };

  // Handle close with auto-save option
  const handleClose = () => {
    if (mode === 'template' && hasUnsavedChanges() && !editBackup) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  // Save as draft and close
  const saveAsDraftAndClose = async () => {
    setIsSavingDraft(true);
    try {
      const { name, description, ...config } = {
        name: formData.name || 'Untitled Template',
        description: formData.description,
        ...formData
      };

      await templatesAPI.createTemplate({
        name,
        description: description || 'Auto-saved draft',
        config,
      });

      toast.success('Template saved as draft');
      onClose();
    } catch (error) {
      console.error('Failed to save draft:', error);
      toast.error('Failed to save draft');
    } finally {
      setIsSavingDraft(false);
      setShowCloseConfirm(false);
    }
  };

  // Validate exclude pattern
  const validatePattern = (pattern: string): string | null => {
    if (!pattern.trim()) return null;

    // Check for valid pattern formats
    const validPatterns = [
      /^[*?[\]]+.*$/, // Glob patterns with *, ?, []
      /^\/.*/, // Absolute paths
      /^\.\/.*/, // Relative paths
      /^[A-Za-z0-9_\-./]+$/, // Simple paths
      /^sh:.*/, // Shell patterns
      /^re:.*/, // Regex patterns
      /^pf:.*/, // Path full match
      /^pp:.*/, // Path prefix
    ];

    // Must match at least one valid pattern
    if (!validPatterns.some(regex => regex.test(pattern))) {
      return 'Invalid pattern format';
    }

    return null;
  };

  // Create/update backup/template mutation
  const createBackupMutation = useMutation({
    mutationFn: (data: any) => {
      // Determine which API to use based on mode
      if (mode === 'template') {
        // Saving as template - need to wrap in template format
        const { name, description, ...config } = data;
        const templateData = {
          name,
          description: description || '',
          config, // All other fields go into config
        };
        return editBackup
          ? templatesAPI.updateTemplate(editBackup.id, templateData)
          : templatesAPI.createTemplate(templateData);
      } else {
        // Saving as production backup (mode === 'production' or 'from-template')
        return editBackup
          ? backupsAPI.updateBackup(editBackup.id, data)
          : backupsAPI.createBackup(data);
      }
    },
    onSuccess: (response: any) => {
      const data = response.data?.data || response.data;

      // Templates don't have validation status, only backups do
      if (mode === 'template') {
        setValidationResult({ status: 'valid', error: null });
        const successMessage = editBackup
          ? 'Template updated successfully'
          : 'Template created successfully';
        toast.success(successMessage);
        setTimeout(() => onSuccess(), 500);
      } else {
        // For backups, check validation status
        const backup = data.template || data; // Handle response structure
        const nameChangedFrom = backup?.name_changed_from;
        if (nameChangedFrom && backup?.name && nameChangedFrom !== backup.name) {
          toast(`Backup name "${nameChangedFrom}" was already in use — saved as "${backup.name}".`, { icon: 'ℹ️' } as any);
        }
        if (backup.validation_status === 'invalid') {
          setValidationResult({
            status: 'invalid',
            error: backup.validation_error || 'Configuration validation failed'
          });
          toast.error('Saved but has validation errors. Please review and fix.');
          setIsSubmitting(false);
        } else {
          setValidationResult({ status: 'valid', error: null });
          const successMessage = editBackup
            ? 'Backup updated and validated successfully'
            : 'Backup created and validated successfully';
          toast.success(successMessage);
          setTimeout(() => onSuccess(), 500);
        }
      }
    },
    onError: (error: any) => {
      setValidationResult({
        status: 'invalid',
        error: error.response?.data?.error || 'Failed to save'
      });
      toast.error(error.response?.data?.error || 'Failed to save');
      setIsSubmitting(false);
    },
  });

  // Fetch repositories (using fast endpoint - no borg info)
  const { data: repositoriesData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repositories-fast'],
    queryFn: () => repositoriesAPI.getRepositoriesFast().then((res) => res.data),
  });

  // Filter out read-only repositories (they cannot be used for backups)
  const availableRepositories = (repositoriesData?.data?.repositories || []).filter(
    (repo: any) => !repo.read_only
  );

  // Fetch SSH keys (for template mode)
  const { data: sshKeysData } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: () => sshKeysAPI.getSSHKeys().then((res) => res.data),
  });

  const availableSSHKeys = sshKeysData?.data?.keys || [];

  // Fetch retention profiles
  const { data: retentionData } = useQuery({
    queryKey: ['retention-profiles'],
    queryFn: () => backupsAPI.getRetentionProfiles().then((res) => res.data),
  });

  const retentionProfiles = retentionData?.data?.all || [];

  // Create retention profile mutation
  const createRetentionMutation = useMutation({
    mutationFn: (data: any) => backupsAPI.createRetentionProfile(data),
    onSuccess: (response: any) => {
      const newProfile = response.data?.data;
      toast.success('Custom retention profile created successfully');
      setShowRetentionModal(false);
      // Select the newly created profile
      setFormData({ ...formData, retention_profile_id: newProfile.id });
      // Invalidate and refetch retention profiles
      queryClient.invalidateQueries(['retention-profiles']);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to create retention profile');
    },
  });

  // Fetch schedules
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => scheduleAPI.getSchedules().then((res) => res.data),
  });

  const schedules = schedulesData?.data?.schedules || [];

  // Fetch available scripts from library
  const { data: scriptsData } = useQuery({
    queryKey: ['scripts'],
    queryFn: () => scriptsAPI.getAll().then((res) => res.data),
  });

  const availableScripts = scriptsData?.data?.scripts || [];

  // Load rclone remotes for sync feature
  const loadRcloneRemotes = async () => {
    setLoadingRcloneRemotes(true);
    try {
      const response = await repositoriesAPI.rcloneListRemotes();
      if (response.data.success && response.data.remotes) {
        setRcloneRemotes(response.data.remotes);
      }
    } catch (error) {
      console.error('Failed to load rclone remotes:', error);
    } finally {
      setLoadingRcloneRemotes(false);
    }
  };

  // Generate sync command based on config
  const generateSyncCommand = (): string => {
    if (!syncConfig.enabled) return '';
    
    // Get the first repository path (repositories is an array of objects with .path)
    const firstRepo = formData.repositories[0];
    const repoPath = firstRepo?.path || '{REPOSITORY_PATH}';
    
    // Escape double quotes in paths to prevent command injection
    const escapeForShell = (str: string) => str.replace(/"/g, '\\"');
    
    if (syncConfig.type === 'local') {
      if (!syncConfig.localPath) return '';
      return `rclone sync "${escapeForShell(repoPath)}" "${escapeForShell(syncConfig.localPath)}" --progress`;
    } else {
      if (!syncConfig.rcloneRemote) return '';
      const remotePath = syncConfig.rclonePath 
        ? `${syncConfig.rcloneRemote}:${syncConfig.rclonePath}` 
        : `${syncConfig.rcloneRemote}:`;
      return `rclone sync "${escapeForShell(repoPath)}" "${remotePath}" --progress`;
    }
  };
  
  // Check if sync config is valid (has required destination)
  const isSyncConfigValid = (): boolean => {
    if (!syncConfig.enabled) return true;
    if (syncConfig.type === 'local') {
      return !!syncConfig.localPath.trim();
    } else {
      return !!syncConfig.rcloneRemote.trim();
    }
  };

  // Check if backup has any local folder sources (non-database)
  const hasLocalFolderSources = formData.sources.some(
    (s: any) => s.type === 'local' || !s.type
  );

  const steps = [
    { number: 1, name: 'Basic Settings', icon: FileText },
    { number: 2, name: 'Sources', icon: FolderPlus },
    { number: 3, name: 'Repositories', icon: HardDrive },
    { number: 4, name: 'Retention', icon: Clock },
    { number: 5, name: 'Scripts', icon: Code },
    { number: 6, name: 'Advanced', icon: Settings },
  ];

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.name.trim()) {
        newErrors.name = 'Backup name is required';
      }
    }

    if (step === 2) {
      if (formData.sources.length === 0) {
        newErrors.sources = 'At least one source is required';
      }
    }

    if (step === 3) {
      if (formData.repositories.length === 0) {
        newErrors.repositories = 'At least one repository is required';
      }
    }

    if (step === 4) {
      if (!formData.retention_profile_id) {
        newErrors.retention = 'Please select a retention profile';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(Math.min(currentStep + 1, steps.length));
    }
  };

  const handlePrevious = () => {
    setCurrentStep(Math.max(currentStep - 1, 1));
  };

  const handleSubmit = async () => {
    // Validate all critical steps before submission
    const allErrors: Record<string, string> = {};

    // Validate name
    if (!formData.name.trim()) {
      allErrors.name = 'Backup name is required';
      toast.error('Please enter a backup name first (Step 1)');
    }

    // Validate sources
    if (formData.sources.length === 0) {
      allErrors.sources = 'At least one source is required';
      toast.error('Please add at least one source before creating the backup');
    }

    // Validate repositories
    if (formData.repositories.length === 0) {
      allErrors.repositories = 'At least one repository is required';
      toast.error('Please select at least one repository before creating the backup');
    }

    // Validate retention
    if (!formData.retention_profile_id) {
      allErrors.retention = 'Please select a retention profile';
    }

    // Validate circular dependency: source path must not be the same as repository path
    const repoPaths = formData.repositories.map(r => r.path);
    for (const source of formData.sources) {
      if (source.type === 'local' && source.path) {
        for (const repoPath of repoPaths) {
          // Normalize paths for comparison
          const normalizedSource = source.path.replace(/\/+$/, ''); // Remove trailing slashes
          const normalizedRepo = repoPath.replace(/\/+$/, '');

          if (normalizedSource === normalizedRepo) {
            allErrors.sources = `❌ Circular dependency detected! Source folder "${source.path}" cannot be the same as repository folder "${repoPath}". This would cause an infinite loop.`;
            toast.error('Source and repository paths must be different!');
            break;
          }

          // Also check if source is inside repository or vice versa
          if (normalizedSource.startsWith(normalizedRepo + '/')) {
            allErrors.sources = `❌ Source folder "${source.path}" is inside repository folder "${repoPath}". This would cause backup loops.`;
            toast.error('Source folder cannot be inside repository folder!');
            break;
          }

          if (normalizedRepo.startsWith(normalizedSource + '/')) {
            allErrors.sources = `❌ Repository folder "${repoPath}" is inside source folder "${source.path}". This would cause backup loops.`;
            toast.error('Repository folder cannot be inside source folder!');
            break;
          }
        }
      }
    }

    // Validate sync configuration if enabled
    if (syncConfig.enabled && !isSyncConfigValid()) {
      allErrors.sync = 'Sync destination is required when sync is enabled';
      toast.error('Please configure a sync destination or disable sync');
    }

    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      return;
    }

    // Also validate current step
    if (!validateStep(currentStep)) {
      return;
    }

    setIsSubmitting(true);
    setValidationResult({ status: 'validating', error: null });

    try {
      // Initialize canary file hash if enabled and path exists
      if (formData.canary_file_enabled && formData.canary_file_path) {
        try {
          await backupsAPI.initCanaryHash(formData.canary_file_path);
          console.log('✅ Canary file hash initialized');
        } catch (canaryError: any) {
          // Only warn, don't block backup creation
          console.warn('Could not initialize canary hash:', canaryError.message);
          toast.error(`Warning: Could not verify canary file: ${canaryError.response?.data?.error || canaryError.message}. The backup will still be created.`);
        }
      }

      // Prepare the data for API submission
      const submitData = {
        name: formData.name,
        description: formData.description,
        schedule_id: formData.schedule_id,
        is_active: formData.schedule_id ? true : false, // Only active if schedule is set
        sources: formData.sources,
        repositories: formData.repositories,
        retention_profile_id: formData.retention_profile_id,
        exclude_patterns: formData.exclude_patterns.filter(p => p.trim()),
        exclude_caches: formData.exclude_caches,
        upload_rate_limit: formData.upload_rate_limit,
        archive_name_format: formData.archive_name_format,
        check_frequency: formData.check_frequency,
        log_file: formData.log_file,
        log_level: formData.log_level,
        hooks: {
          before_backup: formData.hooks.before_backup.filter((h: string) => h.trim()),
          after_backup: [
            ...formData.hooks.after_backup.filter((h: string) => h.trim()),
            // Add sync command if enabled
            ...(syncConfig.enabled && generateSyncCommand() ? [generateSyncCommand()] : []),
          ],
          on_error: formData.hooks.on_error.filter((h: string) => h.trim()),
        },
        // Canary file settings
        canary_file_enabled: formData.canary_file_enabled,
        canary_file_path: formData.canary_file_enabled ? formData.canary_file_path : null,
        // Lock handling
        auto_break_lock: formData.auto_break_lock,
      };

      createBackupMutation.mutate(submitData);
    } catch (error) {
      console.error('Error submitting backup:', error);
      setIsSubmitting(false);
      setValidationResult({ status: 'invalid', error: 'Submission failed' });
    }
  };

  const addSource = (type: 'local' | 'database') => {
    setFormData({
      ...formData,
      sources: [
        ...formData.sources,
        type === 'local'
          ? { type: 'local', path: '' }
          : {
            type: 'postgresql',
            database_name: '',
            hostname: 'localhost',
            port: 5432,
            username: '',
            password: '',
          },
      ],
    });
  };

  const removeSource = (index: number) => {
    setFormData({
      ...formData,
      sources: formData.sources.filter((_, i) => i !== index),
    });
  };

  // Create a canary file with random data at the specified path
  const createCanaryFile = async (filePath: string) => {
    setCanaryFileCreating(true);
    try {
      const response = await backupsAPI.createCanaryFile(filePath);
      if (response.data?.success) {
        toast.success('Canary file created successfully');
        setFormData({ ...formData, canary_file_path: filePath, canary_file_enabled: true });
      } else {
        throw new Error(response.data?.error || 'Failed to create canary file');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || 'Failed to create canary file');
    } finally {
      setCanaryFileCreating(false);
    }
  };

  // Helper to get default port for database type
  const getDefaultPort = (dbType: string): number => {
    switch (dbType) {
      case 'postgresql': return 5432;
      case 'mysql': return 3306;
      case 'mariadb': return 3306;
      case 'mongodb': return 27017;
      case 'mssql': return 1433;
      default: return 5432;
    }
  };

  const updateSource = (index: number, field: string, value: any) => {
    const newSources = [...formData.sources];
    newSources[index] = { ...newSources[index], [field]: value };

    // Auto-update port when database type changes
    if (field === 'type' && value !== 'local' && value !== 'sqlite') {
      newSources[index].port = getDefaultPort(value);
    }

    setFormData({ ...formData, sources: newSources });
  };

  // Browse databases on a server
  const browseDatabases = async (sourceIndex: number) => {
    const source = formData.sources[sourceIndex];
    if (!source || source.type === 'local' || source.type === 'sqlite') {
      toast.error('Database browsing is not available for this source type');
      return;
    }

    setDbBrowserState({
      isOpen: true,
      sourceIndex,
      isLoading: true,
      databases: [],
      error: null,
    });

    try {
      const response = await databaseDiscoveryAPI.listDatabases({
        type: source.type,
        hostname: source.hostname || 'localhost',
        port: source.port || getDefaultPort(source.type),
        username: source.username,
        password: source.password,
        container: source.container,
        instance: source.instance,
        encrypt: source.encrypt,
        trustServerCert: source.trustServerCert,
      });

      if (response.data?.success) {
        setDbBrowserState(prev => ({
          ...prev,
          isLoading: false,
          databases: response.data.data.databases || [],
        }));
      } else {
        throw new Error(response.data?.detail || 'Failed to list databases');
      }
    } catch (error: any) {
      setDbBrowserState(prev => ({
        ...prev,
        isLoading: false,
        error: error.response?.data?.detail || error.message || 'Failed to connect to database server',
      }));
    }
  };

  // Test MSSQL connection for a source row
  const testDatabaseConnection = async (sourceIndex: number) => {
    const source = formData.sources[sourceIndex];
    if (!source || source.type !== 'mssql') {
      toast.error('Test connection is currently available for MSSQL only');
      return;
    }

    setTestingDbConnectionIndex(sourceIndex);
    try {
      const response = await databaseDiscoveryAPI.testConnection({
        type: source.type,
        hostname: source.hostname || 'localhost',
        port: source.port || getDefaultPort(source.type),
        username: source.username,
        password: source.password,
        container: source.container,
        instance: source.instance,
        encrypt: source.encrypt,
        trustServerCert: source.trustServerCert,
      });

      if (response.data?.success && response.data?.data?.connected) {
        toast.success('MSSQL connection successful');
      } else {
        throw new Error(response.data?.detail || 'Connection test failed');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || error.message || 'Failed to connect to MSSQL server');
    } finally {
      setTestingDbConnectionIndex(null);
    }
  };

  // Select database from browser
  const selectDatabaseFromBrowser = (dbName: string) => {
    const { sourceIndex } = dbBrowserState;
    if (sourceIndex >= 0) {
      updateSource(sourceIndex, 'database_name', dbName);
    }
    setDbBrowserState(prev => ({ ...prev, isOpen: false }));
  };

  // Load available Docker networks
  const loadDockerNetworks = async () => {
    setIsLoadingNetworks(true);
    try {
      const response = await databaseDiscoveryAPI.getNetworks();
      const networks = response.data.data?.networks || [];
      setAvailableNetworks(networks);

      // Auto-select networks that borgmatic is connected to
      const connectedNetworks = response.data.data?.connected || [];
      if (connectedNetworks.length > 0) {
        setDiscoveryOptions(prev => ({
          ...prev,
          networks: connectedNetworks
        }));
      }
    } catch (error: any) {
      console.error('Failed to load Docker networks:', error);
      // Fallback to default
      setAvailableNetworks(['borgmatic-db', 'bridge', 'host']);
    } finally {
      setIsLoadingNetworks(false);
    }
  };

  // Open discovery options modal
  const openDiscoveryOptions = async () => {
    setShowDiscoveryOptions(true);
    await loadDockerNetworks();
  };

  // Database auto-discovery functions
  const handleAutoDiscover = async () => {
    setShowDiscoveryOptions(false);
    setIsDiscovering(true);
    try {
      const response = await databaseDiscoveryAPI.scan({
        networks: discoveryOptions.networks,
        includeHost: discoveryOptions.includeHost,
        forceRefresh: true
      });

      const databases = response.data.data?.databases || [];
      setDiscoveredDatabases(databases);
      setShowDiscoveryResults(true);

      // Pre-select all discovered databases
      setSelectedDatabases(databases.map((db: any) => db.id));

      toast.success(`Found ${databases.length} database${databases.length !== 1 ? 's' : ''}`);
    } catch (error: any) {
      console.error('Database discovery failed:', error);
      toast.error(error.response?.data?.detail || 'Failed to discover databases');
    } finally {
      setIsDiscovering(false);
    }
  };

  const toggleDatabaseSelection = (dbId: string) => {
    setSelectedDatabases(prev =>
      prev.includes(dbId)
        ? prev.filter(id => id !== dbId)
        : [...prev, dbId]
    );
  };

  const selectAllDatabases = () => {
    setSelectedDatabases(discoveredDatabases.map(db => db.id));
  };

  const deselectAllDatabases = () => {
    setSelectedDatabases([]);
  };

  const addSelectedDatabases = () => {
    const databasesToAdd = discoveredDatabases
      .filter(db => selectedDatabases.includes(db.id))
      .map(db => {
        // For SQLite, use path instead of hostname
        if (db.type === 'sqlite') {
          return {
            type: 'sqlite',
            database_name: db.database,
            path: db.path,
            label: db.label,
            discovered: true
          };
        }

        // For other databases, use discovered credentials
        return {
          type: db.type,
          database_name: db.database,
          hostname: db.hostname || db.container,
          port: db.port || getDefaultPort(db.type),
          username: db.username || '',
          password: db.password || '',
          label: db.label,
          discovered: true,
          has_credentials: !!(db.username && db.password)
        };
      });

    setFormData({
      ...formData,
      sources: [...formData.sources, ...databasesToAdd]
    });

    setShowDiscoveryResults(false);

    // Show different message based on whether credentials were found
    const withCreds = databasesToAdd.filter((d: any) => d.has_credentials).length;
    const withoutCreds = databasesToAdd.length - withCreds;

    if (withoutCreds > 0 && withCreds > 0) {
      toast.success(`Added ${databasesToAdd.length} database(s). ${withCreds} with credentials, ${withoutCreds} need credentials entered.`);
    } else if (withoutCreds > 0) {
      toast.success(`Added ${databasesToAdd.length} database(s). Please enter credentials manually.`, { duration: 5000 });
    } else {
      toast.success(`Added ${databasesToAdd.length} database(s) with credentials! ✅`);
    }
  };

  const toggleRepository = (repo: any) => {
    const isSelected = formData.repositories.some((r) => r.path === repo.path);
    setFormData({
      ...formData,
      repositories: isSelected
        ? formData.repositories.filter((r) => r.path !== repo.path)
        : [...formData.repositories, { path: repo.path, label: repo.label || repo.name }],
    });
  };

  const addExcludePattern = () => {
    setFormData({
      ...formData,
      exclude_patterns: [...formData.exclude_patterns, ''],
    });
  };

  const removeExcludePattern = (index: number) => {
    setFormData({
      ...formData,
      exclude_patterns: formData.exclude_patterns.filter((_, i) => i !== index),
    });
  };

  const updateExcludePattern = (index: number, value: string) => {
    const newPatterns = [...formData.exclude_patterns];
    newPatterns[index] = value;
    setFormData({ ...formData, exclude_patterns: newPatterns });

    // Validate pattern
    const error = validatePattern(value);
    if (error) {
      setPatternErrors({ ...patternErrors, [index]: error });
    } else {
      const newErrors = { ...patternErrors };
      delete newErrors[index];
      setPatternErrors(newErrors);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-5xl bg-white rounded-lg shadow-xl flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header - Fixed */}
        <div className="flex items-center justify-between border-b pb-4 px-6 pt-5 flex-shrink-0">
          <h3 className="text-2xl font-bold text-gray-900">
            {editBackup ? 'Edit' : 'Create'} {mode === 'template' ? 'Template' : 'Backup'} Configuration
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Steps - Fixed */}
        <div className="mt-6 px-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <React.Fragment key={step.number}>
                <div className="flex flex-col items-center flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (formData.name.trim() || step.number === 1) {
                        setCurrentStep(step.number);
                      } else {
                        toast.error('Please enter a backup name first');
                      }
                    }}
                    className={`flex items-center justify-center w-12 h-12 rounded-full border-2 transition-colors cursor-pointer hover:scale-110 ${step.number === currentStep
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : step.number < currentStep
                        ? 'border-green-600 bg-green-600 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:border-blue-400'
                      } ${!formData.name.trim() && step.number !== 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={!formData.name.trim() && step.number !== 1 ? 'Please enter a name first' : `Go to ${step.name}`}
                  >
                    {step.number < currentStep ? (
                      <Check className="w-6 h-6" />
                    ) : (
                      <step.icon className="w-6 h-6" />
                    )}
                  </button>
                  <span className="mt-2 text-xs font-medium text-gray-700">{step.name}</span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-1 flex-1 mx-2 ${step.number < currentStep ? 'bg-green-600' : 'bg-gray-300'
                      }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {/* Step 1: Basic Settings */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Backup Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                  placeholder="e.g., webapp-daily-backup"
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Optional description for this backup configuration"
                />
              </div>

              {/* Schedule: Show cron input for templates in Director Mode, schedule picker otherwise */}
              {mode === 'template' && operatingMode === 'director' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Schedule (Cron Expression) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.cron_expression}
                    onChange={(e) => setFormData({ ...formData, cron_expression: e.target.value })}
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${errors.cron_expression ? 'border-red-500' : 'border-gray-300'
                      }`}
                    placeholder="0 2 * * *"
                  />
                  {errors.cron_expression && (
                    <p className="mt-1 text-sm text-red-600">{errors.cron_expression}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    Format: minute hour day month weekday
                  </p>
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
                          onClick={() => setFormData({ ...formData, cron_expression: preset.value })}
                          className={`px-2 py-1.5 text-xs rounded border transition-colors text-left ${formData.cron_expression === preset.value
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Schedule (Optional)
                  </label>
                  <select
                    value={formData.schedule_id || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, schedule_id: e.target.value || null })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">No schedule (manual only)</option>
                    {schedules.map((schedule: any) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.name} - {schedule.cron_expression}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    ⚠️ Backups without a schedule will be created as inactive
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Sources */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-medium text-gray-900">Backup Sources</h4>
                <div className="flex space-x-2">
                  <button
                    onClick={() => addSource('local')}
                    className="btn-secondary text-sm flex items-center space-x-1"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Local Directory</span>
                  </button>
                  {/* Hide Auto-Discover button in Director Mode for templates */}
                  {!(mode === 'template' && operatingMode === 'director') && (
                    <button
                      onClick={openDiscoveryOptions}
                      disabled={isDiscovering}
                      className="btn-secondary text-sm flex items-center space-x-1"
                    >
                      {isDiscovering ? (
                        <>
                          <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                          <span>Discovering...</span>
                        </>
                      ) : (
                        <>
                          <Database className="w-4 h-4" />
                          <span>Auto-Discover Databases</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => addSource('database')}
                    className="btn-secondary text-sm flex items-center space-x-1"
                  >
                    <Database className="w-4 h-4" />
                    <span>Add Database Manually</span>
                  </button>
                </div>
              </div>

              {/* Database connection help - show when there are database sources */}
              {formData.sources.some(s => ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite'].includes(s.type)) && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <p className="font-medium text-blue-800 mb-2">Database Connection Options:</p>
                  <ul className="text-blue-700 space-y-1 text-xs">
                    <li><strong>localhost</strong> — Database running in the same container as Borgmatic</li>
                    <li><strong>Container name</strong> (e.g., <code className="bg-blue-100 px-1 rounded">postgres-db</code>) — Database in another Docker container on the same network</li>
                    <li><strong>host.docker.internal</strong> — Database running on your host machine (outside Docker)</li>
                    <li><strong>IP address or hostname</strong> — Remote database server on your network</li>
                  </ul>
                  <p className="text-blue-600 mt-2 text-xs">
                    <strong>Tip:</strong> Use "All" to backup every database on the server, or "Browse" to select specific ones.
                  </p>
                </div>
              )}

              {errors.sources && (
                <div className="flex items-center text-red-600 bg-red-50 p-3 rounded">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {errors.sources}
                </div>
              )}

              <div className="space-y-2">
                {formData.sources.map((source, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
                    {source.type === 'local' ? (
                      /* Local Directory - compact row with folder browser */
                      <div className="flex items-center gap-3">
                        <span className="text-lg flex-shrink-0">📁</span>
                        <div className="flex-1">
                          <PathSelectorField
                            value={source.path || ''}
                            onChange={(value) => updateSource(index, 'path', value)}
                            placeholder="/path/to/backup"
                            selectMode="directories"
                            inputClassName="py-1.5 text-sm"
                          />
                        </div>
                        <button
                          onClick={() => removeSource(index)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : source.type === 'sqlite' ? (
                      /* SQLite - compact row with dropdown and file browser */
                      <div className="flex items-center gap-3">
                        <span className="text-lg flex-shrink-0">🗄️</span>
                        <select
                          value={source.type}
                          onChange={(e) => updateSource(index, 'type', e.target.value)}
                          className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="postgresql">PostgreSQL</option>
                          <option value="mysql">MySQL</option>
                          <option value="mariadb">MariaDB</option>
                          <option value="mongodb">MongoDB</option>
                          <option value="sqlite">SQLite</option>
                          <option value="mssql">MS SQL Server</option>
                        </select>
                        <div className="flex-1">
                          <PathSelectorField
                            value={source.path || ''}
                            onChange={(value) => updateSource(index, 'path', value)}
                            placeholder="/opt/app/data/database.sqlite3"
                            selectMode="both"
                            inputClassName="py-1.5 text-sm"
                          />
                        </div>
                        <button
                          onClick={() => removeSource(index)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      /* Database - compact multi-field row */
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg flex-shrink-0">
                            {source.type === 'postgresql' ? '🐘' : source.type === 'mongodb' ? '🍃' : source.type === 'mssql' ? '🗄️' : '🐬'}
                          </span>
                          <select
                            value={source.type || 'postgresql'}
                            onChange={(e) => updateSource(index, 'type', e.target.value)}
                            className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                          >
                            <option value="postgresql">PostgreSQL</option>
                            <option value="mysql">MySQL</option>
                            <option value="mariadb">MariaDB</option>
                            <option value="mongodb">MongoDB</option>
                            <option value="sqlite">SQLite</option>
                            <option value="mssql">MS SQL Server</option>
                          </select>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={source.database_name || ''}
                              onChange={(e) => updateSource(index, 'database_name', e.target.value)}
                              className={`w-28 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${source.database_name === 'all' ? 'border-purple-400 bg-purple-50' : 'border-gray-300'
                                }`}
                              placeholder="db name"
                            />
                            {source.type !== 'sqlite' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => updateSource(index, 'database_name', 'all')}
                                  className={`px-2 py-1 text-xs rounded border transition-colors ${source.database_name === 'all'
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'
                                    }`}
                                  title="Backup ALL databases on this server"
                                >
                                  All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => browseDatabases(index)}
                                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 transition-colors flex items-center gap-1"
                                  title="Browse databases on this server"
                                >
                                  <List className="w-3 h-3" />
                                  <span>Browse</span>
                                </button>
                                {source.type === 'mssql' && (
                                  <button
                                    type="button"
                                    onClick={() => testDatabaseConnection(index)}
                                    disabled={testingDbConnectionIndex === index}
                                    className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded border border-blue-300 hover:bg-blue-100 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                    title="Test MSSQL connection"
                                  >
                                    {testingDbConnectionIndex === index ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Play className="w-3 h-3" />
                                    )}
                                    <span>Test</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          <span className="text-gray-400 text-xs">@</span>
                          <input
                            type="text"
                            value={source.hostname ?? ''}
                            onChange={(e) => updateSource(index, 'hostname', e.target.value)}
                            className="flex-1 min-w-[100px] px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="localhost"
                          />
                          <span className="text-gray-400 text-xs">:</span>
                          <input
                            type="number"
                            value={source.port || getDefaultPort(source.type)}
                            onChange={(e) => updateSource(index, 'port', parseInt(e.target.value))}
                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <button
                            onClick={() => removeSource(index)}
                            className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 pl-7">
                          <input
                            type="text"
                            value={source.username || ''}
                            onChange={(e) => updateSource(index, 'username', e.target.value)}
                            className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Username"
                          />
                          <input
                            type="password"
                            value={source.password || ''}
                            onChange={(e) => updateSource(index, 'password', e.target.value)}
                            className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Password"
                          />
                          {source.discovered && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                              Auto-discovered
                            </span>
                          )}
                        </div>
                        {/* MSSQL-specific options */}
                        {source.type === 'mssql' && (
                          <div className="flex items-center gap-2 pl-7 mt-2">
                            <input
                              type="text"
                              value={source.instance || ''}
                              onChange={(e) => updateSource(index, 'instance', e.target.value)}
                              className="w-32 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="Instance (optional)"
                              title="Named instance (e.g., SQLEXPRESS)"
                            />
                            <label className="flex items-center gap-1 text-sm text-gray-600">
                              <input
                                type="checkbox"
                                checked={source.trustServerCert || false}
                                onChange={(e) => updateSource(index, 'trustServerCert', e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              Trust Cert
                            </label>
                            <select
                              value={source.encrypt || 'true'}
                              onChange={(e) => updateSource(index, 'encrypt', e.target.value)}
                              className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              title="Connection encryption mode"
                            >
                              <option value="true">Encrypt: Yes</option>
                              <option value="false">Encrypt: No</option>
                              <option value="strict">Encrypt: Strict</option>
                            </select>
                          </div>
                        )}
                        {/* Dump method selector for supported DB types */}
                        {['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(source.type) && (
                          <div className="flex items-center gap-2 pl-7 mt-2">
                            <span className="text-xs text-gray-500">Dump method:</span>
                            <select
                              value={source.dump_method || 'local'}
                              onChange={(e) => updateSource(index, 'dump_method', e.target.value)}
                              className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            >
                              <option value="local">Dump locally, then backup</option>
                              <option value="native">Borgmatic streaming (experimental)</option>
                            </select>
                            <div className="relative group">
                              <AlertCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                <p className="font-semibold mb-1">Dump locally (recommended):</p>
                                <p className="mb-1.5">Runs the database client (e.g. mariadb-dump) to create a dump file first, then backs up that file. Works reliably with all repository types including remote SSH repos.</p>
                                <p className="font-semibold mb-1">Borgmatic streaming (experimental):</p>
                                <p>Uses borgmatic's native FIFO/pipe mechanism to stream the dump directly into the archive without touching disk. Saves disk space for very large databases, but may fail with remote SSH repositories due to a known borgmatic bug with JSON parsing.</p>
                              </div>
                            </div>
                            {source.dump_method === 'native' && (
                              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                experimental
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pl-7 mt-2">
                          {source.database_name === 'all' && (
                            <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                              All databases
                            </span>
                          )}
                          {/* Connection method indicator */}
                          {(source.is_host_database || source.hostname === 'host.docker.internal') && (
                            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded" title="Connects to host system via host.docker.internal">
                              🖥️ host
                            </span>
                          )}
                          {source.type !== 'sqlite' && source.hostname && source.hostname !== 'localhost' && !(source.is_host_database || source.hostname === 'host.docker.internal') && (
                            <span
                              className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded"
                              title="Connects over network (docker network for containers, or normal network for remote hosts). Dumps run inside the borgmatic container."
                            >
                              🔗 network
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {formData.sources.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <FolderPlus className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No sources added yet. Click the buttons above to add sources.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Repositories */}
          {currentStep === 3 && (
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
                /* Template Mode: Path Pattern Input */
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Repository Name
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Path Pattern
                        </label>
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
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Encryption
                          </label>
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
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Repository Type
                          </label>
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

                      {/* SSH Key Selector - Show for SSH/SFTP types */}
                      {(repo.repository_type === 'ssh' || repo.repository_type === 'sftp') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            SSH Key {repo.repository_type === 'ssh' || repo.repository_type === 'sftp' ? <span className="text-red-500">*</span> : ''}
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
              ) : (
                /* Production Mode: Select from Existing Repositories */
                <>
                  {/* Repository grid - only show when loaded and has repositories */}
                  {!isLoadingRepos && availableRepositories.length > 0 && (
                    <div className="max-h-[400px] overflow-y-auto pr-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {availableRepositories.map((repo: any) => {
                          const isSelected = formData.repositories.some((r) => r.path === repo.path);
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
                                    <span className="bg-gray-100 px-2 py-0.5 rounded">
                                      {repo.encryption}
                                    </span>
                                    <span className="bg-gray-100 px-2 py-0.5 rounded">
                                      {repo.compression}
                                    </span>
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

                  {/* Loading spinner while fetching repositories */}
                  {isLoadingRepos && (
                    <div className="text-center py-8 text-gray-500">
                      <Loader2 className="w-12 h-12 mx-auto mb-2 text-blue-500 animate-spin" />
                      <p>Loading repositories...</p>
                    </div>
                  )}

                  {/* Show empty state only when done loading and no repos */}
                  {!isLoadingRepos && availableRepositories.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <HardDrive className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p>No repositories available. Please create a repository first.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 4: Retention */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">
                    Retention Policy
                  </h4>
                  <p className="text-sm text-gray-500">
                    Choose how long to keep backup archives
                  </p>
                </div>
                <button
                  onClick={() => {
                    setCustomRetention({
                      name: '',
                      description: '',
                      keep_hourly: 0,
                      keep_daily: 7,
                      keep_weekly: 4,
                      keep_monthly: 6,
                      keep_yearly: 1,
                    });
                    setShowRetentionModal(true);
                  }}
                  className="btn-secondary text-sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Custom
                </button>
              </div>

              {errors.retention && (
                <div className="flex items-center text-red-600 bg-red-50 p-3 rounded">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {errors.retention}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {retentionProfiles.map((profile: any) => {
                  const isSelected = formData.retention_profile_id === profile.id;
                  return (
                    <div
                      key={profile.id}
                      onClick={() =>
                        setFormData({ ...formData, retention_profile_id: profile.id })
                      }
                      className={`border-2 rounded-lg p-6 cursor-pointer transition-all ${isSelected
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                        }`}
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
          {currentStep === 5 && (
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
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Play className="w-5 h-5 text-blue-600" />
                  <h5 className="font-medium text-gray-900">Before Backup</h5>
                  <span className="text-xs text-gray-500">Runs before the backup starts</span>
                </div>

                {/* List of added hooks */}
                {formData.hooks.before_backup.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {formData.hooks.before_backup.map((hook: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
                        <Code className="w-4 h-4 text-gray-400" />
                        <code className="flex-1 text-sm text-gray-700 truncate">{hook}</code>
                        <button
                          type="button"
                          onClick={() => {
                            const newHooks = [...formData.hooks.before_backup];
                            newHooks.splice(index, 1);
                            setFormData({ ...formData, hooks: { ...formData.hooks, before_backup: newHooks } });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add from library or custom */}
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const script = availableScripts.find((s: any) => s.id === e.target.value);
                        if (script) {
                          setFormData({
                            ...formData,
                            hooks: {
                              ...formData.hooks,
                              before_backup: [...formData.hooks.before_backup, script.script]
                            }
                          });
                        }
                      }
                    }}
                  >
                    <option value="">Select from library...</option>
                    {availableScripts
                      .filter((s: any) => s.hook_type === 'before_backup')
                      .map((script: any) => (
                        <option key={script.id} value={script.id}>{script.name}</option>
                      ))
                    }
                  </select>
                  <span className="text-gray-400 self-center">or</span>
                  <input
                    type="text"
                    value={customHookInput.before_backup}
                    onChange={(e) => setCustomHookInput({ ...customHookInput, before_backup: e.target.value })}
                    placeholder="Custom command..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customHookInput.before_backup.trim()) {
                        setFormData({
                          ...formData,
                          hooks: {
                            ...formData.hooks,
                            before_backup: [...formData.hooks.before_backup, customHookInput.before_backup.trim()]
                          }
                        });
                        setCustomHookInput({ ...customHookInput, before_backup: '' });
                      }
                    }}
                    disabled={!customHookInput.before_backup.trim()}
                    className="btn-secondary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* After Backup Scripts */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <h5 className="font-medium text-gray-900">After Backup</h5>
                  <span className="text-xs text-gray-500">Runs after successful backup</span>
                </div>

                {/* List of added hooks */}
                {formData.hooks.after_backup.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {formData.hooks.after_backup.map((hook: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
                        <Code className="w-4 h-4 text-gray-400" />
                        <code className="flex-1 text-sm text-gray-700 truncate">{hook}</code>
                        <button
                          type="button"
                          onClick={() => {
                            const newHooks = [...formData.hooks.after_backup];
                            newHooks.splice(index, 1);
                            setFormData({ ...formData, hooks: { ...formData.hooks, after_backup: newHooks } });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add from library or custom */}
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const script = availableScripts.find((s: any) => s.id === e.target.value);
                        if (script) {
                          setFormData({
                            ...formData,
                            hooks: {
                              ...formData.hooks,
                              after_backup: [...formData.hooks.after_backup, script.script]
                            }
                          });
                        }
                      }
                    }}
                  >
                    <option value="">Select from library...</option>
                    {availableScripts
                      .filter((s: any) => s.hook_type === 'after_backup')
                      .map((script: any) => (
                        <option key={script.id} value={script.id}>{script.name}</option>
                      ))
                    }
                  </select>
                  <span className="text-gray-400 self-center">or</span>
                  <input
                    type="text"
                    value={customHookInput.after_backup}
                    onChange={(e) => setCustomHookInput({ ...customHookInput, after_backup: e.target.value })}
                    placeholder="Custom command..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customHookInput.after_backup.trim()) {
                        setFormData({
                          ...formData,
                          hooks: {
                            ...formData.hooks,
                            after_backup: [...formData.hooks.after_backup, customHookInput.after_backup.trim()]
                          }
                        });
                        setCustomHookInput({ ...customHookInput, after_backup: '' });
                      }
                    }}
                    disabled={!customHookInput.after_backup.trim()}
                    className="btn-secondary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

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
                              {loadingRcloneRemotes ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <RefreshCw className="w-4 h-4" />
                              )}
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
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <h5 className="font-medium text-gray-900">On Error</h5>
                  <span className="text-xs text-gray-500">Runs if backup fails</span>
                </div>

                {/* List of added hooks */}
                {formData.hooks.on_error.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {formData.hooks.on_error.map((hook: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
                        <Code className="w-4 h-4 text-gray-400" />
                        <code className="flex-1 text-sm text-gray-700 truncate">{hook}</code>
                        <button
                          type="button"
                          onClick={() => {
                            const newHooks = [...formData.hooks.on_error];
                            newHooks.splice(index, 1);
                            setFormData({ ...formData, hooks: { ...formData.hooks, on_error: newHooks } });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add from library or custom */}
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const script = availableScripts.find((s: any) => s.id === e.target.value);
                        if (script) {
                          setFormData({
                            ...formData,
                            hooks: {
                              ...formData.hooks,
                              on_error: [...formData.hooks.on_error, script.script]
                            }
                          });
                        }
                      }
                    }}
                  >
                    <option value="">Select from library...</option>
                    {availableScripts
                      .filter((s: any) => s.hook_type === 'on_error')
                      .map((script: any) => (
                        <option key={script.id} value={script.id}>{script.name}</option>
                      ))
                    }
                  </select>
                  <span className="text-gray-400 self-center">or</span>
                  <input
                    type="text"
                    value={customHookInput.on_error}
                    onChange={(e) => setCustomHookInput({ ...customHookInput, on_error: e.target.value })}
                    placeholder="Custom command..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customHookInput.on_error.trim()) {
                        setFormData({
                          ...formData,
                          hooks: {
                            ...formData.hooks,
                            on_error: [...formData.hooks.on_error, customHookInput.on_error.trim()]
                          }
                        });
                        setCustomHookInput({ ...customHookInput, on_error: '' });
                      }
                    }}
                    disabled={!customHookInput.on_error.trim()}
                    className="btn-secondary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Skip info */}
              {formData.hooks.before_backup.length === 0 &&
                formData.hooks.after_backup.length === 0 &&
                formData.hooks.on_error.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No scripts configured. You can skip this step if you don't need custom automation.
                  </div>
                )}
            </div>
          )}

          {/* Step 6: Advanced */}
          {currentStep === 6 && (
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
                      placeholder="{hostname}-{now}"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Variables: <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{'{hostname}'}</code>,{' '}
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

                  {/* Ransomware Detection (Canary File) - only show if there are folder sources */}
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

                          {/* Auto-create canary file button */}
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
                    {formData.exclude_patterns.map((pattern, index) => (
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
          )}
        </div>

        {/* Validation Result */}
        {validationResult.status && (
          <div className="mt-4">
            {validationResult.status === 'validating' && (
              <div className="flex items-center p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                <div>
                  <h4 className="text-sm font-medium text-blue-800">Validating Configuration...</h4>
                  <p className="text-xs text-blue-600 mt-1">
                    Running borgmatic validation checks
                  </p>
                </div>
              </div>
            )}

            {validationResult.status === 'valid' && (
              <div className="flex items-start p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-green-800">✅ Configuration Valid</h4>
                  <p className="text-xs text-green-600 mt-1">
                    Backup configuration passed all borgmatic validation checks
                  </p>
                </div>
              </div>
            )}

            {validationResult.status === 'invalid' && (
              <div className="flex items-start p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="ml-3 flex-1">
                  <h4 className="text-sm font-medium text-red-800">❌ Validation Failed</h4>
                  <p className="text-xs text-red-700 mt-1 font-mono whitespace-pre-wrap">
                    {validationResult.error}
                  </p>
                  <p className="text-xs text-red-600 mt-2">
                    The backup was saved but marked as inactive. Please fix the errors and try again.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer - Fixed */}
        <div className="flex items-center justify-between border-t pt-4 pb-5 px-6 flex-shrink-0 bg-gray-50">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 1 || isSubmitting}
            className="btn-secondary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          <div className="flex items-center space-x-3">
            {validationResult.status === 'invalid' && (
              <button
                onClick={onClose}
                className="btn-secondary"
              >
                Close & Review
              </button>
            )}

            {/* Save button - always available when editing */}
            {editBackup && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !formData.name.trim()}
                className="btn-primary flex items-center space-x-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!formData.name.trim() ? 'Please enter a backup name first' : ''}
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>{validationResult.status === 'validating' ? 'Validating...' : 'Saving...'}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            )}

            {/* Next/Create button */}
            {currentStep < steps.length ? (
              <button
                onClick={handleNext}
                disabled={isSubmitting || (currentStep === 1 && !formData.name.trim())}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={currentStep === 1 && !formData.name.trim() ? 'Please enter a backup name first' : ''}
              >
                <span>Next</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : !editBackup && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !formData.name.trim()}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!formData.name.trim() ? 'Please enter a backup name first (Step 1)' : ''}
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>{validationResult.status === 'validating' ? 'Validating...' : 'Creating...'}</span>
                  </>
                ) : validationResult.status === 'invalid' ? (
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

      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Save Template as Draft?</h3>
            <p className="text-sm text-gray-600 mb-6">
              You have unsaved changes. Would you like to save this template as a draft so you can continue editing it later?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowCloseConfirm(false);
                  onClose();
                }}
                className="btn-secondary flex-1"
              >
                Discard Changes
              </button>
              <button
                onClick={saveAsDraftAndClose}
                disabled={isSavingDraft}
                className="btn-primary flex-1"
              >
                {isSavingDraft ? 'Saving...' : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Database Discovery Options Modal */}
      {showDiscoveryOptions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Database Discovery Options</h3>
              <button
                onClick={() => setShowDiscoveryOptions(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Host System Checkbox */}
              <label className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={discoveryOptions.includeHost}
                  onChange={(e) => setDiscoveryOptions(prev => ({ ...prev, includeHost: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="font-medium text-gray-900">Include Host System</span>
                  <p className="text-sm text-gray-500">Scan for databases running directly on the host</p>
                </div>
              </label>

              {/* Docker Networks */}
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">Docker Networks</span>
                  {isLoadingNetworks && (
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-3">Select networks to scan for database containers</p>

                {availableNetworks.length === 0 && !isLoadingNetworks ? (
                  <p className="text-sm text-gray-400 italic">No Docker networks found. Is Docker running?</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableNetworks.map((network) => (
                      <label key={network} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={discoveryOptions.networks.includes(network)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDiscoveryOptions(prev => ({
                                ...prev,
                                networks: [...prev.networks, network]
                              }));
                            } else {
                              setDiscoveryOptions(prev => ({
                                ...prev,
                                networks: prev.networks.filter(n => n !== network)
                              }));
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{network}</span>
                        {network === 'borgmatic-db' && (
                          <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">recommended</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowDiscoveryOptions(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAutoDiscover}
                disabled={!discoveryOptions.includeHost && discoveryOptions.networks.length === 0}
                className="btn-primary flex items-center space-x-2"
              >
                <Database className="w-4 h-4" />
                <span>Scan for Databases</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Database Discovery Results Modal */}
      {showDiscoveryResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Discovered Databases</h3>
              <button
                onClick={() => setShowDiscoveryResults(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {discoveredDatabases.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No database containers found.</p>
                <p className="text-sm text-gray-500 mt-2">
                  Make sure your database containers (MariaDB, PostgreSQL, MongoDB) are running.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600">
                      Found {discoveredDatabases.length} database{discoveredDatabases.length !== 1 ? 's' : ''}. Select which ones to add:
                    </p>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
                      <p className="text-xs text-blue-800 font-medium mb-1">Connection Methods:</p>
                      <div className="flex flex-wrap gap-3 text-xs text-blue-700">
                        <span><span className="font-medium">🐳 docker network</span> - Connect to DB container over borgmatic-db (dump runs in borgmatic container)</span>
                        <span><span className="font-medium">🖥️ host</span> - Connect to host DB via host.docker.internal</span>
                        <span><span className="font-medium">📁 file</span> - SQLite file backup</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2 shrink-0">
                    <button
                      onClick={selectAllDatabases}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Select All
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={deselectAllDatabases}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                <div className="overflow-auto flex-1 border rounded-lg">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Select
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Container
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Database
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Connection
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Credentials
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {discoveredDatabases.map((db) => (
                        <tr key={db.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedDatabases.includes(db.id)}
                              onChange={() => toggleDatabaseSelection(db.id)}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              {db.type === 'mariadb' && <span className="text-xl">🐬</span>}
                              {db.type === 'mysql' && <span className="text-xl">🐬</span>}
                              {db.type === 'postgresql' && <span className="text-xl">🐘</span>}
                              {db.type === 'sqlite' && <span className="text-xl">🗄️</span>}
                              {db.type === 'mongodb' && <span className="text-xl">🍃</span>}
                              <span className="text-sm font-medium text-gray-900 capitalize">{db.type}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">{db.container}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{db.database}</td>
                          <td className="px-4 py-3">
                            {db.type === 'sqlite' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                📁 File
                              </span>
                            ) : db.container ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title={`docker network (${db.container} on borgmatic-db)`}>
                                🐳 docker network
                              </span>
                            ) : db.is_host_database ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800" title="host.docker.internal">
                                🖥️ host
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                🔗 network
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {db.type === 'sqlite' ? (
                              <span className="text-xs text-gray-400">N/A</span>
                            ) : db.username && db.password ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                ✓ Found
                              </span>
                            ) : db.username ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                User only
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                Manual entry
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowDiscoveryResults(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addSelectedDatabases}
                    disabled={selectedDatabases.length === 0}
                    className="btn-primary"
                  >
                    Add {selectedDatabases.length > 0 ? `${selectedDatabases.length} ` : ''}Database{selectedDatabases.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Database Browser Modal */}
      {dbBrowserState.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Select Database</h3>
              <button
                onClick={() => setDbBrowserState(prev => ({ ...prev, isOpen: false }))}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {dbBrowserState.isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600">Connecting to database server...</p>
              </div>
            ) : dbBrowserState.error ? (
              <div className="py-8">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-700 text-sm">{dbBrowserState.error}</p>
                </div>
                <p className="text-gray-600 text-sm">
                  Make sure the database server is running and the credentials are correct.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Select a database from the server. Choose <strong>"all"</strong> to backup all databases.
                </p>
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  {dbBrowserState.databases.map((dbName) => (
                    <button
                      key={dbName}
                      onClick={() => selectDatabaseFromBrowser(dbName)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 transition-colors flex items-center justify-between ${dbName === 'all' ? 'bg-purple-50 hover:bg-purple-100' : ''
                        }`}
                    >
                      <span className={`font-medium ${dbName === 'all' ? 'text-purple-700' : 'text-gray-900'}`}>
                        {dbName}
                      </span>
                      {dbName === 'all' && (
                        <span className="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded">
                          All DBs
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {dbBrowserState.databases.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Database className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No databases found</p>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setDbBrowserState(prev => ({ ...prev, isOpen: false }))}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Retention Profile Modal */}
      {showRetentionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Create Custom Retention Profile</h3>
              <button
                onClick={() => setShowRetentionModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Profile Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customRetention.name}
                  onChange={(e) => setCustomRetention({ ...customRetention, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="My Custom Policy"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={customRetention.description}
                  onChange={(e) => setCustomRetention({ ...customRetention, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Optional description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Keep Hourly (0 to disable)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={customRetention.keep_hourly}
                    onChange={(e) => setCustomRetention({ ...customRetention, keep_hourly: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Keep Daily
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={customRetention.keep_daily}
                    onChange={(e) => setCustomRetention({ ...customRetention, keep_daily: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Keep Weekly
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={customRetention.keep_weekly}
                    onChange={(e) => setCustomRetention({ ...customRetention, keep_weekly: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Keep Monthly
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={customRetention.keep_monthly}
                    onChange={(e) => setCustomRetention({ ...customRetention, keep_monthly: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Keep Yearly
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={customRetention.keep_yearly}
                    onChange={(e) => setCustomRetention({ ...customRetention, keep_yearly: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Tip:</strong> Set a value to 0 to disable that retention period. At least one period should have a non-zero value.
                </p>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowRetentionModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!customRetention.name.trim()) {
                    toast.error('Profile name is required');
                    return;
                  }
                  const hasAnyRetention = customRetention.keep_hourly > 0 || customRetention.keep_daily > 0 ||
                    customRetention.keep_weekly > 0 || customRetention.keep_monthly > 0 || customRetention.keep_yearly > 0;
                  if (!hasAnyRetention) {
                    toast.error('At least one retention period must be greater than 0');
                    return;
                  }
                  createRetentionMutation.mutate(customRetention);
                }}
                disabled={createRetentionMutation.isLoading}
                className="btn-primary"
              >
                {createRetentionMutation.isLoading ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupWizard;
