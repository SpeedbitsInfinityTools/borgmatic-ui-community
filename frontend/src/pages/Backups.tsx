import React, { useState, useRef } from 'react';
import { calculateNextRun } from '../utils/cronNextRun';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Edit2,
  Trash2,
  FileText,
  Database,
  HardDrive,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Play,
  Check,
  X,
  XCircle,
  Eye,
  Download,
  Upload,
  Copy,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Zap,
  LayoutGrid,
  List,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { backupsAPI, scheduleAPI, templatesAPI, identityAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import BackupWizard from '../components/BackupWizard';
import { useBackupExecution } from '../hooks/useSSE';
import { useSSEContext } from '../contexts/SSEContext';
import { formatDateTime } from '../utils/dateFormat';
import { getSafeDisplayPath } from '../utils/repositoryUtils';
import { useDirector } from '../contexts/DirectorContext';

interface BackupConfig {
  id: string;
  name: string;
  description?: string;
  schedule_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_run?: string | null;
  last_run_status?: string | null;
  source_count: number;
  repository_count: number;
  retention_profile_id: string;
  sources_summary?: any[];
  repositories_summary?: any[];
  validation_status?: 'valid' | 'invalid' | 'unknown';
  validation_error?: string | null;
  validation_date?: string | null;
  config?: {
    location?: {
      source_directories?: string[];
      repositories?: any[];
    };
  };
}

const Backups: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState<BackupConfig | null>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [editingBackup, setEditingBackup] = useState<BackupConfig | null>(null);
  const [editingScheduleForBackup, setEditingScheduleForBackup] = useState<string | null>(null);
  const [editingNameForBackup, setEditingNameForBackup] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [runConfirmBackup, setRunConfirmBackup] = useState<string | null>(null);
  const [viewingBackup, setViewingBackup] = useState<BackupConfig | null>(null);
  const [minSpinnerBackups, setMinSpinnerBackups] = useState<Set<string>>(new Set());
  const [backupProgress, setBackupProgress] = useState<Record<string, { stage: string; percentage: number }>>({}); // Track progress per backup
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [showYamlModal, setShowYamlModal] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [expandedBackups, setExpandedBackups] = useState<Set<string>>(new Set());
  const [duplicatingBackup, setDuplicatingBackup] = useState<BackupConfig | null>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  // Toggle expanded state for sources
  const toggleSources = (backupId: string) => {
    setExpandedSources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(backupId)) {
        newSet.delete(backupId);
      } else {
        newSet.add(backupId);
      }
      return newSet;
    });
  };

  // Toggle expanded state for repositories
  const toggleRepos = (backupId: string) => {
    setExpandedRepos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(backupId)) {
        newSet.delete(backupId);
      } else {
        newSet.add(backupId);
      }
      return newSet;
    });
  };

  // Toggle expanded state for backup in list view
  const toggleBackupExpanded = (backupId: string) => {
    setExpandedBackups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(backupId)) {
        newSet.delete(backupId);
      } else {
        newSet.add(backupId);
      }
      return newSet;
    });
  };

  // Real-time backup execution status via SSE
  const { isRunning } = useBackupExecution();

  // Get all backup configurations
  const { data: backupsData, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsAPI.getBackups().then(res => res.data),
    // No auto-refresh - manual changes only
  });

  const backups: BackupConfig[] = backupsData?.data?.backups || [];

  // Get all schedules
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => scheduleAPI.getSchedules().then(res => res.data),
  });

  const schedules = schedulesData?.data?.schedules || [];

  // Get current mode
  const { data: identityData } = useQuery({
    queryKey: ['identityStatus'],
    queryFn: () => identityAPI.getStatus(),
  });

  const { isRemoteSession } = useDirector();

  // Only show Director-specific features when in Director mode AND not viewing a remote client
  const isDirectorMode = identityData?.data?.data?.mode === 'director';
  const showDirectorFeatures = isDirectorMode && !isRemoteSession;

  // Get all templates (Director mode only, not in remote session)
  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesAPI.getTemplates().then(res => res.data),
    enabled: showDirectorFeatures, // Only fetch when on Director and not viewing a client
  });

  const templates = templatesData?.data?.data?.backups || [];

  // Delete backup mutation
  const deleteBackupMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename?: string }) =>
      backupsAPI.deleteBackup(id, filename),
    onSuccess: () => {
      toast.success('Backup configuration deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete backup');
    },
  });

  // Toggle backup active status
  const toggleBackupMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      backupsAPI.toggleBackup(id, is_active),
    onSuccess: (_, variables) => {
      toast.success(`Backup ${variables.is_active ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to toggle backup status');
    },
  });

  // Update backup schedule mutation
  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, schedule_id }: { id: string; schedule_id: string | null }) =>
      backupsAPI.updateBackup(id, { schedule_id }),
    onSuccess: () => {
      toast.success('Schedule updated successfully');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      setEditingScheduleForBackup(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update schedule');
    },
  });

  // Update backup name mutation
  const updateNameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      backupsAPI.updateBackup(id, { name }),
    onSuccess: () => {
      toast.success('Backup name updated successfully');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      setEditingNameForBackup(null);
      setEditingName('');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update backup name');
    },
  });

  // Run backup manually mutation
  const runBackupMutation = useMutation({
    mutationFn: backupsAPI.runBackup,
    onSuccess: (response, backupId) => {
      console.log('✅ Backup started successfully:', response.data);
      toast.success('Backup started! Monitor progress in real-time.');
      setRunConfirmBackup(null);

      // Ensure spinner shows for at least 3 seconds
      setMinSpinnerBackups(prev => new Set(prev).add(backupId));
      setTimeout(() => {
        setMinSpinnerBackups(prev => {
          const next = new Set(prev);
          next.delete(backupId);
          return next;
        });
      }, 3000);

      // Note: We don't invalidate queries here as SSE will provide real-time updates
      // Invalidate after backup completes (via SSE event) instead
    },
    onError: (error: any) => {
      console.error('❌ Failed to start backup:', error);
      const errorMsg = error.response?.data?.error || 'Failed to start backup';

      // Check if it's a 409 (already running) error
      if (error.response?.status === 409) {
        toast.error('Backup is already running. Please wait for it to complete.');
      } else {
        toast.error(errorMsg);
      }
      setRunConfirmBackup(null);
    },
  });

  // Cancel confirmation state
  const [cancelConfirmBackup, setCancelConfirmBackup] = useState<string | null>(null);

  // Stop backup mutation
  const stopBackupMutation = useMutation({
    mutationFn: backupsAPI.stopBackup,
    onSuccess: (response, backupId) => {
      console.log('🛑 Backup stop signal sent:', backupId);
      toast.success('Backup cancellation requested');
      setCancelConfirmBackup(null);
      // Remove from min spinner set
      setMinSpinnerBackups(prev => {
        const next = new Set(prev);
        next.delete(backupId);
        return next;
      });
    },
    onError: (error: any) => {
      console.error('❌ Failed to stop backup:', error);
      toast.error(error.response?.data?.error || 'Failed to stop backup');
      setCancelConfirmBackup(null);
    },
  });

  // Handle cancel with confirmation
  const handleCancelBackup = (backupId: string) => {
    if (cancelConfirmBackup === backupId) {
      // Second click - actually cancel
      stopBackupMutation.mutate(backupId);
    } else {
      // First click - show confirmation
      setCancelConfirmBackup(backupId);
      // Auto-reset after 5 seconds if not confirmed
      setTimeout(() => {
        setCancelConfirmBackup(prev => prev === backupId ? null : prev);
      }, 5000);
    }
  };

  // Listen for backup completion events to refresh data
  const { events } = useSSEContext();

  // Track processed events to avoid re-processing
  const processedEventsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    // Listen for backup completion/failure events
    const lastEvent = events[events.length - 1];

    if (lastEvent && (
      lastEvent.type === 'backup_completed' ||
      lastEvent.type === 'backup_failed' ||
      lastEvent.type === 'backup_stopped' ||
      lastEvent.type === 'backup_started'
    )) {
      // Create a unique key for this event
      const eventKey = `${lastEvent.type}-${lastEvent.data.backup_id}-${lastEvent.timestamp}`;

      // Only process if we haven't seen this event
      if (!processedEventsRef.current.has(eventKey)) {
        processedEventsRef.current.add(eventKey);

        console.log(`🔄 Backup ${lastEvent.type.replace('backup_', '')}, refreshing data...`);
        // Refresh backup list to show updated last_run and status
        queryClient.invalidateQueries({ queryKey: ['backups'] });
        // Force immediate refetch
        queryClient.refetchQueries({ queryKey: ['backups'] });

        // Clear progress for this backup
        if (lastEvent.data.backup_id) {
          setBackupProgress(prev => {
            const next = { ...prev };
            delete next[lastEvent.data.backup_id];
            return next;
          });
        }

        // Clean up old processed events (keep last 50)
        if (processedEventsRef.current.size > 50) {
          const eventsArray = Array.from(processedEventsRef.current);
          processedEventsRef.current = new Set(eventsArray.slice(-25));
        }
      }
    }

    // Listen for progress events to update stage
    if (lastEvent && lastEvent.type === 'backup_progress') {
      const backupId = lastEvent.data.backup_id;
      const output = lastEvent.data.output || '';

      // Parse stage from output
      let stage = 'Running';
      let percentage = 0;

      if (output.includes('Creating archive')) {
        stage = 'Creating archive';
        percentage = 33;
      } else if (output.includes('Pruning archives')) {
        stage = 'Pruning';
        percentage = 66;
      } else if (output.includes('Compacting segments')) {
        stage = 'Compacting';
        percentage = 90;
      } else if (output.includes('Successfully ran')) {
        stage = 'Wrapping up';
        percentage = 99;
      }

      setBackupProgress(prev => ({
        ...prev,
        [backupId]: { stage, percentage }
      }));
    }
  }, [events, queryClient]);

  const handleWizardSuccess = () => {
    setShowCreateModal(false);
    setEditingBackup(null);
    queryClient.invalidateQueries({ queryKey: ['backups'] });
    queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
  };

  const handleEdit = (backup: BackupConfig) => {
    setEditingBackup(backup);
    setShowCreateModal(true);
  };

  const handleDelete = (backup: BackupConfig) => {
    setDeletingBackup(backup);
  };

  const handleViewYaml = async (backupId: string) => {
    setYamlLoading(true);
    setShowYamlModal(true);
    try {
      const response = await backupsAPI.getYamlContent(backupId);
      setYamlContent(response.data?.data?.yaml || '# Could not load YAML content');
    } catch (error: any) {
      toast.error('Failed to load YAML configuration');
      setYamlContent(`# Error loading YAML: ${error.message || 'Unknown error'}`);
    } finally {
      setYamlLoading(false);
    }
  };

  const confirmDeleteBackup = () => {
    if (deletingBackup) {
      // Pass filename for discovered backups (helps backend find the file)
      deleteBackupMutation.mutate({
        id: deletingBackup.id,
        filename: (deletingBackup as any).filename || (deletingBackup as any).isDiscovered ? (deletingBackup as any).filename : undefined
      });
      setDeletingBackup(null);
    }
  };

  const cancelDeleteBackup = () => {
    setDeletingBackup(null);
  };

  const handleExportAsTemplate = async (backup: BackupConfig) => {
    try {
      const response = await backupsAPI.exportAsTemplate(backup.id);

      // Create blob and download
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${backup.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Template exported: ${backup.name}`);
    } catch (error: any) {
      console.error('Failed to export template:', error);
      toast.error(error.response?.data?.error || 'Failed to export template');
    }
  };

  const handleImportTemplate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const MAX_TEMPLATE_SIZE = 1024 * 1024; // 1MB
    if (file.size > MAX_TEMPLATE_SIZE) {
      toast.error('Template file is too large (max 1MB).');
      if (templateFileInputRef.current) templateFileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error('Invalid template file format.');
          return;
        }

        const normalizedTemplate = {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          sources: Array.isArray(parsed.sources) ? parsed.sources : [],
          repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
          retention_profile_id: typeof parsed.retention_profile_id === 'string' ? parsed.retention_profile_id : 'profile-standard',
          schedule_id: typeof parsed.schedule_id === 'string' ? parsed.schedule_id : null,
          exclude_patterns: Array.isArray(parsed.exclude_patterns) ? parsed.exclude_patterns : [],
          exclude_caches: parsed.exclude_caches !== false,
          upload_rate_limit: typeof parsed.upload_rate_limit === 'number' ? parsed.upload_rate_limit : 0,
          archive_name_format: typeof parsed.archive_name_format === 'string' ? parsed.archive_name_format : '{hostname}-{now}',
          check_frequency: typeof parsed.check_frequency === 'string' ? parsed.check_frequency : '2 weeks',
          hooks: (parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)) ? parsed.hooks : {
            before_backup: [],
            after_backup: [],
            on_error: [],
          },
          canary_file_enabled: parsed.canary_file_enabled === true,
          canary_file_path: typeof parsed.canary_file_path === 'string' ? parsed.canary_file_path : '',
          auto_break_lock: parsed.auto_break_lock === true,
        };

        if (!normalizedTemplate.name || normalizedTemplate.sources.length === 0 || normalizedTemplate.repositories.length === 0) {
          toast.error('Invalid template: name, sources, and repositories are required.');
          return;
        }

        setSelectedTemplate(normalizedTemplate);
        setShowCreateModal(true);
        toast.success(`Template loaded: ${normalizedTemplate.name}`);
      } catch {
        toast.error('Failed to parse template file. Please ensure it is valid JSON.');
      }
    };
    reader.readAsText(file);

    // Reset file input so the same file can be selected again
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = '';
    }
  };

  const handleDuplicate = (backup: BackupConfig) => {
    setDuplicatingBackup(backup);
  };

  const confirmDuplicateBackup = async () => {
    if (!duplicatingBackup) return;
    try {
      const response = await backupsAPI.duplicateBackup(duplicatingBackup.id);
      const newName = response.data?.data?.name || `Copy - ${duplicatingBackup.name}`;
      toast.success(`Backup duplicated as "${newName}" (inactive)`);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      queryClient.invalidateQueries({ queryKey: ['config-parser-state'] });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to duplicate backup');
    } finally {
      setDuplicatingBackup(null);
    }
  };

  const handleToggle = (backup: BackupConfig) => {
    // Don't allow activation if validation failed
    if (!backup.is_active && backup.validation_status === 'invalid') {
      toast.error(`Cannot activate: Configuration has errors\n${backup.validation_error || 'Please fix configuration errors first.'}`);
      return;
    }

    // Don't allow activation if no schedule is set
    if (!backup.is_active && !backup.schedule_id) {
      toast.error('Cannot activate backup without a schedule. Please edit and add a schedule first.');
      return;
    }

    toggleBackupMutation.mutate({
      id: backup.id,
      is_active: !backup.is_active,
    });
  };

  const handleRunManually = (backupId: string) => {
    // Prevent starting if already running or mutation in flight
    if (isRunning(backupId) || runBackupMutation.isLoading) {
      toast.error('This backup is already running. Please wait for it to complete.');
      return;
    }

    if (runConfirmBackup === backupId) {
      setRunConfirmBackup(null);
      runBackupMutation.mutate(backupId);
    } else {
      setRunConfirmBackup(backupId);
      setTimeout(() => setRunConfirmBackup(null), 3000);
    }
  };

  const handleNameEdit = (backup: BackupConfig) => {
    if (editingNameForBackup === backup.id) {
      // Save
      if (editingName.trim() && editingName !== backup.name) {
        updateNameMutation.mutate({ id: backup.id, name: editingName.trim() });
      } else {
        setEditingNameForBackup(null);
        setEditingName('');
      }
    } else {
      // Start editing
      setEditingNameForBackup(backup.id);
      setEditingName(backup.name);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Backups</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your backup configurations and schedules
          </p>
          <p className="mt-2 text-sm text-gray-600">
            This is the central section to set up new backups locally. You need to define "Schedules" and "Repositories" before you can add a backup job.
          </p>
        </div>
        <div className="flex items-center space-x-3 flex-shrink-0">
          {/* View Mode Toggle */}
          {backups.length > 0 && (
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 rounded-md transition-colors ${viewMode === 'cards'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
                title="Card view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-colors ${viewMode === 'list'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>Create Backup</span>
          </button>
          <button
            onClick={() => templateFileInputRef.current?.click()}
            className="btn-secondary flex items-center space-x-2"
            title="Import a previously exported backup template (JSON file)"
          >
            <Upload className="w-5 h-5" />
            <span>Import Template</span>
          </button>
          <input
            ref={templateFileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportTemplate}
            className="hidden"
          />
          {showDirectorFeatures && (
            <button
              onClick={() => setShowTemplateSelector(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <FileText className="w-5 h-5" />
              <span>Add from Template</span>
            </button>
          )}
        </div>
      </div>

      {/* Backup Cards */}
      {backups.length === 0 ? (
        <div className="py-8">
          <div className="text-center mb-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-lg font-medium text-gray-900">No backup configurations yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Choose how you'd like to get started with your backup setup.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Quick Setup Card */}
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 rounded-xl p-6 hover:border-blue-400 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Quick Setup</h4>
                  <p className="text-xs text-blue-600">Recommended</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Use the <strong>Infinity Tools Backup Template</strong> to automatically configure backups with best practices and ransomware protection.
              </p>
              <Link
                to="/templates"
                className="btn-primary w-full text-center inline-block"
              >
                <span className="flex items-center justify-center gap-2">
                  <Zap className="w-4 h-4" />
                  Quick Setup with Template
                </span>
              </Link>
            </div>

            {/* Manual Setup Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 hover:border-gray-300 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Plus className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Manual Configuration</h4>
                  <p className="text-xs text-gray-500">Full control</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Create a custom backup configuration with full control over sources, repositories, schedules, and retention policies.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-secondary w-full"
              >
                <span className="flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create Custom Backup
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="bg-white rounded-lg border shadow-sm">
          {backups.map((backup, index) => {
            const backupRunning = isRunning(backup.id);
            const showSpinner = backupRunning || minSpinnerBackups.has(backup.id);
            const progress = backupProgress[backup.id];
            const isExpanded = expandedBackups.has(backup.id);
            const schedule = schedules.find((s: any) => s.id === backup.schedule_id);

            return (
              <div key={backup.id} className={index > 0 ? 'border-t border-gray-200' : ''}>
                {/* Compact Row */}
                <div
                  className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleBackupExpanded(backup.id)}
                >
                  {/* Expand/Collapse Icon */}
                  <button className="p-1 mr-2 text-gray-400">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  {/* Active Toggle (at start) */}
                  <div className="mr-3" onClick={(e) => e.stopPropagation()}>
                    {showSpinner ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    ) : backup.validation_status === 'invalid' ? (
                      <div className="flex items-center" title="Invalid configuration">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                      </div>
                    ) : (
                      <button
                        onClick={() => handleToggle(backup)}
                        disabled={toggleBackupMutation.isLoading}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${backup.is_active ? 'bg-green-500' : 'bg-gray-300'
                          } disabled:opacity-50`}
                        title={backup.is_active ? 'Deactivate backup' : 'Activate backup'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${backup.is_active ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Name & Description */}
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{backup.name}</span>
                      {backup.validation_status === 'invalid' && (
                        <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">Invalid</span>
                      )}
                    </div>
                    {backup.description && (
                      <p className="text-xs text-gray-500 truncate">{backup.description}</p>
                    )}
                  </div>

                  {/* Sources Summary */}
                  <div className="hidden md:flex items-center gap-1 mr-4 w-32">
                    <Database className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-sm text-gray-600">{backup.source_count} source(s)</span>
                  </div>

                  {/* Schedule */}
                  <div className="hidden lg:flex items-center gap-1 mr-4 w-40">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-sm text-gray-600 truncate">
                      {schedule?.name || 'No schedule'}
                    </span>
                  </div>

                  {/* Last Run Status */}
                  <div className="hidden sm:flex items-center mr-4 w-28">
                    {backup.last_run ? (
                      backup.last_run_status === 'success' ? (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full flex items-center">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Success
                        </span>
                      ) : backup.last_run_status === 'warning' ? (
                        <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full flex items-center">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Warning
                        </span>
                      ) : backup.last_run_status === 'running' ? (
                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full flex items-center">
                          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                          Running
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full flex items-center">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Failed
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-gray-400">Never run</span>
                    )}
                  </div>

                  {/* Running Progress */}
                  {showSpinner && progress && (
                    <div className="mr-4 w-24">
                      <div className="text-xs text-blue-600 mb-0.5">{progress.stage}</div>
                      <div className="w-full bg-blue-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-600 h-full rounded-full transition-all"
                          style={{ width: `${progress.percentage}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                    {showSpinner ? (
                      <button
                        onClick={() => handleCancelBackup(backup.id)}
                        disabled={stopBackupMutation.isLoading}
                        className={`p-1.5 rounded transition-colors ${
                          cancelConfirmBackup === backup.id
                            ? 'bg-red-100 text-red-700'
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                        title={cancelConfirmBackup === backup.id ? 'Click again to confirm cancel' : 'Cancel backup'}
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRunManually(backup.id)}
                        disabled={backup.validation_status === 'invalid' || runBackupMutation.isLoading}
                        className={`p-1.5 rounded transition-colors ${runConfirmBackup === backup.id
                          ? 'bg-green-100 text-green-700'
                          : 'text-blue-600 hover:bg-blue-50'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={runConfirmBackup === backup.id ? 'Click again to confirm' : 'Run manually'}
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(backup)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(backup)}
                      className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                      title="Duplicate backup"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(backup)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Sources */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Sources</label>
                        <div className="mt-1 space-y-1">
                          {backup.sources_summary?.map((source: any, idx: number) => {
                            const isDatabase = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'mssql'].includes(source.type);
                            const isGitRepo = source.type === 'git_repos';
                            return (
                              <div key={idx} className="flex items-center text-sm text-gray-600">
                                {isGitRepo ? (
                                  <GitBranch className="w-3 h-3 mr-2 text-purple-500" />
                                ) : isDatabase ? (
                                  <Database className="w-3 h-3 mr-2 text-blue-500" />
                                ) : (
                                  <FolderOpen className="w-3 h-3 mr-2 text-yellow-600" />
                                )}
                                <span className="truncate">
                                  {isGitRepo
                                    ? `${source.platform}: ${source.organization || source.group || source.workspace || source.user || source.repo_name || 'repos'}`
                                    : isDatabase ? `${source.type}: ${source.database_name || 'all'}` : source.path}
                                </span>
                              </div>
                            );
                          })}
                          {(!backup.sources_summary || backup.sources_summary.length === 0) && (
                            <span className="text-sm text-gray-400 italic">No sources</span>
                          )}
                        </div>
                      </div>

                      {/* Repositories */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Repositories</label>
                        <div className="mt-1 space-y-1">
                          {backup.repositories_summary?.map((repo: any, idx: number) => (
                            <div key={idx} className="flex items-center text-sm text-gray-600">
                              <HardDrive className="w-3 h-3 mr-2 text-green-500" />
                              <span className="truncate" title={getSafeDisplayPath(repo.path)}>{repo.label || getSafeDisplayPath(repo.path)}</span>
                            </div>
                          ))}
                          {(!backup.repositories_summary || backup.repositories_summary.length === 0) && (
                            <span className="text-sm text-gray-400 italic">No repositories</span>
                          )}
                        </div>
                      </div>

                      {/* Schedule & Timing */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Schedule</label>
                        <div className="mt-1 text-sm text-gray-600">
                          <div className="flex items-center">
                            <Calendar className="w-3 h-3 mr-2 text-gray-400" />
                            <span>{schedule?.name || 'No schedule'}</span>
                          </div>
                          {backup.last_run && (
                            <div className="flex items-center mt-1">
                              <Clock className="w-3 h-3 mr-2 text-gray-400" />
                              <span className="text-xs">Last: {formatDateTime(backup.last_run)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Validation Error */}
                    {backup.validation_status === 'invalid' && backup.validation_error && (
                      <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        <AlertTriangle className="w-4 h-4 inline mr-2" />
                        {backup.validation_error}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => setViewingBackup(backup)}
                        className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                      >
                        <Eye className="w-3 h-3 inline mr-1" />
                        View Details
                      </button>
                      <button
                        onClick={() => handleExportAsTemplate(backup)}
                        className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                      >
                        <Download className="w-3 h-3 inline mr-1" />
                        Export Template
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Card View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {backups.map((backup) => {
            const backupRunning = isRunning(backup.id);
            const showSpinner = backupRunning || minSpinnerBackups.has(backup.id);
            const progress = backupProgress[backup.id];

            return (
              <div
                key={backup.id}
                className="bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow relative flex flex-col"
              >
                {/* Running indicator with progress */}
                {showSpinner && (
                  <div className="absolute top-4 right-4 z-10">
                    <div className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium shadow-sm border border-blue-200">
                      <div className="flex items-center space-x-2 mb-1">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-700"></div>
                        <span>{progress?.stage || 'Starting...'}</span>
                      </div>
                      {progress && progress.percentage > 0 && (
                        <div className="mt-1">
                          <div className="w-32 bg-blue-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-blue-600 h-full transition-all duration-500 ease-out"
                              style={{ width: `${progress.percentage}%` }}
                            ></div>
                          </div>
                          <div className="text-[10px] text-blue-600 mt-0.5 text-right">{progress.percentage}%</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-4 sm:p-6 flex flex-col flex-1">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3 flex-1 min-w-0 group">
                      <FileText className="w-6 h-6 text-blue-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        {editingNameForBackup === backup.id ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={() => handleNameEdit(backup)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleNameEdit(backup);
                                if (e.key === 'Escape') {
                                  setEditingNameForBackup(null);
                                  setEditingName('');
                                }
                              }}
                              className="flex-1 px-2 py-1 text-lg font-medium border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => handleNameEdit(backup)}
                              className="p-1 text-green-600 hover:text-green-700"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingNameForBackup(null);
                                setEditingName('');
                              }}
                              className="p-1 text-red-600 hover:text-red-700"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <h3 className="text-sm font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded break-words">
                              {backup.name}
                            </h3>
                            <button
                              onClick={() => {
                                setEditingNameForBackup(backup.id);
                                setEditingName(backup.name);
                              }}
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0"
                              title="Edit backup name"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {backup.description && (
                          <p className="text-xs text-gray-500 mt-1 break-words">
                            {backup.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center space-x-2">
                      {/* Validation Status Badge */}
                      {backup.validation_status === 'invalid' && (
                        <span
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 cursor-help"
                          title={backup.validation_error || 'Configuration has errors'}
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Invalid
                        </span>
                      )}

                      {/* Active/Inactive Toggle Switch */}
                      <button
                        onClick={() => handleToggle(backup)}
                        disabled={toggleBackupMutation.isLoading || backup.validation_status === 'invalid'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${backup.is_active ? 'bg-green-600' : 'bg-gray-300'
                          }`}
                        title={
                          backup.validation_status === 'invalid'
                            ? 'Cannot activate: Configuration has validation errors'
                            : !backup.schedule_id && !backup.is_active
                              ? 'Cannot activate: No schedule set'
                              : backup.is_active
                                ? 'Click to deactivate'
                                : 'Click to activate'
                        }
                      >
                        <span className="sr-only">
                          {backup.is_active ? 'Deactivate' : 'Activate'} backup
                        </span>
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${backup.is_active ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Validation Error Alert */}
                  {backup.validation_status === 'invalid' && backup.validation_error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-start">
                        <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                        <div className="ml-3 flex-1">
                          <h4 className="text-sm font-medium text-red-800">Configuration Error</h4>
                          <p className="mt-1 text-xs text-red-700 font-mono whitespace-pre-wrap">
                            {backup.validation_error}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Details */}
                  <div className="space-y-3">
                    {/* Sources - Collapsible */}
                    <div>
                      <button
                        onClick={() => toggleSources(backup.id)}
                        className="w-full flex items-center justify-between text-left hover:bg-gray-50 rounded p-1 -m-1 transition-colors"
                      >
                        <div className="flex items-center">
                          <label className="text-xs font-medium text-gray-500 uppercase cursor-pointer">
                            Sources
                          </label>
                        </div>
                        <div className="flex items-center text-sm text-gray-900">
                          <Database className="w-4 h-4 mr-2 text-gray-400" />
                          <span>{backup.source_count || 0} source(s)</span>
                          {expandedSources.has(backup.id) ? (
                            <ChevronDown className="w-4 h-4 ml-2 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 ml-2 text-gray-400" />
                          )}
                        </div>
                      </button>
                      {/* Show brief summary when collapsed */}
                      {!expandedSources.has(backup.id) && backup.sources_summary && backup.sources_summary.length > 0 && (
                        <div className="mt-1 ml-2 flex flex-wrap gap-1">
                          {backup.sources_summary.slice(0, 3).map((source: any, idx: number) => {
                            const isDatabase = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'mssql'].includes(source.type);
                            const isGitRepo = source.type === 'git_repos';
                            const displayName = isGitRepo
                              ? `${source.platform}: ${source.organization || source.group || source.workspace || source.user || 'repos'}`
                              : isDatabase
                              ? (source.hostname ? `@${source.hostname}` : source.path || source.type)
                              : (source.path?.split('/').pop() || 'Local');
                            return (
                              <span
                                key={idx}
                                className={`text-xs px-1.5 py-0.5 rounded ${isGitRepo
                                  ? 'bg-purple-50 text-purple-700'
                                  : isDatabase
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-yellow-50 text-yellow-700'
                                  }`}
                                title={isGitRepo ? `Git: ${source.organization || source.group || source.workspace || ''}` : isDatabase ? `${source.type}: ${source.database_name || 'all'}` : source.path}
                              >
                                {displayName}
                              </span>
                            );
                          })}
                          {backup.sources_summary.length > 3 && (
                            <span className="text-xs text-gray-400">
                              +{backup.sources_summary.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                      {expandedSources.has(backup.id) && backup.sources_summary && backup.sources_summary.length > 0 && (
                        <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200 space-y-1">
                          {backup.sources_summary.map((source: any, idx: number) => {
                            const isDatabase = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'mssql'].includes(source.type);
                            const isGitRepo = source.type === 'git_repos';
                            return (
                              <div key={idx} className="flex items-center text-xs text-gray-600">
                                {isGitRepo ? (
                                  <>
                                    <GitBranch className="w-3 h-3 mr-2 text-purple-500" />
                                    <span className="font-medium">{source.platform}:</span>
                                    <span className="ml-1">{source.organization || source.group || source.workspace || source.user || source.repo_name || 'repos'}</span>
                                    <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">{source.backup_type || 'mirror'}</span>
                                    {source.repo_selection === 'selected' && source.selected_repos?.length > 0 && (
                                      <span className="ml-1 text-gray-400">({source.selected_repos.length} repos)</span>
                                    )}
                                  </>
                                ) : isDatabase ? (
                                  <>
                                    <Database className="w-3 h-3 mr-2 text-blue-500" />
                                    <span className="font-medium">{source.type}:</span>
                                    <span className="ml-1 font-mono">{source.database_name || 'all'}</span>
                                    {source.hostname && (
                                      <span className="ml-1 text-gray-400">@{source.hostname}</span>
                                    )}
                                    {source.is_host_database && (
                                      <span className="ml-2 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs" title="host.docker.internal">
                                        🖥️ host
                                      </span>
                                    )}
                                    {!source.is_host_database && source.type !== 'sqlite' && source.hostname && source.hostname !== 'localhost' && (
                                      <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs" title="Network connection (docker network for containers, or normal network for remote hosts)">
                                        🔗 net
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <FolderOpen className="w-3 h-3 mr-2 text-yellow-600" />
                                    <span className="font-mono truncate" title={source.path}>{source.path}</span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {expandedSources.has(backup.id) && (!backup.sources_summary || backup.sources_summary.length === 0) && (
                        <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200">
                          <span className="text-xs text-gray-400 italic">No sources configured</span>
                        </div>
                      )}
                    </div>

                    {/* Repositories - Collapsible */}
                    <div>
                      <button
                        onClick={() => toggleRepos(backup.id)}
                        className="w-full flex items-center justify-between text-left hover:bg-gray-50 rounded p-1 -m-1 transition-colors"
                      >
                        <div className="flex items-center">
                          <label className="text-xs font-medium text-gray-500 uppercase cursor-pointer">
                            Repositories
                          </label>
                        </div>
                        <div className="flex items-center text-sm text-gray-900">
                          <HardDrive className="w-4 h-4 mr-2 text-gray-400" />
                          <span>{backup.repository_count} repository(ies)</span>
                          {expandedRepos.has(backup.id) ? (
                            <ChevronDown className="w-4 h-4 ml-2 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 ml-2 text-gray-400" />
                          )}
                        </div>
                      </button>
                      {expandedRepos.has(backup.id) && backup.repositories_summary && backup.repositories_summary.length > 0 && (
                        <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200 space-y-1">
                          {backup.repositories_summary.map((repo: any, idx: number) => (
                            <div key={idx} className="flex items-start text-xs text-gray-600">
                              <HardDrive className="w-3 h-3 mr-2 mt-0.5 text-green-500 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                {repo.label && (
                                  <span className="text-gray-500 text-xs">{repo.label}</span>
                                )}
                                <p className="font-mono text-xs break-all" title={getSafeDisplayPath(repo.path)}>{getSafeDisplayPath(repo.path)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {expandedRepos.has(backup.id) && (!backup.repositories_summary || backup.repositories_summary.length === 0) && (
                        <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200">
                          <span className="text-xs text-gray-400 italic">No repositories configured</span>
                        </div>
                      )}
                    </div>

                    {/* Schedule */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase">
                        Schedule
                      </label>
                      <div className="mt-1 flex items-center text-sm text-gray-900">
                        <Calendar className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                        {editingScheduleForBackup === backup.id ? (
                          <div className="flex items-center space-x-2 flex-1">
                            <select
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              value={backup.schedule_id || ''}
                              onChange={(e) => {
                                updateScheduleMutation.mutate({
                                  id: backup.id,
                                  schedule_id: e.target.value || null
                                });
                              }}
                              onBlur={() => setEditingScheduleForBackup(null)}
                              autoFocus
                            >
                              <option value="">No schedule (manual only)</option>
                              {schedules.map((schedule: any) => (
                                <option key={schedule.id} value={schedule.id}>
                                  {schedule.name} - {schedule.cron_expression}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 flex-1">
                            {backup.schedule_id ? (
                              <span className="flex-1">
                                {schedules.find((s: any) => s.id === backup.schedule_id)?.name || 'Scheduled'}
                              </span>
                            ) : (
                              <span className="text-gray-500 flex-1">No schedule</span>
                            )}
                            <button
                              onClick={() => setEditingScheduleForBackup(backup.id)}
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Change schedule"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Next Run */}
                    {backup.is_active && backup.schedule_id && (() => {
                      const schedule = schedules.find((s: any) => s.id === backup.schedule_id);
                      const nextRun = schedule?.cron_expression ? calculateNextRun(schedule.cron_expression) : null;

                      return (
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">
                            Next Run
                          </label>
                          <div className="mt-1 flex items-center text-sm text-gray-600">
                            <Clock className="w-4 h-4 mr-2 text-gray-400" />
                            <span>{nextRun || 'Not scheduled'}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {!backup.is_active && (
                      <div className="flex items-center text-sm text-gray-500">
                        <Clock className="w-4 h-4 mr-2" />
                        <span>Not scheduled (inactive)</span>
                      </div>
                    )}

                    {/* Last Run */}
                    {backup.last_run ? (
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">
                          Last Run
                        </label>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-sm text-gray-700">
                            {formatDateTime(backup.last_run)}
                          </span>
                          {backup.last_run_status === 'success' ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Success
                            </span>
                          ) : backup.last_run_status === 'warning' ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Warning
                            </span>
                          ) : backup.last_run_status === 'running' ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                              Running
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Failed
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">
                        <span>Never run</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-6 pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    {/* Run Manually / Cancel Button */}
                    {showSpinner ? (
                      <button
                        onClick={() => handleCancelBackup(backup.id)}
                        disabled={stopBackupMutation.isLoading}
                        className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                          cancelConfirmBackup === backup.id
                            ? 'bg-red-700 text-white'
                            : 'bg-red-600 text-white hover:bg-red-700'
                        } disabled:bg-red-400`}
                        title={cancelConfirmBackup === backup.id ? 'Click again to confirm' : 'Cancel this backup'}
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{cancelConfirmBackup === backup.id ? 'Confirm Cancel?' : 'Cancel'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRunManually(backup.id)}
                        disabled={backup.validation_status === 'invalid' || runBackupMutation.isLoading}
                        className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm ${runConfirmBackup === backup.id
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed'
                          }`}
                        title={
                          backup.validation_status === 'invalid'
                            ? 'Cannot run: Configuration has errors'
                            : 'Run this backup manually'
                        }
                      >
                        <Play className="w-4 h-4" />
                        <span className="whitespace-nowrap">{runConfirmBackup === backup.id ? 'Run now?' : 'Run manually'}</span>
                      </button>
                    )}

                    {/* View, Edit, Export and Delete */}
                    <div className="flex items-center justify-center sm:justify-end space-x-2">
                      <button
                        onClick={() => setViewingBackup(backup)}
                        className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded transition-colors flex-shrink-0"
                        title="View backup details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEdit(backup)}
                        className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
                        title="Edit backup"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleExportAsTemplate(backup)}
                        className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition-colors flex-shrink-0"
                        title="Export as template"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDuplicate(backup)}
                        className="p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition-colors flex-shrink-0"
                        title="Duplicate backup"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(backup)}
                        className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        title="Delete backup"
                        disabled={deleteBackupMutation.isLoading}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template Selector Modal (Director mode only, not in remote session) */}
      {showDirectorFeatures && showTemplateSelector && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Select a Template</h3>
                <button
                  onClick={() => setShowTemplateSelector(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Choose a template to create a new backup configuration
              </p>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {templates.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-500">No templates available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {templates.map((template: any) => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template);
                        setShowTemplateSelector(false);
                        setShowCreateModal(true);
                      }}
                      className="w-full text-left p-4 border rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium text-gray-900">{template.name}</h4>
                            {template.is_system_template && (
                              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                System
                              </span>
                            )}
                          </div>
                          {template.description && (
                            <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                          )}
                          <div className="mt-2 text-xs text-gray-500">
                            {template.sources_summary?.length || 0} sources • {template.repositories_summary?.length || 0} repositories
                          </div>
                        </div>
                        <FileText className="w-5 h-5 text-purple-600 flex-shrink-0 ml-3" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowTemplateSelector(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Wizard Modal */}
      {/* Delete Confirmation Modal */}
      {deletingBackup && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
          <div className="relative mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  Delete Backup Configuration
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Really delete <span className="font-semibold text-gray-900">"{deletingBackup.name}"</span>?
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    This will delete the configuration file. Backups in repositories remain intact.
                  </p>
                  {deletingBackup.last_run && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Last backup ran on {formatDateTime(deletingBackup.last_run)}.
                        The backup archives will not be deleted.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end space-x-3">
              <button
                onClick={cancelDeleteBackup}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBackup}
                disabled={deleteBackupMutation.isLoading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deleteBackupMutation.isLoading ? 'Deleting...' : 'Delete Backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Confirmation Modal */}
      {duplicatingBackup && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
          <div className="relative mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <Copy className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  Duplicate Backup
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Really duplicate <span className="font-semibold text-gray-900">"{duplicatingBackup.name}"</span>?
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    A copy will be created as <span className="font-semibold text-purple-700">"Copy - {duplicatingBackup.name}"</span> and will be <strong>deactivated</strong> by default.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end space-x-3">
              <button
                onClick={() => setDuplicatingBackup(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDuplicateBackup}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors flex items-center"
              >
                <Copy className="w-4 h-4 mr-2" />
                Duplicate
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <BackupWizard
          onClose={() => {
            setShowCreateModal(false);
            setEditingBackup(null);
            setSelectedTemplate(null);
          }}
          onSuccess={handleWizardSuccess}
          editBackup={editingBackup}
          mode={selectedTemplate ? 'from-template' : 'production'}
          templateData={selectedTemplate}
        />
      )}

      {/* View Backup Details Modal */}
      {viewingBackup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center space-x-3">
                <FileText className="w-6 h-6 text-blue-600" />
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{viewingBackup.name}</h2>
                  {viewingBackup.description && (
                    <p className="text-sm text-gray-600 mt-0.5">{viewingBackup.description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setViewingBackup(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Status Section */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase mb-3">Status</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">State</p>
                    <div className="flex items-center space-x-2">
                      {viewingBackup.is_active ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-700">Active</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-500">Inactive</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Validation</p>
                    <div className="flex items-center space-x-2">
                      {viewingBackup.validation_status === 'valid' ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-700">Valid</span>
                        </>
                      ) : viewingBackup.validation_status === 'invalid' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-red-600" />
                          <span className="text-sm font-medium text-red-700">Invalid</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-500">Unknown</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {viewingBackup.validation_status === 'invalid' && viewingBackup.validation_error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                    <p className="text-xs font-mono text-red-700">{viewingBackup.validation_error}</p>
                  </div>
                )}
              </div>

              {/* Sources Section */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <Database className="w-5 h-5 text-blue-600" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase">
                    Sources ({viewingBackup.source_count})
                  </h3>
                </div>
                {viewingBackup.sources_summary && viewingBackup.sources_summary.length > 0 ? (
                  <div className="space-y-2">
                    {viewingBackup.sources_summary.map((source: any, idx: number) => (
                      <div key={idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded border border-gray-100">
                        <div className="flex-shrink-0">
                          {source.type === 'git_repos' ? (
                            <GitBranch className="w-4 h-4 text-purple-600 mt-0.5" />
                          ) : source.type === 'local' ? (
                            <FileText className="w-4 h-4 text-gray-600 mt-0.5" />
                          ) : (
                            <Database className="w-4 h-4 text-blue-600 mt-0.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-500 uppercase">
                            {source.type === 'git_repos' ? `Git (${source.platform})` : source.type}
                          </p>
                          <p className="text-sm text-gray-900 font-mono break-all">
                            {source.type === 'git_repos'
                              ? `${source.organization || source.group || source.workspace || source.user || source.repo_name || 'repos'} → ${source.target_dir || 'N/A'}`
                              : (source.path || source.name || source.database_name || 'N/A')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : viewingBackup.config?.location?.source_directories?.length > 0 ? (
                  <div className="space-y-2">
                    {viewingBackup.config.location.source_directories.map((dir: string, idx: number) => (
                      <div key={idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded border border-gray-100">
                        <FileText className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-500 uppercase">local</p>
                          <p className="text-sm text-gray-900 font-mono break-all">{dir}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No sources configured</p>
                )}
              </div>

              {/* Repositories Section */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <HardDrive className="w-5 h-5 text-green-600" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase">
                    Repositories ({viewingBackup.repository_count})
                  </h3>
                </div>
                {viewingBackup.repositories_summary && viewingBackup.repositories_summary.length > 0 ? (
                  <div className="space-y-2">
                    {viewingBackup.repositories_summary.map((repo: any, idx: number) => (
                      <div key={idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded border border-gray-100">
                        <HardDrive className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {repo.label && (
                            <p className="text-xs font-medium text-gray-500">{repo.label}</p>
                          )}
                          <p className="text-sm text-gray-900 font-mono break-all">{getSafeDisplayPath(repo.path)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : viewingBackup.config?.location?.repositories?.length > 0 ? (
                  <div className="space-y-2">
                    {viewingBackup.config.location.repositories.map((repo: any, idx: number) => (
                      <div key={idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded border border-gray-100">
                        <HardDrive className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {repo.label && (
                            <p className="text-xs font-medium text-gray-500">{repo.label}</p>
                          )}
                          <p className="text-sm text-gray-900 font-mono break-all">{getSafeDisplayPath(repo.path)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No repositories configured</p>
                )}
              </div>

              {/* Schedule Section */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <Calendar className="w-5 h-5 text-purple-600" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase">Schedule</h3>
                </div>
                {viewingBackup.schedule_id ? (
                  <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded border border-gray-100">
                    <Clock className="w-4 h-4 text-purple-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-900 font-medium">
                        {schedules.find((s: any) => s.id === viewingBackup.schedule_id)?.name || 'Scheduled'}
                      </p>
                      {schedules.find((s: any) => s.id === viewingBackup.schedule_id)?.cron_expression && (
                        <p className="text-xs text-gray-600 font-mono mt-1">
                          {schedules.find((s: any) => s.id === viewingBackup.schedule_id)?.cron_expression}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No schedule (manual only)</p>
                )}
              </div>

              {/* Retention Section */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <Clock className="w-5 h-5 text-orange-600" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase">Retention Policy</h3>
                </div>
                <p className="text-sm text-gray-900">
                  Profile: <span className="font-medium">{viewingBackup.retention_profile_id}</span>
                </p>
              </div>

              {/* Last Run Section */}
              {viewingBackup.last_run && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Clock className="w-5 h-5 text-purple-600" />
                    <h3 className="text-sm font-semibold text-gray-700 uppercase">Last Run</h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-900">
                      {formatDateTime(viewingBackup.last_run)}
                    </p>
                    {viewingBackup.last_run_status === 'success' ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        Success
                      </span>
                    ) : viewingBackup.last_run_status === 'warning' ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        Warning
                      </span>
                    ) : viewingBackup.last_run_status === 'running' ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                        Running
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase mb-3">Metadata</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Created</p>
                    <p className="text-gray-900">{formatDateTime(viewingBackup.created_at)}</p>
                  </div>
                  {viewingBackup.updated_at && (
                    <div>
                      <p className="text-xs text-gray-500">Updated</p>
                      <p className="text-gray-900">{formatDateTime(viewingBackup.updated_at)}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <button
                onClick={() => handleViewYaml(viewingBackup.id)}
                className="btn-secondary text-sm flex items-center space-x-1"
              >
                <FileText className="w-4 h-4" />
                <span>Show YAML Configuration</span>
              </button>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setViewingBackup(null);
                    handleEdit(viewingBackup);
                  }}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <Edit2 className="w-4 h-4" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => setViewingBackup(null)}
                  className="btn-primary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* YAML Configuration Modal */}
      {showYamlModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-[60] flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full m-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center space-x-3">
                <FileText className="w-6 h-6 text-gray-600" />
                <div>
                  <h2 className="text-xl font-bold text-gray-900">YAML Configuration</h2>
                  <p className="text-sm text-gray-500">Read-only view of the backup configuration file</p>
                </div>
              </div>
              <button
                onClick={() => setShowYamlModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 flex-1 overflow-auto">
              {yamlLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-3 text-gray-600">Loading configuration...</span>
                </div>
              ) : (
                <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto text-sm font-mono whitespace-pre">
                  {yamlContent}
                </pre>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <p className="text-xs text-gray-500">
                💡 To edit this configuration, use the{' '}
                <a href="/config" className="text-blue-600 hover:underline font-medium">YAML Editor</a>{' '}
                from the main menu.
              </p>
              <button
                onClick={() => setShowYamlModal(false)}
                className="btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Backups;
