import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { repositoriesAPI, archivesAPI, restoreAPI, dashboardAPI, backupsAPI } from '../services/api';
import type { AxiosResponse } from 'axios';
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Eye,
  Download,
  Trash2,
  HardDrive,
  Archive as ArchiveIcon,
  Clock,
  FolderOpen,
  FileText,
  X,
  Check,
  CheckSquare,
  Square,
  List,
  FolderTree,
  Folder,
  Search,
  KeyRound,
  Settings,
  AlertTriangle,
  Calendar,
  ArrowUpDown,
  GitBranch,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatDateTime } from '../utils/dateFormat';
import { getSafeDisplayPath } from '../utils/repositoryUtils';
import { ArchiveBrowserModal } from '../components/archives';
import RestoreOptionsModal from '../components/archives/RestoreOptionsModal';
import RestoreGitWizard from '../components/archives/RestoreGitWizard';

interface Repository {
  id: string;
  path: string;
  encryption: string;
  archives_count?: number;
  total_size?: string;
  last_archive?: string;
}

interface Archive {
  name: string;
  id: string;
  created: string;
  size: string;
  compressed_size: string;
  file_count: number;
  backup_job?: string; // backup job name (derived from archive name)
}

type TimeFilter = '7d' | '30d' | '90d' | 'all';

const TIME_FILTER_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All archives' },
];

const getTimeFilterDate = (filter: TimeFilter): Date | null => {
  if (filter === 'all') return null;
  const now = new Date();
  const days = parseInt(filter);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
};

const filterArchivesByTime = (archives: Archive[], filter: TimeFilter): Archive[] => {
  const cutoffDate = getTimeFilterDate(filter);
  if (!cutoffDate) return archives;
  return archives.filter(archive => new Date(archive.created) >= cutoffDate);
};

// Type for tracking active and completed restores
interface RestoreInfo {
  repoPath: string;
  archiveName: string;
  destination: string;
  destinationType: 'local' | 'download' | 'original';
}

interface CompletedRestore extends RestoreInfo {
  completedAt: Date;
}

// Map of archive name -> last completed restore info
type RestoreHistory = Record<string, CompletedRestore>;

const Archives = () => {
  const queryClient = useQueryClient();
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedBackupJobs, setExpandedBackupJobs] = useState<Set<string>>(new Set());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [archiveDetails, setArchiveDetails] = useState<Record<string, any>>({});
  const [viewingArchive, setViewingArchive] = useState<{ repoId: string; archiveName: string } | null>(null);
  const [restoringArchive, setRestoringArchive] = useState<{ repoPath: string; archiveName: string; selectedFiles?: string[] } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [passphraseModal, setPassphraseModal] = useState<{ repoId: string; repoPath: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [savingPassphrase, setSavingPassphrase] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('7d');
  const [archiveSortOrder, setArchiveSortOrder] = useState<'desc' | 'asc'>('desc');
  
  // Git restore wizard
  const [gitRestoreTarget, setGitRestoreTarget] = useState<{ repoPath: string; archiveName: string } | null>(null);

  // Track active restore operation
  const [activeRestore, setActiveRestore] = useState<RestoreInfo | null>(null);
  // Track last completed restore per archive (keyed by archiveName)
  const [restoreHistory, setRestoreHistory] = useState<RestoreHistory>({});

  // Load restore history from backend
  const { data: savedHistoryData } = useQuery({
    queryKey: ['restore-history'],
    queryFn: () => restoreAPI.getHistory(),
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  // Sync saved history to local state on load
  useEffect(() => {
    if (savedHistoryData?.data?.data) {
      const savedHistory = savedHistoryData.data.data as Record<string, {
        repoPath: string;
        destination: string;
        destinationType: 'local' | 'download' | 'original';
        completedAt: string;
      }>;
      // Convert ISO date strings to Date objects
      const converted: RestoreHistory = {};
      for (const [archiveName, info] of Object.entries(savedHistory)) {
        converted[archiveName] = {
          ...info,
          archiveName,
          completedAt: new Date(info.completedAt),
        };
      }
      setRestoreHistory(converted);
    }
  }, [savedHistoryData]);

  // Handle refresh - invalidate all queries and show loading state
  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Invalidate repositories query (fast list)
    await queryClient.invalidateQueries({ queryKey: ['repositories-list'] });
    // Invalidate all archives queries
    await queryClient.invalidateQueries({ queryKey: ['archives'] });
    // Clear cached archive details
    setArchiveDetails({});
    setIsRefreshing(false);
  };

  // Toggle backup job group expansion
  const toggleBackupJob = (repoPath: string, backupJobName: string) => {
    const key = `${repoPath}::${backupJobName}`;
    setExpandedBackupJobs(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Load details for archives in a backup job group
  // Limits to most recent 5 archives and runs sequentially for remote repos to avoid lock contention
  const loadBackupJobDetails = async (repoPath: string, archives: Archive[]) => {
    const key = `${repoPath}::${archives[0].backup_job}`;
    setLoadingDetails(prev => new Set(prev).add(key));

    // Auto-expand the section when loading details
    setExpandedBackupJobs(prev => new Set(prev).add(key));

    // Limit to most recent 5 archives to avoid slow loading
    const MAX_ARCHIVES_TO_LOAD = 5;
    const archivesToLoad = archives
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, MAX_ARCHIVES_TO_LOAD);

    // Check if this is a remote repository (S3, SSH, etc.)
    // Remote repos need sequential requests to avoid lock contention
    const isRemoteRepo = repoPath.startsWith('s3:') || 
                         repoPath.startsWith('ssh://') || 
                         repoPath.startsWith('rclone:');

    try {
      const detailsMap: Record<string, any> = {};

      if (isRemoteRepo) {
        // Sequential loading for remote repos to avoid lock contention
        for (const archive of archivesToLoad) {
          try {
            const response = await archivesAPI.getArchiveInfo(repoPath, archive.name);
            detailsMap[archive.name] = {
              name: archive.name,
              ...response.data.data
            };
            // Update state progressively so user sees results as they load
            setArchiveDetails(prev => ({ ...prev, [archive.name]: detailsMap[archive.name] }));
          } catch (error) {
            console.error(`Failed to load details for ${archive.name}:`, error);
          }
        }
      } else {
        // Parallel loading for local repos (fast, no lock issues)
        const details = await Promise.all(
          archivesToLoad.map(async (archive) => {
            try {
              const response = await archivesAPI.getArchiveInfo(repoPath, archive.name);
              return {
                name: archive.name,
                ...response.data.data
              };
            } catch (error) {
              console.error(`Failed to load details for ${archive.name}:`, error);
              return null;
            }
          })
        );

        details.forEach(detail => {
          if (detail) {
            detailsMap[detail.name] = detail;
          }
        });
        setArchiveDetails(prev => ({ ...prev, ...detailsMap }));
      }
    } finally {
      setLoadingDetails(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Get all repositories (fast - no borg info)
  const { data: reposData, isLoading: loadingRepos } = useQuery({
    queryKey: ['repositories-list'],
    queryFn: () => repositoriesAPI.getRepositoriesFast().then(res => res.data),
    // Fast endpoint - just reads config, doesn't run borg commands
  });

  // Get tools health to check Borg version
  const { data: toolsHealth } = useQuery({
    queryKey: ['tools-health'],
    queryFn: () => dashboardAPI.getToolsHealth().then(res => res.data.data),
    staleTime: 300000, // 5 minutes
  });

  const { data: backupsData } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsAPI.getBackups().then(res => res.data),
    staleTime: 60000,
  });

  const gitBackupJobNames = useMemo(() => {
    const raw = backupsData?.data?.backups ?? backupsData?.data ?? [];
    const backups = Array.isArray(raw) ? raw : [];
    const set = new Set<string>();
    for (const b of backups) {
      const hasGit = (b.sources_summary || []).some((s: any) => s.type === 'git_repos');
      if (hasGit && b.name) set.add(String(b.name).toLowerCase());
    }
    return set;
  }, [backupsData]);

  // Fallback: when multiple backup jobs share the same borg repo with the
  // same archive_name_format, we can't tell from an archive name alone which
  // job created it. Remember the borg repo paths that host AT LEAST ONE Git
  // backup, so we can still offer the Git Restore button on every archive in
  // those repositories. The wizard scans the archive itself and will show an
  // empty state if no Git content is present - no harm done.
  const gitBackupRepoPaths = useMemo(() => {
    const raw = backupsData?.data?.backups ?? backupsData?.data ?? [];
    const backups = Array.isArray(raw) ? raw : [];
    const set = new Set<string>();
    for (const b of backups) {
      const hasGit = (b.sources_summary || []).some((s: any) => s.type === 'git_repos');
      if (!hasGit) continue;
      const repos = b.repositories_summary || b.config?.repositories || [];
      for (const r of repos) {
        const p = typeof r === 'string' ? r : r?.path;
        if (p) set.add(String(p));
      }
    }
    return set;
  }, [backupsData]);

  const borgVersion = toolsHealth?.tools?.borg?.version || '';
  const isBorg2 = borgVersion.startsWith('2.');

  const repositories = reposData?.data?.repositories || [];

  // Toggle repository expansion
  const toggleRepo = (repoId: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  };

  // Get archives for a specific repository
  const useArchivesQuery = (repoPath: string) => useQuery({
    queryKey: ['archives', repoPath],
    queryFn: () => {
      console.log(`📚 [Frontend] Fetching archives for: "${repoPath}"`);
      return archivesAPI.listArchives(repoPath).then(res => {
        console.log(`✅ [Frontend] Archives fetched successfully`);
        return res.data;
      }).catch(err => {
        console.error(`❌ [Frontend] Archives fetch failed:`, err.response?.data || err.message);
        throw err;
      });
    },
    enabled: expandedRepos.has(repoPath),
    retry: 1, // Retry once on error
    retryDelay: 1000, // Wait 1 second before retrying
    refetchOnWindowFocus: false, // Don't refetch on window focus
    staleTime: 60000, // Consider data fresh for 1 minute
  });

  if (loadingRepos) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p className="text-sm text-gray-600">Loading repositories...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">View/Restore Archives</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse archives stored in your repositories. Each archive is a snapshot created by your backup jobs.
            Select archives to view contents or restore files.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Time Filter Dropdown */}
          <div className="relative">
            <div className="flex items-center">
              <Calendar className="w-4 h-4 text-gray-500 mr-2" />
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
                className="appearance-none bg-white border border-gray-300 rounded-md py-2 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                {TIME_FILTER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 -ml-6 pointer-events-none" />
            </div>
          </div>
          <button
            onClick={() => setArchiveSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="btn-secondary flex items-center space-x-2"
            title={archiveSortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>Order</span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || loadingRepos}
            className="btn-secondary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || loadingRepos ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Restore Status Banner */}
      {activeRestore && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center space-x-3">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
          <div>
            <p className="text-sm font-medium text-blue-800">
              Restoring from <span className="font-mono">{activeRestore.archiveName}</span>...
            </p>
            <p className="text-xs text-blue-600">
              {activeRestore.destinationType === 'download' 
                ? 'Downloading to browser' 
                : activeRestore.destinationType === 'original'
                  ? 'Restoring to original location'
                  : `Restoring to ${activeRestore.destination}`
              }
            </p>
          </div>
        </div>
      )}

      {/* Repositories List */}
      {repositories.length === 0 ? (
        <div className="card text-center py-12">
          <HardDrive className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No repositories found</h3>
          <p className="mt-1 text-sm text-gray-500">
            Create a repository first to start backing up your data.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {repositories.map((repo: Repository) => (
            <RepositoryCard
              key={repo.path}
              repository={repo}
              expanded={expandedRepos.has(repo.path)}
              onToggle={() => toggleRepo(repo.path)}
              getArchivesQuery={useArchivesQuery}
              expandedBackupJobs={expandedBackupJobs}
              onToggleBackupJob={toggleBackupJob}
              loadingDetails={loadingDetails}
              archiveDetails={archiveDetails}
              onLoadDetails={loadBackupJobDetails}
              onViewArchive={(archiveName) => setViewingArchive({ repoId: repo.path, archiveName })}
              onRestoreArchive={(archiveName) => setRestoringArchive({ repoPath: repo.path, archiveName })}
              onGitRestore={(archiveName) => setGitRestoreTarget({ repoPath: repo.path, archiveName })}
              isGitBackupJob={(backupJobName) =>
                gitBackupJobNames.has(String(backupJobName).toLowerCase()) ||
                gitBackupRepoPaths.has(repo.path)
              }
              onEnterPassphrase={() => setPassphraseModal({ repoId: repo.id, repoPath: repo.path })}
              isBorg2={isBorg2}
              timeFilter={timeFilter}
              archiveSortOrder={archiveSortOrder}
              activeRestore={activeRestore}
              restoreHistory={restoreHistory}
            />
          ))}
        </div>
      )}

      {/* Enhanced Archive Browser Modal */}
      {viewingArchive && (
        <ArchiveBrowserModal
          isOpen={true}
          repositoryPath={viewingArchive.repoId}
          archiveName={viewingArchive.archiveName}
          onClose={() => setViewingArchive(null)}
          onRestore={(files) => {
            setViewingArchive(null);
            setRestoringArchive({ repoPath: viewingArchive.repoId, archiveName: viewingArchive.archiveName, selectedFiles: files });
          }}
          onRestoreStart={(info) => {
            setViewingArchive(null);
            setRestoringArchive(null);
            setActiveRestore(info);
          }}
          onRestoreComplete={(info) => {
            setActiveRestore(null);
            const completedRestore = { ...info, completedAt: new Date() };
            setRestoreHistory(prev => ({
              ...prev,
              [info.archiveName]: completedRestore
            }));
            // Persist to backend
            restoreAPI.recordHistory({
              archiveName: info.archiveName,
              repoPath: info.repoPath,
              destination: info.destination,
              destinationType: info.destinationType,
            }).catch(err => console.warn('Failed to save restore history:', err));
          }}
        />
      )}

      {restoringArchive && (
        <RestoreOptionsModal
          isOpen={true}
          repositoryPath={restoringArchive.repoPath}
          archiveName={restoringArchive.archiveName}
          selectedPaths={restoringArchive.selectedFiles || []}
          onClose={() => setRestoringArchive(null)}
          onRestoreStart={(info) => {
            // Close all modals and show restoring indicator
            setRestoringArchive(null);
            setViewingArchive(null);
            setActiveRestore(info);
          }}
          onRestoreComplete={(info) => {
            // Clear active restore and save to history
            setActiveRestore(null);
            const completedRestore = { ...info, completedAt: new Date() };
            setRestoreHistory(prev => ({
              ...prev,
              [info.archiveName]: completedRestore
            }));
            // Persist to backend
            restoreAPI.recordHistory({
              archiveName: info.archiveName,
              repoPath: info.repoPath,
              destination: info.destination,
              destinationType: info.destinationType,
            }).catch(err => console.warn('Failed to save restore history:', err));
          }}
        />
      )}

      {/* Git Restore Wizard */}
      <RestoreGitWizard
        isOpen={!!gitRestoreTarget}
        onClose={() => setGitRestoreTarget(null)}
        repositoryPath={gitRestoreTarget?.repoPath || ''}
        archiveName={gitRestoreTarget?.archiveName || ''}
      />

      {/* Passphrase Input Modal */}
      {passphraseModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-md shadow-lg rounded-md bg-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <KeyRound className="w-5 h-5 mr-2 text-yellow-600" />
                Enter Repository Passphrase
              </h3>
              <button
                onClick={() => {
                  setPassphraseModal(null);
                  setPassphrase('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              This repository is encrypted but the passphrase is not stored.
              Please enter the passphrase to access the archives.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Repository Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter passphrase"
                autoFocus
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setPassphraseModal(null);
                  setPassphrase('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!passphrase.trim()) {
                    toast.error('Please enter a passphrase');
                    return;
                  }

                  setSavingPassphrase(true);
                  try {
                    await repositoriesAPI.updatePassphrase(passphraseModal.repoId, passphrase, true);
                    toast.success('Passphrase saved successfully');
                    setPassphraseModal(null);
                    setPassphrase('');
                    // Refresh archives for this repository
                    queryClient.invalidateQueries({ queryKey: ['archives', passphraseModal.repoPath] });
                    // Also refresh repositories list to update encryption info
                    queryClient.invalidateQueries({ queryKey: ['repositories-list'] });
                    queryClient.invalidateQueries({ queryKey: ['repositories'] });
                  } catch (err: any) {
                    const errorData = err.response?.data;
                    if (errorData?.error === 'passphrase_invalid') {
                      toast.error('Invalid passphrase. Please check and try again.');
                    } else {
                      toast.error(errorData?.detail || 'Failed to save passphrase');
                    }
                  } finally {
                    setSavingPassphrase(false);
                  }
                }}
                disabled={savingPassphrase || !passphrase.trim()}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center"
              >
                {savingPassphrase && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                {savingPassphrase ? 'Verifying...' : 'Save & Verify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Repository Card Component
const INITIAL_ARCHIVES_LIMIT = 5;

const RepositoryCard = ({
  repository,
  expanded,
  onToggle,
  getArchivesQuery: useArchivesQuery,
  expandedBackupJobs,
  onToggleBackupJob,
  loadingDetails,
  archiveDetails,
  onLoadDetails,
  onViewArchive,
  onRestoreArchive,
  onGitRestore,
  isGitBackupJob,
  onEnterPassphrase,
  isBorg2 = false,
  timeFilter = '7d',
  archiveSortOrder = 'desc',
  activeRestore,
  restoreHistory = {},
}: {
  repository: Repository & { name?: string; label?: string };
  expanded: boolean;
  onToggle: () => void;
  getArchivesQuery: (repoPath: string) => any;
  expandedBackupJobs: Set<string>;
  onToggleBackupJob: (repoPath: string, backupJobName: string) => void;
  loadingDetails: Set<string>;
  archiveDetails: Record<string, any>;
  onLoadDetails: (repoPath: string, archives: Archive[]) => Promise<void>;
  onViewArchive: (archiveName: string) => void;
  onRestoreArchive: (archiveName: string) => void;
  onGitRestore: (archiveName: string) => void;
  isGitBackupJob: (backupJobName: string) => boolean;
  onEnterPassphrase: () => void;
  isBorg2?: boolean;
  timeFilter?: TimeFilter;
  archiveSortOrder?: 'desc' | 'asc';
  activeRestore?: RestoreInfo | null;
  restoreHistory?: RestoreHistory;
}) => {
  const [showAllArchives, setShowAllArchives] = useState<Set<string>>(new Set());
  const { data: archivesData, isLoading: loadingArchives, error: archivesError } = useArchivesQuery(repository.path);
  const allArchives = archivesData?.data?.archives || [];

  // Apply time filter
  const archives = filterArchivesByTime(allArchives, timeFilter);

  // Check if error is passphrase-related
  const errorData = (archivesError as any)?.response?.data;
  const requiresPassphrase = errorData?.requires_passphrase ||
    (errorData?.error && (
      errorData.error.includes('passphrase') ||
      errorData.error.includes('timed out') ||
      errorData.error.includes('encrypted')
    ));

  // Group and sort archives by backup job (memoized to ensure React detects changes)
  const groupedArchives = useMemo(() => {
    // Group archives by backup job
    const grouped = archives.reduce((acc: Record<string, Archive[]>, archive: Archive) => {
      const jobName = archive.backup_job || 'Unknown';
      if (!acc[jobName]) {
        acc[jobName] = [];
      }
      acc[jobName].push(archive);
      return acc;
    }, {});

    // Sort archives within each group by date (configurable order) - create new arrays
    const sorted: Record<string, Archive[]> = {};
    Object.entries(grouped).forEach(([jobName, group]) => {
      sorted[jobName] = [...group].sort((a, b) => {
        const diff = new Date(b.created).getTime() - new Date(a.created).getTime();
        return archiveSortOrder === 'desc' ? diff : -diff;
      });
    });

    return sorted;
  }, [archives, archiveSortOrder]);

  return (
    <div className="card overflow-hidden">
      {/* Repository Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center space-x-4 flex-1 min-w-0">
          <button className="p-1 hover:bg-gray-200 rounded">
            {expanded ? (
              <ChevronDown className="w-5 h-5 text-gray-600" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-600" />
            )}
          </button>

          <HardDrive className="w-6 h-6 text-green-600" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-semibold text-gray-900 truncate">
                {repository.name || repository.label || 'Unnamed Repository'}
              </h3>
              {/* Show spinner in header when loading archives */}
              {expanded && loadingArchives && (
                <div className="flex items-center space-x-1 text-blue-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Loading...</span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-500 break-all mt-0.5" title={getSafeDisplayPath(repository.path)}>
              {getSafeDisplayPath(repository.path)}
            </p>
            <div className="flex items-center space-x-4 mt-1 text-xs text-gray-500">
              <span className="flex items-center">
                <span className="font-medium text-gray-600">Encryption:</span>
                <span className="ml-1">{repository.encryption || 'none'}</span>
              </span>
              {repository.archives_count !== undefined && (
                <span className="flex items-center">
                  <ArchiveIcon className="w-3 h-3 mr-1" />
                  {repository.archives_count} {repository.archives_count === 1 ? 'archive' : 'archives'}
                </span>
              )}
              {repository.total_size && (
                <span className="flex items-center">
                  <span className="font-medium text-gray-600">Size:</span>
                  <span className="ml-1">{repository.total_size}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Archives List (Expanded) */}
      {expanded && (
        <div className="border-t border-gray-200">
          {loadingArchives ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-600">Loading archives...</p>
            </div>
          ) : archivesError ? (
            <div className="p-6 text-center">
              {requiresPassphrase ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md mx-auto">
                  <div className="flex items-center justify-center mb-3">
                    <KeyRound className="w-8 h-8 text-yellow-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-yellow-800 mb-2">Passphrase Required</h4>
                  <p className="text-sm text-yellow-700 mb-3">
                    This repository is encrypted but the passphrase is not stored.
                    Enter the passphrase to access the archives.
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnterPassphrase();
                    }}
                    className="inline-flex items-center px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors text-sm font-medium"
                  >
                    <KeyRound className="w-4 h-4 mr-2" />
                    Enter Passphrase
                  </button>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-md mx-auto">
                  <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                  <h4 className="text-lg font-semibold text-red-800 mb-2">Failed to Load Archives</h4>
                  <p className="text-sm text-red-700">
                    {errorData?.error || 'An error occurred while loading archives.'}
                  </p>
                  {errorData?.details && (
                    <p className="text-xs text-red-600 mt-2">{errorData.details}</p>
                  )}
                </div>
              )}
            </div>
          ) : archives.length === 0 ? (
            <div className="p-8 text-center">
              <ArchiveIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">
                {allArchives.length > 0
                  ? `No archives within the selected time range (${allArchives.length} total archives in repository)`
                  : 'No archives found in this repository'}
              </p>
              {allArchives.length > 0 && timeFilter !== 'all' && (
                <p className="text-xs text-gray-500 mt-1">
                  Try selecting a longer time range or "All archives"
                </p>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {Object.entries(groupedArchives)
                // Sort groups by their latest archive date (based on sort order)
                .sort(([, groupA], [, groupB]) => {
                  const latestA = groupA[0]?.created ? new Date(groupA[0].created).getTime() : 0;
                  const latestB = groupB[0]?.created ? new Date(groupB[0].created).getTime() : 0;
                  const diff = latestB - latestA;
                  return archiveSortOrder === 'desc' ? diff : -diff;
                })
                .map(([backupJobName, jobArchives]) => {
                  const key = `${repository.path}::${backupJobName}`;
                  const isExpanded = expandedBackupJobs.has(key);
                  const isLoadingDetails = loadingDetails.has(key);
                  const hasDetails = jobArchives.some((arc: Archive) => archiveDetails[arc.name]);

                  return (
                    <div key={backupJobName} className="border-b border-gray-200">
                      {/* Backup Job Group Header */}
                      <div className="flex items-center justify-between p-3 bg-gray-50">
                        <div
                          className="flex items-center space-x-3 flex-1 cursor-pointer hover:bg-gray-100 -m-3 p-3 rounded-l transition-colors"
                          onClick={() => onToggleBackupJob(repository.path, backupJobName)}
                        >
                          <button className="p-1">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-600" />
                            )}
                          </button>

                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 text-sm font-semibold bg-blue-100 text-blue-800 rounded">
                              {backupJobName}
                            </span>
                            <span className="text-sm text-gray-600">
                              {jobArchives.length} {jobArchives.length === 1 ? 'archive' : 'archives'}
                            </span>
                          </div>

                          <div className="text-xs text-gray-500 ml-4">
                            Latest: {formatDateTime(
                              jobArchives.reduce((latest, current) => {
                                return new Date(current.created) > new Date(latest.created) ? current : latest;
                              }, jobArchives[0]).created
                            )}
                          </div>
                        </div>

                        {!hasDetails && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onLoadDetails(repository.path, jobArchives as Archive[]);
                            }}
                            disabled={isLoadingDetails}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                          >
                            {isLoadingDetails ? 'Loading...' : 'Load size & files'}
                          </button>
                        )}
                      </div>

                      {/* Archives in this group */}
                      {isExpanded && (() => {
                        const isShowingAll = showAllArchives.has(key);
                        const displayedArchives = isShowingAll
                          ? jobArchives
                          : jobArchives.slice(0, INITIAL_ARCHIVES_LIMIT);
                        const hasMore = jobArchives.length > INITIAL_ARCHIVES_LIMIT;
                        const hiddenCount = jobArchives.length - INITIAL_ARCHIVES_LIMIT;

                        return (
                          <div className="divide-y divide-gray-100 bg-white">
                            {displayedArchives.map((archive: Archive) => (
                              <ArchiveRow
                                key={archive.name}
                                archive={archive}
                                repoPath={repository.path}
                                details={archiveDetails[archive.name]}
                                onView={() => onViewArchive(archive.name)}
                                onRestore={() => onRestoreArchive(archive.name)}
                                onGitRestore={isGitBackupJob(backupJobName) ? () => onGitRestore(archive.name) : undefined}
                                compact={true}
                                isBorg2={isBorg2}
                                isRestoring={activeRestore?.archiveName === archive.name}
                                lastRestore={restoreHistory[archive.name]}
                              />
                            ))}
                            {hasMore && (
                              <div className="p-3 bg-gray-50 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAllArchives(prev => {
                                      const next = new Set(prev);
                                      if (isShowingAll) {
                                        next.delete(key);
                                      } else {
                                        next.add(key);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  {isShowingAll
                                    ? 'Show less'
                                    : `Show ${hiddenCount} more archive${hiddenCount > 1 ? 's' : ''}`}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              {/* Summary footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 py-2 text-xs text-gray-600 text-center">
                <span className="font-medium">{archives.length}</span> archives shown
                {timeFilter !== 'all' && allArchives.length !== archives.length && (
                  <span className="text-gray-500"> ({allArchives.length} total)</span>
                )}
                {' '}in {Object.keys(groupedArchives).length} backup {Object.keys(groupedArchives).length === 1 ? 'job' : 'jobs'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Archive Row Component
const ArchiveRow = ({
  archive,
  repoPath,
  details,
  onView,
  onRestore,
  onGitRestore,
  compact = false,
  isBorg2 = false,
  isRestoring = false,
  lastRestore,
}: {
  archive: Archive;
  repoPath: string;
  details?: any;
  onView: () => void;
  onRestore: () => void;
  onGitRestore?: () => void;
  compact?: boolean;
  isBorg2?: boolean;
  isRestoring?: boolean;
  lastRestore?: CompletedRestore;
}) => {
  const queryClient = useQueryClient();

  const deleteArchiveMutation = useMutation({
    mutationFn: () => archivesAPI.deleteArchive(repoPath, archive.name),
    onSuccess: () => {
      let msg = 'Archive deleted successfully';
      if (isBorg2) {
        msg += '. Remember to run "Compact" in Repositories to free up disk space.';
      }
      toast.success(msg, { duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ['archives', repoPath] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete archive');
    },
  });

  const handleDelete = () => {
    const backupJobName = archive.backup_job || 'Unknown backup';
    const timestamp = archive.created ? formatDateTime(archive.created) : 'Unknown date';

    let message = `Delete archive from backup job "${backupJobName}"?\n\n` +
      `Created: ${timestamp}\n\n` +
      `This action cannot be undone!`;

    if (isBorg2) {
      message += `\n\nNote: In Borg 2.0, space is not freed until you run "Compact" on the repository.`;
    }

    if (window.confirm(message)) {
      deleteArchiveMutation.mutate();
    }
  };

  // Format the last restore info for display
  const getRestoreText = (restore: CompletedRestore) => {
    const timeStr = restore.completedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = restore.completedAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    switch (restore.destinationType) {
      case 'download':
        return `Downloaded on ${dateStr} at ${timeStr}`;
      case 'original':
        return `Restored to original on ${dateStr} at ${timeStr}`;
      default:
        return `Restored to ${restore.destination} on ${dateStr} at ${timeStr}`;
    }
  };

  return (
    <div className={`${compact ? 'p-3 pl-12' : 'p-4'} hover:bg-gray-50 transition-colors`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1 min-w-0">
          {!compact && <ArchiveIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />}

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h4 className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-700 truncate`} title={archive.name}>
                {archive.name}
              </h4>
              {isRestoring && (
                <div className="flex items-center space-x-1 text-blue-600">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                  <span className="text-xs">Restoring...</span>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-4 mt-1 text-xs text-gray-600">
              <span className="flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {formatDateTime(archive.created)}
              </span>
              {details && (
                <>
                  <span>Size: {details.size || details.compressed_size}</span>
                  {details.file_count > 0 && <span>{details.file_count} files</span>}
                </>
              )}
            </div>

            {/* Last restore info */}
            {lastRestore && !isRestoring && (
              <div className="mt-1 text-xs text-green-600 flex items-center space-x-1">
                <Check className="w-3 h-3" />
                <span>{getRestoreText(lastRestore)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2 ml-4">
          <button
            onClick={onView}
            disabled={isRestoring}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors flex items-center space-x-1 disabled:opacity-50"
            title="View files in archive"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Explorer</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRestore();
            }}
            disabled={isRestoring}
            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded transition-colors flex items-center space-x-1 disabled:opacity-50"
            title="Restore files from archive"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Restore</span>
          </button>
          {onGitRestore && (
            <button
              onClick={(e) => { e.stopPropagation(); onGitRestore(); }}
              disabled={isRestoring}
              className="px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded transition-colors flex items-center space-x-1 disabled:opacity-50"
              title="Restore git repos to a platform (GitHub, GitLab, etc.)"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Git Restore</span>
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleteArchiveMutation.isLoading || isRestoring}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
            title="Delete archive"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// View Archive Modal (File Browser)
const ViewArchiveModal = ({
  repoId,
  archiveName,
  onClose,
  onRestore
}: {
  repoId: string;
  archiveName: string;
  onClose: () => void;
  onRestore: (files: string[]) => void;
}) => {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('tree');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));

  const { data: filesData, isLoading } = useQuery({
    queryKey: ['archive-files', repoId, archiveName],
    queryFn: () => archivesAPI.getArchiveFiles(repoId, archiveName).then(res => res.data),
  });

  const files = filesData?.data?.files || [];

  // Build tree structure from flat file list
  const buildTree = (files: any[]) => {
    const tree: any = {};

    files.forEach((file: any) => {
      const parts = file.path.split('/').filter((p: string) => p);
      let current = tree;

      parts.forEach((part: string, index: number) => {
        if (!current[part]) {
          current[part] = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
            type: index === parts.length - 1 ? file.type : 'directory',
            size: index === parts.length - 1 ? file.size : null,
            children: {}
          };
        }
        current = current[part].children;
      });
    });

    return tree;
  };

  const fileTree = buildTree(files);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const toggleFile = (filePath: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map((f: any) => f.path)));
    }
    setSelectAll(!selectAll);
  };

  const handleRestore = () => {
    if (selectedFiles.size === 0) {
      toast.error('Please select at least one file or folder to restore');
      return;
    }
    onRestore(Array.from(selectedFiles));
    onClose();
  };

  const handleDownloadSingle = async (filePath: string) => {
    try {
      const loadingToast = toast.loading('Preparing download...');
      const response = await restoreAPI.downloadFile(repoId, archiveName, filePath);

      // Get filename from Content-Disposition header, or fallback to path-based name
      let filename = filePath.split('/').pop() || 'download';
      const contentDisposition = response.headers?.['content-disposition'];
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      // If content-type is zip and filename doesn't have .zip, add it
      const contentType = response.headers?.['content-type'];
      if (contentType === 'application/zip' && !filename.endsWith('.zip')) {
        filename += '.zip';
      }

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.dismiss(loadingToast);
      toast.success(`Downloaded: ${filename}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to download file');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <ArchiveIcon className="w-6 h-6 text-blue-600" />
              <div>
                <h2 className="text-lg font-bold text-gray-900">Archive Contents</h2>
                <p className="text-sm text-gray-600">{archiveName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('tree')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm transition-colors ${viewMode === 'tree'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              <FolderTree className="w-4 h-4" />
              <span>Tree View</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm transition-colors ${viewMode === 'list'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              <List className="w-4 h-4" />
              <span>List View</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <p className="ml-3 text-gray-600">Loading archive contents...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">No files found in this archive</p>
            </div>
          ) : (
            <>
              {/* Select All */}
              <div className="flex items-center space-x-2 p-2 mb-2 bg-gray-100 rounded sticky top-0 z-10">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center space-x-2 text-sm text-gray-700 hover:text-gray-900"
                >
                  {selectAll ? (
                    <CheckSquare className="w-5 h-5 text-blue-600" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                  <span className="font-medium">Select All</span>
                </button>
                {selectedFiles.size > 0 && (
                  <span className="text-sm text-gray-600 ml-auto">
                    {selectedFiles.size} selected
                  </span>
                )}
              </div>

              {viewMode === 'tree' ? (
                <TreeView
                  tree={fileTree}
                  level={0}
                  selectedFiles={selectedFiles}
                  expandedFolders={expandedFolders}
                  onToggleFile={toggleFile}
                  onToggleFolder={toggleFolder}
                  onDownload={handleDownloadSingle}
                />
              ) : (
                <div className="space-y-1">
                  {files.map((file: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 hover:bg-gray-50 rounded group"
                    >
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <button
                          onClick={() => toggleFile(file.path)}
                          className="flex-shrink-0"
                        >
                          {selectedFiles.has(file.path) ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                        {file.type === 'directory' ? (
                          <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-900 font-mono truncate">{file.path}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {file.size && (
                          <span className="text-sm text-gray-500">{file.size}</span>
                        )}
                        {file.type === 'file' && selectedFiles.has(file.path) && selectedFiles.size === 1 && (
                          <button
                            onClick={() => handleDownloadSingle(file.path)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Download to browser"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {files.length} {files.length === 1 ? 'item' : 'items'}
          </p>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleRestore}
              disabled={selectedFiles.size === 0}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span>Restore Selected ({selectedFiles.size})</span>
            </button>
            <button onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tree View Component
const TreeView = ({
  tree,
  level,
  selectedFiles,
  expandedFolders,
  onToggleFile,
  onToggleFolder,
  onDownload,
  parentPath: _parentPath = ''
}: {
  tree: any;
  level: number;
  selectedFiles: Set<string>;
  expandedFolders: Set<string>;
  onToggleFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onDownload: (path: string) => void;
  parentPath?: string;
}) => {
  const entries = Object.entries(tree).sort(([, a]: any, [, b]: any) => {
    // Sort: directories first, then files; alphabetically within each group
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-0.5">
      {entries.map(([_key, node]: any) => {
        const isFolder = node.type === 'directory' || Object.keys(node.children).length > 0;
        const isExpanded = expandedFolders.has(node.path);
        const isSelected = selectedFiles.has(node.path);
        const paddingLeft = `${level * 1.5}rem`;

        return (
          <div key={node.path}>
            <div
              className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded group"
              style={{ paddingLeft }}
            >
              <div className="flex items-center space-x-2 flex-1 min-w-0">
                {isFolder && (
                  <button
                    onClick={() => onToggleFolder(node.path)}
                    className="flex-shrink-0 p-0.5 hover:bg-gray-200 rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-600" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-600" />
                    )}
                  </button>
                )}

                {!isFolder && (
                  <button
                    onClick={() => onToggleFile(node.path)}
                    className="flex-shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                )}

                {isFolder ? (
                  <Folder className={`w-4 h-4 flex-shrink-0 ${isExpanded ? 'text-blue-600' : 'text-blue-500'}`} />
                ) : (
                  <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                )}

                <span
                  className={`text-sm font-mono truncate ${isFolder ? 'font-medium text-gray-800' : 'text-gray-700'}`}
                  title={node.name}
                >
                  {node.name}
                </span>
              </div>

              <div className="flex items-center space-x-2 ml-4">
                {node.size && (
                  <span className="text-xs text-gray-500">{node.size}</span>
                )}
                {!isFolder && isSelected && selectedFiles.size === 1 && (
                  <button
                    onClick={() => onDownload(node.path)}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Download to browser"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {isFolder && isExpanded && Object.keys(node.children).length > 0 && (
              <TreeView
                tree={node.children}
                level={level + 1}
                selectedFiles={selectedFiles}
                expandedFolders={expandedFolders}
                onToggleFile={onToggleFile}
                onToggleFolder={onToggleFolder}
                onDownload={onDownload}
                parentPath={node.path}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default Archives;
