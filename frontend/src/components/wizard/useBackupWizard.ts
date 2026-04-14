import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  FileText,
  HardDrive,
  Clock,
  FolderPlus,
  Code,
  Settings,
} from 'lucide-react';
import { repositoriesAPI, backupsAPI, scheduleAPI, templatesAPI, sshKeysAPI, databaseDiscoveryAPI, identityAPI, scriptsAPI } from '../../services/api';
import { toast } from 'react-hot-toast';

type WizardMode = 'production' | 'template' | 'from-template';

interface UseBackupWizardParams {
  onClose: () => void;
  onSuccess: () => void;
  editBackup?: any;
  mode?: WizardMode;
  templateData?: any;
}

const shellSingleQuote = (str: string) => `'${String(str).replace(/'/g, `'\"'\"'`)}'`;

export const buildSyncCommand = (
  syncConfig: { enabled: boolean; type: 'local' | 'rclone'; localPath: string; rcloneRemote: string; rclonePath: string },
  repositories: Array<{ path?: string }>
): string => {
  if (!syncConfig.enabled) return '';
  const firstRepo = repositories?.[0];
  const repoPath = firstRepo?.path || '{REPOSITORY_PATH}';
  if (syncConfig.type === 'local') {
    if (!syncConfig.localPath) return '';
    return `rclone sync ${shellSingleQuote(repoPath)} ${shellSingleQuote(syncConfig.localPath)} --progress`;
  }
  if (!syncConfig.rcloneRemote) return '';
  const remotePath = syncConfig.rclonePath
    ? `${syncConfig.rcloneRemote}:${syncConfig.rclonePath}`
    : `${syncConfig.rcloneRemote}:`;
  return `rclone sync ${shellSingleQuote(repoPath)} ${shellSingleQuote(remotePath)} --progress`;
};

export const enforceAwsIamTransport = (source: any) => {
  if (!source || source.auth_method !== 'aws_iam') return source;
  if (source.type === 'postgresql') {
    const sslMode = source.ssl_mode;
    if (!sslMode || sslMode === 'disable') {
      return { ...source, ssl_mode: 'require' };
    }
    return source;
  }
  if (source.type === 'mysql' || source.type === 'mariadb') {
    return { ...source, tls: true };
  }
  return source;
};

export function useBackupWizard({ onClose, onSuccess, editBackup, mode = 'production', templateData }: UseBackupWizardParams) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [operatingMode, setOperatingMode] = useState<string>('standalone');

  const DB_TYPES = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'mssql'];

  const initialData = editBackup || templateData || {};
  const isEditingTemplate = editBackup && mode === 'template';
  const dataSource = isEditingTemplate ? initialData?.config || {} : initialData;

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    schedule_id: dataSource?.schedule_id || null,
    cron_expression: dataSource?.cron_expression || '0 2 * * *',
    sources: dataSource?.sources ||
      initialData?.sources_summary ||
      initialData?.config?.location?.source_directories?.map((dir: string) => ({
        type: 'local',
        path: dir,
      })) || [],
    repositories: dataSource?.repositories || initialData?.repositories_summary || [],
    retention_profile_id: dataSource?.retention_profile_id || 'profile-standard',
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
    canary_file_enabled: dataSource?.canary_file_enabled || false,
    canary_file_path: dataSource?.canary_file_path || '',
    auto_break_lock: dataSource?.auto_break_lock || false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [patternErrors, setPatternErrors] = useState<Record<number, string>>({});
  const [canaryFileCreating, setCanaryFileCreating] = useState(false);
  const [customHookInput, setCustomHookInput] = useState({ before_backup: '', after_backup: '', on_error: '' });

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

  const [gitDiscoveredReposBySource, setGitDiscoveredReposBySource] = useState<Record<number, {id: string; group: string; name: string}[]>>({});
  const [gitSelectedReposBySource, setGitSelectedReposBySource] = useState<Record<number, string[]>>({});
  const [isDiscoveringGitReposBySource, setIsDiscoveringGitReposBySource] = useState<Record<number, boolean>>({});
  const [showGitRepoResultsBySource, setShowGitRepoResultsBySource] = useState<Record<number, boolean>>({});
  const [gitTestResultBySource, setGitTestResultBySource] = useState<Record<number, { success: boolean; message: string }>>({});
  const [isTestingGitConnectionBySource, setIsTestingGitConnectionBySource] = useState<Record<number, boolean>>({});
  const [showGitPat, setShowGitPat] = useState<Record<number, boolean>>({});

  const [dbHelpExpanded, setDbHelpExpanded] = useState(true);
  const [gitHelpExpanded, setGitHelpExpanded] = useState(true);
  const [helpAutoCollapsed, setHelpAutoCollapsed] = useState(false);

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
  const [mssqlToolCheck, setMssqlToolCheck] = useState<{ checked: boolean; ok: boolean; errors: string[] }>({ checked: false, ok: true, errors: [] });
  const [awsToolCheck, setAwsToolCheck] = useState<{ checked: boolean; ok: boolean; errors: string[] }>({ checked: false, ok: true, errors: [] });
  const [commercialFeatures, setCommercialFeatures] = useState<string[]>([]);

  // ── Tool checks ──

  const checkMssqlTools = async () => {
    try {
      const res = await databaseDiscoveryAPI.checkTools('mssql');
      const data = res.data?.data;
      if (data) {
        setMssqlToolCheck({ checked: true, ok: data.ok, errors: data.errors || [] });
      }
    } catch {
      // Best-effort check
    }
  };

  const checkAwsTools = async () => {
    try {
      const res = await databaseDiscoveryAPI.checkTools('aws');
      const data = res.data?.data;
      if (data) {
        setAwsToolCheck({ checked: true, ok: data.ok, errors: data.errors || [] });
      }
    } catch {
      // Best-effort check
    }
  };

  // ── Effects ──

  useEffect(() => {
    const fetchMode = async () => {
      try {
        const response = await identityAPI.getStatus();
        setOperatingMode(response.data.data.mode);
        if (response.data.data.features) {
          setCommercialFeatures(response.data.data.features);
        }
      } catch (error) {
        console.error('Failed to fetch mode:', error);
      }
    };
    fetchMode();

    const sources = editBackup?.sources_summary || editBackup?.sources || templateData?.sources || [];
    if (sources.some((s: any) => s.type === 'mssql')) {
      checkMssqlTools();
    }
    if (sources.some((s: any) => s.auth_method === 'aws_iam')) {
      checkAwsTools();
    }
  }, []);

  useEffect(() => {
    const hasLocal = formData.sources.some((s: any) => s.type === 'local');
    const hasDb = formData.sources.some((s: any) => DB_TYPES.includes(s.type));
    const hasGit = formData.sources.some((s: any) => s.type === 'git_repos');
    const groupCount = (hasLocal ? 1 : 0) + (hasDb ? 1 : 0) + (hasGit ? 1 : 0);
    if (groupCount > 1 && !helpAutoCollapsed) {
      setDbHelpExpanded(false);
      setGitHelpExpanded(false);
      setHelpAutoCollapsed(true);
    } else if (groupCount <= 1) {
      setHelpAutoCollapsed(false);
    }
  }, [formData.sources]);

  // ── Close / Draft ──

  const hasUnsavedChanges = () => {
    return formData.name.trim() || formData.sources.length > 0 || formData.repositories.length > 0;
  };

  const handleClose = () => {
    if (mode === 'template' && hasUnsavedChanges() && !editBackup) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

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

  // ── Pattern validation ──

  const validatePattern = (pattern: string): string | null => {
    if (!pattern.trim()) return null;
    const validPatterns = [
      /^[*?[\]]+.*$/,
      /^\/.*/,
      /^\.\/.*/,
      /^[A-Za-z0-9_\-./]+$/,
      /^sh:.*/,
      /^re:.*/,
      /^pf:.*/,
      /^pp:.*/,
    ];
    if (!validPatterns.some(regex => regex.test(pattern))) {
      return 'Invalid pattern format';
    }
    return null;
  };

  // ── Queries ──

  const createBackupMutation = useMutation({
    mutationFn: (data: any) => {
      if (mode === 'template') {
        const { name, description, ...config } = data;
        const tplData = { name, description: description || '', config };
        return editBackup
          ? templatesAPI.updateTemplate(editBackup.id, tplData)
          : templatesAPI.createTemplate(tplData);
      } else {
        return editBackup
          ? backupsAPI.updateBackup(editBackup.id, data)
          : backupsAPI.createBackup(data);
      }
    },
    onSuccess: (response: any) => {
      const data = response.data?.data || response.data;
      if (mode === 'template') {
        setValidationResult({ status: 'valid', error: null });
        toast.success(editBackup ? 'Template updated successfully' : 'Template created successfully');
        setTimeout(() => onSuccess(), 500);
      } else {
        const backup = data.template || data;
        const nameChangedFrom = backup?.name_changed_from;
        if (nameChangedFrom && backup?.name && nameChangedFrom !== backup.name) {
          toast(`Backup name "${nameChangedFrom}" was already in use — saved as "${backup.name}".`, { icon: 'ℹ️' } as any);
        }
        if (backup.validation_status === 'invalid') {
          setValidationResult({ status: 'invalid', error: backup.validation_error || 'Configuration validation failed' });
          toast.error('Saved but has validation errors. Please review and fix.');
          setIsSubmitting(false);
        } else {
          setValidationResult({ status: 'valid', error: null });
          toast.success(editBackup ? 'Backup updated and validated successfully' : 'Backup created and validated successfully');
          setTimeout(() => onSuccess(), 500);
        }
      }
    },
    onError: (error: any) => {
      if (error.response?.status === 402) {
        const detail = error.response.data?.detail || 'This feature requires the Commercial edition.';
        setValidationResult({ status: 'invalid', error: detail });
        toast.error(detail, { duration: 6000 });
      } else {
        setValidationResult({ status: 'invalid', error: error.response?.data?.error || 'Failed to save' });
        toast.error(error.response?.data?.error || 'Failed to save');
      }
      setIsSubmitting(false);
    },
  });

  const { data: repositoriesData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repositories-fast'],
    queryFn: () => repositoriesAPI.getRepositoriesFast().then((res) => res.data),
  });
  const availableRepositories = (repositoriesData?.data?.repositories || []).filter(
    (repo: any) => !repo.read_only
  );

  const { data: sshKeysData } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: () => sshKeysAPI.getSSHKeys().then((res) => res.data),
  });
  const availableSSHKeys = sshKeysData?.data?.keys || [];

  const { data: retentionData } = useQuery({
    queryKey: ['retention-profiles'],
    queryFn: () => backupsAPI.getRetentionProfiles().then((res) => res.data),
  });
  const retentionProfiles = retentionData?.data?.all || [];

  const createRetentionMutation = useMutation({
    mutationFn: (data: any) => backupsAPI.createRetentionProfile(data),
    onSuccess: (response: any) => {
      const newProfile = response.data?.data;
      toast.success('Custom retention profile created successfully');
      setShowRetentionModal(false);
      setFormData({ ...formData, retention_profile_id: newProfile.id });
      queryClient.invalidateQueries(['retention-profiles']);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to create retention profile');
    },
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => scheduleAPI.getSchedules().then((res) => res.data),
  });
  const schedules = schedulesData?.data?.schedules || [];

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts'],
    queryFn: () => scriptsAPI.getAll().then((res) => res.data),
  });
  const availableScripts = scriptsData?.data?.scripts || [];

  // ── Sync helpers ──

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

  const generateSyncCommand = (): string => {
    return buildSyncCommand(syncConfig, formData.repositories);
  };

  const isSyncConfigValid = (): boolean => {
    if (!syncConfig.enabled) return true;
    if (syncConfig.type === 'local') return !!syncConfig.localPath.trim();
    return !!syncConfig.rcloneRemote.trim();
  };

  // ── Computed values ──

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

  // ── Validation & navigation ──

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    if (step === 1 && !formData.name.trim()) newErrors.name = 'Backup name is required';
    if (step === 2 && formData.sources.length === 0) newErrors.sources = 'At least one source is required';
    if (step === 3 && formData.repositories.length === 0) newErrors.repositories = 'At least one repository is required';
    if (step === 4 && !formData.retention_profile_id) newErrors.retention = 'Please select a retention profile';
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
    const allErrors: Record<string, string> = {};
    if (!formData.name.trim()) { allErrors.name = 'Backup name is required'; toast.error('Please enter a backup name first (Step 1)'); }
    if (formData.sources.length === 0) { allErrors.sources = 'At least one source is required'; toast.error('Please add at least one source before creating the backup'); }
    if (formData.repositories.length === 0) { allErrors.repositories = 'At least one repository is required'; toast.error('Please select at least one repository before creating the backup'); }
    if (!formData.retention_profile_id) allErrors.retention = 'Please select a retention profile';

    const repoPaths = formData.repositories.map((r: any) => r.path);
    for (const source of formData.sources) {
      if (source.type === 'local' && source.path) {
        for (const repoPath of repoPaths) {
          const normalizedSource = source.path.replace(/\/+$/, '');
          const normalizedRepo = repoPath.replace(/\/+$/, '');
          if (normalizedSource === normalizedRepo) {
            allErrors.sources = `❌ Circular dependency detected! Source folder "${source.path}" cannot be the same as repository folder "${repoPath}". This would cause an infinite loop.`;
            toast.error('Source and repository paths must be different!');
            break;
          }
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

    if (syncConfig.enabled && !isSyncConfigValid()) {
      allErrors.sync = 'Sync destination is required when sync is enabled';
      toast.error('Please configure a sync destination or disable sync');
    }

    if (Object.keys(allErrors).length > 0) { setErrors(allErrors); return; }
    if (!validateStep(currentStep)) return;

    setIsSubmitting(true);
    setValidationResult({ status: 'validating', error: null });

    try {
      if (formData.canary_file_enabled && formData.canary_file_path) {
        try {
          await backupsAPI.initCanaryHash(formData.canary_file_path);
        } catch (canaryError: any) {
          console.warn('Could not initialize canary hash:', canaryError.message);
          toast.error(`Warning: Could not verify canary file: ${canaryError.response?.data?.error || canaryError.message}. The backup will still be created.`);
        }
      }

      const normalizedSources = formData.sources.map((source: any) => enforceAwsIamTransport(source));
      const submitData = {
        name: formData.name,
        description: formData.description,
        schedule_id: formData.schedule_id,
        is_active: formData.schedule_id ? true : false,
        sources: normalizedSources,
        repositories: formData.repositories,
        retention_profile_id: formData.retention_profile_id,
        exclude_patterns: formData.exclude_patterns.filter((p: string) => p.trim()),
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
            ...(syncConfig.enabled && generateSyncCommand() ? [generateSyncCommand()] : []),
          ],
          on_error: formData.hooks.on_error.filter((h: string) => h.trim()),
        },
        canary_file_enabled: formData.canary_file_enabled,
        canary_file_path: formData.canary_file_enabled ? formData.canary_file_path : null,
        auto_break_lock: formData.auto_break_lock,
      };
      createBackupMutation.mutate(submitData);
    } catch (error) {
      console.error('Error submitting backup:', error);
      setIsSubmitting(false);
      setValidationResult({ status: 'invalid', error: 'Submission failed' });
    }
  };

  // ── Source management ──

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

  const addSource = (type: 'local' | 'database' | 'git_repos') => {
    let newSource: any;
    if (type === 'local') {
      newSource = { type: 'local', path: '' };
    } else if (type === 'git_repos') {
      newSource = {
        type: 'git_repos', platform: 'github', scope: 'organization',
        backup_type: 'mirror', target_dir: '', organization: '', user: '', pat: '',
        repo_selection: 'all', selected_repos: [],
        include_private: true, include_forks: false, group_by_project: true, prune: true,
      };
    } else {
      newSource = { type: 'postgresql', database_name: '', hostname: 'localhost', port: 5432, username: '', password: '' };
    }
    setFormData({ ...formData, sources: [...formData.sources, newSource] });
  };

  const removeSource = (index: number) => {
    setFormData({ ...formData, sources: formData.sources.filter((_: any, i: number) => i !== index) });
    setGitDiscoveredReposBySource({});
    setGitSelectedReposBySource({});
    setIsDiscoveringGitReposBySource({});
    setShowGitRepoResultsBySource({});
    setGitTestResultBySource({});
    setIsTestingGitConnectionBySource({});
  };

  const updateSource = (index: number, field: string, value: any) => {
    const newSources = [...formData.sources];
    newSources[index] = { ...newSources[index], [field]: value };
    if (field === 'type' && value !== 'local' && value !== 'sqlite') {
      newSources[index].port = getDefaultPort(value);
    }
    if (field === 'type' && value === 'mssql') checkMssqlTools();
    if (field === 'auth_method' && value === 'aws_iam') {
      checkAwsTools();
    }
    newSources[index] = enforceAwsIamTransport(newSources[index]);
    setFormData({ ...formData, sources: newSources });
  };

  const trimSourceField = (index: number, field: string) => {
    const source = formData.sources[index];
    const val = source?.[field];
    if (typeof val === 'string' && val !== val.trim()) {
      updateSource(index, field, val.trim());
    }
  };

  const getMssqlAuthHint = (source: any) => {
    const method = source?.auth_method || 'sql';
    if (method === 'service_principal') return 'Tip: Service Principal requires Client ID + Tenant ID, and Password must contain the Client Secret.';
    if (method === 'ad_password') return 'Tip: Entra ID Password requires Username (UPN, e.g. user@domain.tld) and Password.';
    return 'Tip: SQL Authentication uses a SQL login in Username and its SQL password in Password.';
  };

  // ── Canary file ──

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

  // ── Database browsing ──

  const browseDatabases = async (sourceIndex: number) => {
    const source = formData.sources[sourceIndex];
    if (!source || source.type === 'local' || source.type === 'sqlite') {
      toast.error('Database browsing is not available for this source type');
      return;
    }
    setDbBrowserState({ isOpen: true, sourceIndex, isLoading: true, databases: [], error: null });
    try {
      const response = await databaseDiscoveryAPI.listDatabases({
        type: source.type, hostname: source.hostname || 'localhost',
        port: source.port || getDefaultPort(source.type),
        username: source.username, password: source.password,
        container: source.container, instance: source.instance,
        encrypt: source.encrypt, trustServerCert: source.trustServerCert,
        auth_method: source.auth_method, client_id: source.client_id, tenant_id: source.tenant_id,
      });
      if (response.data?.success) {
        setDbBrowserState(prev => ({ ...prev, isLoading: false, databases: response.data.data.databases || [] }));
      } else {
        throw new Error(response.data?.detail || 'Failed to list databases');
      }
    } catch (error: any) {
      const baseError = error.response?.data?.detail || error.message || 'Failed to connect to database server';
      const authHint = source?.type === 'mssql' ? ` ${getMssqlAuthHint(source)}` : '';
      setDbBrowserState(prev => ({ ...prev, isLoading: false, error: `${baseError}${authHint}` }));
    }
  };

  const testDatabaseConnection = async (sourceIndex: number) => {
    const source = formData.sources[sourceIndex];
    if (!source || source.type !== 'mssql') { toast.error('Test connection is currently available for MSSQL only'); return; }
    if (!source.database_name || (!source.database_name.trim() || source.database_name === 'all')) {
      toast.error('Enter a specific database name before testing the connection.');
      return;
    }
    setTestingDbConnectionIndex(sourceIndex);
    try {
      const response = await databaseDiscoveryAPI.testConnection({
        type: source.type, hostname: source.hostname || 'localhost',
        port: source.port || getDefaultPort(source.type),
        username: source.username, password: source.password,
        container: source.container, instance: source.instance,
        encrypt: source.encrypt, trustServerCert: source.trustServerCert,
        auth_method: source.auth_method, client_id: source.client_id, tenant_id: source.tenant_id,
        database_name: source.database_name,
      });
      if (response.data?.success && response.data?.data?.connected) {
        toast.success('MSSQL connection successful');
      } else {
        throw new Error(response.data?.detail || 'Connection test failed');
      }
    } catch (error: any) {
      const baseError = error.response?.data?.detail || error.message || 'Failed to connect to MSSQL server';
      toast.error(`${baseError} ${getMssqlAuthHint(source)}`);
    } finally {
      setTestingDbConnectionIndex(null);
    }
  };

  const selectDatabaseFromBrowser = (dbName: string) => {
    const { sourceIndex } = dbBrowserState;
    if (sourceIndex >= 0) updateSource(sourceIndex, 'database_name', dbName);
    setDbBrowserState(prev => ({ ...prev, isOpen: false }));
  };

  // ── Database discovery ──

  const loadDockerNetworks = async () => {
    setIsLoadingNetworks(true);
    try {
      const response = await databaseDiscoveryAPI.getNetworks();
      const networks = response.data.data?.networks || [];
      setAvailableNetworks(networks);
      const connectedNetworks = response.data.data?.connected || [];
      if (connectedNetworks.length > 0) {
        setDiscoveryOptions(prev => ({ ...prev, networks: connectedNetworks }));
      }
    } catch (error: any) {
      console.error('Failed to load Docker networks:', error);
      setAvailableNetworks(['borgmatic-db', 'bridge', 'host']);
    } finally {
      setIsLoadingNetworks(false);
    }
  };

  const openDiscoveryOptions = async () => {
    setShowDiscoveryOptions(true);
    await loadDockerNetworks();
  };

  const handleAutoDiscover = async () => {
    setShowDiscoveryOptions(false);
    setIsDiscovering(true);
    try {
      const response = await databaseDiscoveryAPI.scan({
        networks: discoveryOptions.networks, includeHost: discoveryOptions.includeHost, forceRefresh: true,
      });
      const databases = response.data.data?.databases || [];
      setDiscoveredDatabases(databases);
      setShowDiscoveryResults(true);
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
    setSelectedDatabases(prev => prev.includes(dbId) ? prev.filter(id => id !== dbId) : [...prev, dbId]);
  };
  const selectAllDatabases = () => setSelectedDatabases(discoveredDatabases.map(db => db.id));
  const deselectAllDatabases = () => setSelectedDatabases([]);

  const addSelectedDatabases = () => {
    const databasesToAdd = discoveredDatabases
      .filter(db => selectedDatabases.includes(db.id))
      .map(db => {
        if (db.type === 'sqlite') {
          return { type: 'sqlite', database_name: db.database, path: db.path, label: db.label, discovered: true };
        }
        return {
          type: db.type, database_name: db.database,
          hostname: db.hostname || db.container, port: db.port || getDefaultPort(db.type),
          username: db.username || '', password: db.password || '',
          label: db.label, discovered: true, has_credentials: !!(db.username && db.password),
        };
      });
    setFormData({ ...formData, sources: [...formData.sources, ...databasesToAdd] });
    setShowDiscoveryResults(false);
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

  // ── Repository / pattern management ──

  const toggleRepository = (repo: any) => {
    const isSelected = formData.repositories.some((r: any) => r.path === repo.path);
    setFormData({
      ...formData,
      repositories: isSelected
        ? formData.repositories.filter((r: any) => r.path !== repo.path)
        : [...formData.repositories, { path: repo.path, label: repo.label || repo.name }],
    });
  };

  const addExcludePattern = () => {
    setFormData({ ...formData, exclude_patterns: [...formData.exclude_patterns, ''] });
  };

  const removeExcludePattern = (index: number) => {
    setFormData({ ...formData, exclude_patterns: formData.exclude_patterns.filter((_: any, i: number) => i !== index) });
  };

  const updateExcludePattern = (index: number, value: string) => {
    const newPatterns = [...formData.exclude_patterns];
    newPatterns[index] = value;
    setFormData({ ...formData, exclude_patterns: newPatterns });
    const error = validatePattern(value);
    if (error) {
      setPatternErrors({ ...patternErrors, [index]: error });
    } else {
      const newErrors = { ...patternErrors };
      delete newErrors[index];
      setPatternErrors(newErrors);
    }
  };

  return {
    currentStep, setCurrentStep,
    operatingMode,
    formData, setFormData,
    errors,
    isSubmitting,
    patternErrors,
    canaryFileCreating,
    customHookInput, setCustomHookInput,
    syncConfig, setSyncConfig,
    rcloneRemotes, loadingRcloneRemotes, loadRcloneRemotes,
    validationResult,
    showCloseConfirm, setShowCloseConfirm,
    isSavingDraft,
    discoveredDatabases, isDiscovering, selectedDatabases,
    showDiscoveryResults, setShowDiscoveryResults,
    showDiscoveryOptions, setShowDiscoveryOptions,
    discoveryOptions, setDiscoveryOptions,
    availableNetworks, isLoadingNetworks,
    gitDiscoveredReposBySource, setGitDiscoveredReposBySource,
    gitSelectedReposBySource, setGitSelectedReposBySource,
    isDiscoveringGitReposBySource, setIsDiscoveringGitReposBySource,
    showGitRepoResultsBySource, setShowGitRepoResultsBySource,
    gitTestResultBySource, setGitTestResultBySource,
    isTestingGitConnectionBySource, setIsTestingGitConnectionBySource,
    showGitPat, setShowGitPat,
    dbHelpExpanded, setDbHelpExpanded,
    gitHelpExpanded, setGitHelpExpanded,
    showRetentionModal, setShowRetentionModal,
    customRetention, setCustomRetention,
    dbBrowserState, setDbBrowserState,
    testingDbConnectionIndex,
    mssqlToolCheck, awsToolCheck,
    checkMssqlTools, checkAwsTools,
    commercialFeatures,
    availableRepositories, isLoadingRepos,
    availableSSHKeys,
    retentionProfiles,
    createRetentionMutation,
    schedules,
    availableScripts,
    hasLocalFolderSources,
    steps,
    generateSyncCommand,
    handleClose, saveAsDraftAndClose,
    validateStep, handleNext, handlePrevious, handleSubmit,
    addSource, removeSource, updateSource, trimSourceField,
    getDefaultPort, getMssqlAuthHint,
    createCanaryFile,
    browseDatabases, testDatabaseConnection, selectDatabaseFromBrowser,
    openDiscoveryOptions, handleAutoDiscover,
    toggleDatabaseSelection, selectAllDatabases, deselectAllDatabases, addSelectedDatabases,
    toggleRepository,
    addExcludePattern, removeExcludePattern, updateExcludePattern,
  };
}
