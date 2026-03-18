import React, { useState } from 'react';
import {
  Plus,
  Database,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Edit2,
  Eye,
  Trash2,
  RefreshCw,
  Scissors,
  HardDrive,
  Archive,
  XCircle,
  X,
  Loader2,
  Lock,
  Unlock,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useQueryClient } from 'react-query';
import { useAuth } from '../hooks/useAuth';
import { Repository } from '../types/repositories';
import { useRepositories, useSSHKeys, useRepositoryMutations } from '../hooks/useRepositories';
import { repositoriesAPI } from '../services/api';
import {
  DeleteRepositoryModal,
  ViewRepositoryModal,
  RepositoryCard,
  CreateRepositoryModal,
  EditRepositoryModal,
  PruneModal,
} from '../components/repositories';
import { CheckResult } from '../components/repositories/RepositoryCard';
import PassphraseVerifyModal from '../components/repositories/PassphraseVerifyModal';

const Repositories: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [viewingRepoPath, setViewingRepoPath] = useState<string | null>(null);
  const [deletingRepo, setDeletingRepo] = useState<Repository | null>(null);
  const [pruningRepo, setPruningRepo] = useState<Repository | null>(null);

  // Passphrase verification state
  const [passphraseRepo, setPassphraseRepo] = useState<Repository | null>(null);
  const [passphraseMessage, setPassphraseMessage] = useState<string>('');
  const [verifyingPassphrase, setVerifyingPassphrase] = useState(false);

  // View mode state
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());

  // Check result state - tracks result per repository
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});
  const [checkingRepoId, setCheckingRepoId] = useState<number | null>(null);

  // Load stats state - tracks loading and loaded stats per repository
  const [loadingStats, setLoadingStats] = useState<Set<string>>(new Set());
  const [repoStats, setRepoStats] = useState<Record<string, { archive_count: number; total_size: string | null; last_backup: string | null }>>({});

  // Break lock state - tracks which repo is being unlocked
  const [breakingLockRepoId, setBreakingLockRepoId] = useState<string | number | null>(null);

  // Toggle expanded state for repository in list view
  const toggleRepoExpanded = (repoPath: string) => {
    setExpandedRepos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(repoPath)) {
        newSet.delete(repoPath);
      } else {
        newSet.add(repoPath);
      }
      return newSet;
    });
  };

  // Use extracted hooks
  const { repositories, isLoading } = useRepositories();
  const sshKeysData = useSSHKeys();

  const {
    deleteRepositoryMutation,
    checkRepositoryMutation,
    compactRepositoryMutation,
  } = useRepositoryMutations({
    onCreateSuccess: () => {
      setShowCreateModal(false);
      setEditingRepo(null);
    },
    onUpdateSuccess: () => {
      setEditingRepo(null);
      setShowCreateModal(false);
    },
  });

  // Repository edit handler - now checks passphrase first for encrypted repos
  const handleStartEdit = async (repository: Repository) => {
    // Check if repo has encryption that requires passphrase
    const hasEncryption = repository.encryption &&
      repository.encryption !== 'none' &&
      repository.encryption !== '';

    if (!hasEncryption) {
      // No encryption, open edit directly
      setEditingRepo(repository);
      return;
    }

    // Verify passphrase for encrypted repos
    setVerifyingPassphrase(true);
    try {
      const response = await repositoriesAPI.verifyPassphrase(repository.id);
      const data = response.data;

      if (data.needs_passphrase) {
        // Check if this is a connection error vs a passphrase issue
        if (data.error_type === 'connection_error') {
          // Connection/timeout error - show error message, don't ask for passphrase
          toast.error(data.message || 'Could not connect to repository', { duration: 8000 });
          // Don't open edit - can't verify connection
        } else {
          // Passphrase missing or wrong - show modal to enter passphrase
          setPassphraseRepo(repository);
          setPassphraseMessage(data.message || 'Please enter the repository passphrase');
        }
      } else {
        // Passphrase valid - open edit directly
        setEditingRepo(repository);
      }
    } catch (err: any) {
      // If verification fails (e.g., network error), show error
      console.warn('Passphrase verification failed:', err);
      const errorMsg = err.response?.data?.detail || err.message || 'Could not verify passphrase';
      toast.error(errorMsg, { duration: 8000 });
    } finally {
      setVerifyingPassphrase(false);
    }
  };

  // Handle successful passphrase verification
  const handlePassphraseSuccess = () => {
    const repo = passphraseRepo;
    setPassphraseRepo(null);
    setPassphraseMessage('');
    if (repo) {
      setEditingRepo(repo);
    }
  };

  // Repository action handlers
  const handleDeleteRepository = (repository: Repository) => {
    setDeletingRepo(repository);
  };

  const confirmDeleteRepository = (deleteOnDisk: boolean) => {
    if (deletingRepo) {
      deleteRepositoryMutation.mutate({ path: deletingRepo.path, deleteOnDisk });
      setDeletingRepo(null);
    }
  };

  const cancelDeleteRepository = () => {
    setDeletingRepo(null);
  };

  // Load repository stats (archive count, size, etc.)
  const handleLoadStats = async (repository: Repository) => {
    const repoPath = repository.path;
    setLoadingStats(prev => new Set(prev).add(repoPath));
    
    try {
      const response = await repositoriesAPI.getRepositoryStats(repository.id);
      if (response.data.success) {
        setRepoStats(prev => ({
          ...prev,
          [repoPath]: response.data.data
        }));
      } else {
        toast.error('Failed to load stats');
      }
    } catch (error: any) {
      console.error('Failed to load stats:', error);
      toast.error(error.response?.data?.detail || 'Failed to load repository stats');
    } finally {
      setLoadingStats(prev => {
        const newSet = new Set(prev);
        newSet.delete(repoPath);
        return newSet;
      });
    }
  };

  const handleCheckRepository = (repository: Repository) => {
    // Clear any existing result for this repo when starting a new check
    setCheckResults(prev => {
      const newResults = { ...prev };
      delete newResults[repository.path];
      return newResults;
    });
    setCheckingRepoId(repository.id);

    checkRepositoryMutation.mutate(repository.id, {
      onSuccess: () => {
        setCheckResults(prev => ({
          ...prev,
          [repository.path]: {
            status: 'success',
            message: 'Repository integrity verified. No errors found.',
          }
        }));
        setCheckingRepoId(null);
      },
      onError: (error: any) => {
        const errorMsg = error.response?.data?.detail || 'Failed to check repository';
        setCheckResults(prev => ({
          ...prev,
          [repository.path]: {
            status: 'error',
            message: errorMsg,
          }
        }));
        setCheckingRepoId(null);
      }
    });
  };

  const dismissCheckResult = (repoPath: string) => {
    setCheckResults(prev => {
      const newResults = { ...prev };
      delete newResults[repoPath];
      return newResults;
    });
  };

  const handleCompactRepository = (repository: Repository) => {
    if (window.confirm(`Are you sure you want to compact repository "${repository.name}"?`)) {
      compactRepositoryMutation.mutate(repository.id);
    }
  };

  // Break repository lock handler
  const handleBreakLock = async (repository: Repository) => {
    const confirmMsg = `Are you sure you want to break the lock on "${repository.name}"?\n\nOnly do this if you're certain no backup is currently running. Breaking an active lock can corrupt the repository.`;
    
    if (!window.confirm(confirmMsg)) {
      return;
    }

    setBreakingLockRepoId(repository.id);
    
    try {
      const response = await repositoriesAPI.breakLock(repository.path);
      if (response.data.success) {
        toast.success('Repository lock broken successfully');
        // Refetch repositories to update lock status
        await queryClient.invalidateQueries({ queryKey: ['config-parser-repositories'] });
      } else {
        toast.error(response.data.message || 'Failed to break lock');
      }
    } catch (error: any) {
      console.error('Failed to break lock:', error);
      toast.error(error.response?.data?.detail || 'Failed to break repository lock');
    } finally {
      setBreakingLockRepoId(null);
    }
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
  };

  // Find viewing repository
  const viewingRepo = viewingRepoPath
    ? repositories.find((r: Repository) => r.path === viewingRepoPath)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Repository Management</h1>
          <p className="text-gray-600">Create and manage Borg repositories</p>
          <p className="mt-2 text-sm text-gray-600">
            Borg repositories are the targets/destinations of your backups. The Borg engine stores source files in chunks to reduce duplicate data retention. Repositories can be local (not recommended) or remote.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* View Mode Toggle */}
          {repositories.length > 0 && (
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
          {user?.is_admin && (
            <>
              <a
                href="https://docs.speedbits.io/books/borgmatic-director-ui/page/repository-guide"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors whitespace-nowrap"
              >
                📖 Read this first!
              </a>
              <button
                onClick={openCreateModal}
                className="flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Repository
              </button>
            </>
          )}
        </div>
      </div>

      {/* Repositories List */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading repositories...</p>
        </div>
      ) : repositories.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg mb-2">No repositories yet</p>
          <p className="text-gray-500 text-sm">Click "Create Repository" to get started</p>
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="bg-white rounded-lg border shadow-sm">
          {repositories.map((repo: Repository, index: number) => {
            const isExpanded = expandedRepos.has(repo.path);
            // Merge loaded stats with repository data
            const stats = repoStats[repo.path];
            const repository = stats ? {
              ...repo,
              archive_count: stats.archive_count,
              total_size: stats.total_size,
              last_backup: stats.last_backup || repo.last_backup
            } : repo;

            return (
              <div key={repository.path || `repo-${index}`} className={index > 0 ? 'border-t border-gray-200' : ''}>
                {/* Compact Row */}
                <div
                  className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleRepoExpanded(repository.path)}
                >
                  {/* Expand/Collapse Icon */}
                  <button className="p-1 mr-2 text-gray-400">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  {/* Status Icon */}
                  <div className="mr-3">
                    {repository.isUsed ? (
                      <HardDrive className="w-5 h-5 text-green-500" />
                    ) : (
                      <HardDrive className="w-5 h-5 text-gray-400" />
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{repository.name}</span>
                      {repository.read_only && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Read-Only</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate font-mono" title={repository.path}>
                      {repository.path}
                    </p>
                  </div>

                  {/* Borg Version */}
                  <div className="hidden md:block mr-4">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${repository.borg_version === '1.x'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-purple-100 text-purple-800'
                      }`}>
                      Borg {repository.borg_version || '1.x'}
                    </span>
                  </div>

                  {/* Encryption */}
                  <div className="hidden lg:block mr-4 w-28">
                    <span className="text-sm text-gray-600">{repository.encryption || 'none'}</span>
                  </div>

                  {/* Archives */}
                  <div className="hidden sm:flex items-center mr-4 w-24">
                    <Archive className="w-3.5 h-3.5 text-gray-400 mr-1" />
                    <span className="text-sm text-gray-600">{repository.archive_count || 0} archives</span>
                  </div>

                  {/* Usage Status */}
                  <div className="hidden md:block mr-4 w-28">
                    {repository.isUsed ? (
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full flex items-center w-fit">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        In Use
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full flex items-center w-fit">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Unused
                      </span>
                    )}
                  </div>

                  {/* Lock Status */}
                  {repository.is_locked && (
                    <div className="hidden md:block mr-4">
                      <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full flex items-center w-fit">
                        <Lock className="w-3 h-3 mr-1" />
                        Locked
                      </span>
                    </div>
                  )}

                  {/* Quick Actions */}
                  {user?.is_admin && (
                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setViewingRepoPath(repository.path)}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleStartEdit(repository)}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteRepository(repository)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Path */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Path</label>
                        <p className="mt-1 text-sm text-gray-900 font-mono break-all">{repository.path}</p>
                      </div>

                      {/* Compression */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Compression</label>
                        <p className="mt-1 text-sm text-gray-900">{repository.compression || 'lz4'}</p>
                      </div>

                      {/* Archives & Size */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Archives</label>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-sm text-gray-900">
                            {repository.archive_count !== null && repository.archive_count !== undefined 
                              ? repository.archive_count 
                              : <span className="text-gray-400">—</span>}
                          </span>
                          {repository.archive_count === null && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleLoadStats(repo); }}
                              disabled={loadingStats.has(repo.path)}
                              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 rounded transition-colors disabled:opacity-50"
                              title="Load stats from repository"
                            >
                              {loadingStats.has(repo.path) ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span>Loading...</span>
                                </>
                              ) : (
                                <span>Load Stats</span>
                              )}
                            </button>
                          )}
                        </div>
                        {repository.total_size && (
                          <p className="text-xs text-gray-500">Size: {repository.total_size}</p>
                        )}
                      </div>

                      {/* Used In */}
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase">Used In Backups</label>
                        <div className="mt-1">
                          {repository.usedInBackups && repository.usedInBackups.length > 0 ? (
                            <div className="space-y-1">
                              {repository.usedInBackups.map((backup, idx) => (
                                <span key={idx} className="text-sm text-gray-900 block truncate">{backup}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400 italic">Not used</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {user?.is_admin && (
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setViewingRepoPath(repository.path)}
                            className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors flex items-center"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View Details
                          </button>
                          <button
                            onClick={() => handleCheckRepository(repository)}
                            disabled={checkingRepoId === repository.id}
                            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded transition-colors flex items-center disabled:opacity-50"
                          >
                            {checkingRepoId === repository.id ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            )}
                            {checkingRepoId === repository.id ? 'Checking...' : 'Check'}
                          </button>
                          <button
                            onClick={() => handleCompactRepository(repository)}
                            disabled={compactRepositoryMutation.isLoading}
                            className="text-xs px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded transition-colors flex items-center disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Compact
                          </button>
                          <button
                            onClick={() => setPruningRepo(repository)}
                            className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors flex items-center"
                          >
                            <Scissors className="w-3 h-3 mr-1" />
                            Prune
                          </button>
                          {repository.is_locked && (
                            <button
                              onClick={() => handleBreakLock(repository)}
                              disabled={breakingLockRepoId === repository.id}
                              className="text-xs px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded transition-colors flex items-center disabled:opacity-50"
                            >
                              {breakingLockRepoId === repository.id ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Unlock className="w-3 h-3 mr-1" />
                              )}
                              {breakingLockRepoId === repository.id ? 'Breaking...' : 'Break Lock'}
                            </button>
                          )}
                        </div>

                        {/* Check Result Banner (List View) */}
                        {checkResults[repository.path] && (
                          <div
                            className={`mt-3 p-3 rounded-lg flex items-start gap-2 ${checkResults[repository.path].status === 'success'
                                ? 'bg-green-50 border border-green-200'
                                : 'bg-red-50 border border-red-200'
                              }`}
                          >
                            {checkResults[repository.path].status === 'success' ? (
                              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${checkResults[repository.path].status === 'success' ? 'text-green-800' : 'text-red-800'
                                }`}>
                                {checkResults[repository.path].status === 'success' ? 'Check Completed Successfully' : 'Check Failed'}
                              </p>
                              <p className={`text-xs mt-0.5 break-words ${checkResults[repository.path].status === 'success' ? 'text-green-700' : 'text-red-700'
                                }`}>
                                {checkResults[repository.path].message}
                              </p>
                            </div>
                            <button
                              onClick={() => dismissCheckResult(repository.path)}
                              className={`p-1 rounded hover:bg-opacity-20 ${checkResults[repository.path].status === 'success'
                                  ? 'text-green-600 hover:bg-green-600'
                                  : 'text-red-600 hover:bg-red-600'
                                }`}
                              title="Dismiss"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Card View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {repositories.map((repository: Repository, index: number) => {
            const isEditing = false; // Inline editing removed - use modal instead
            // Merge loaded stats with repository data
            const stats = repoStats[repository.path];
            const repoWithStats = stats ? {
              ...repository,
              archive_count: stats.archive_count,
              total_size: stats.total_size,
              last_backup: stats.last_backup || repository.last_backup
            } : repository;
            
            return (
              <RepositoryCard
                key={repository.path || `repo-${index}`}
                repository={repoWithStats}
                isEditing={isEditing}
                editingName={''}
                onStartEdit={() => handleStartEdit(repository)}
                onSaveEdit={() => { }}
                onCancelEdit={() => { }}
                onNameChange={() => { }}
                onView={() => setViewingRepoPath(repository.path)}
                onCheck={() => handleCheckRepository(repository)}
                onCompact={() => handleCompactRepository(repository)}
                onPrune={() => setPruningRepo(repository)}
                onDelete={() => handleDeleteRepository(repository)}
                onLoadStats={() => handleLoadStats(repository)}
                onBreakLock={() => handleBreakLock(repository)}
                isAdmin={user?.is_admin}
                isChecking={checkingRepoId === repository.id}
                isCompacting={compactRepositoryMutation.isLoading}
                isLoadingStats={loadingStats.has(repository.path)}
                isBreakingLock={breakingLockRepoId === repository.id}
                checkResult={checkResults[repository.path] || null}
                onDismissCheckResult={() => dismissCheckResult(repository.path)}
              />
            );
          })}
        </div>
      )}

      {/* Create Repository Modal */}
      {showCreateModal && !editingRepo && (
        <CreateRepositoryModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
          }}
          sshKeysData={sshKeysData.data || sshKeysData}
        />
      )}

      {/* Edit Repository Modal */}
      {editingRepo && (
        <EditRepositoryModal
          repository={editingRepo}
          isOpen={!!editingRepo}
          onClose={() => {
            setEditingRepo(null);
          }}
          sshKeysData={sshKeysData.data || sshKeysData}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteRepositoryModal
        repository={deletingRepo}
        onConfirm={confirmDeleteRepository}
        onCancel={cancelDeleteRepository}
        isLoading={deleteRepositoryMutation.isLoading}
      />

      {/* View Repository Modal */}
      <ViewRepositoryModal
        repository={viewingRepo}
        onClose={() => setViewingRepoPath(null)}
      />

      {/* Prune Modal */}
      {pruningRepo && (
        <PruneModal
          isOpen={!!pruningRepo}
          onClose={() => setPruningRepo(null)}
          repositoryPath={pruningRepo.path}
          repositoryName={pruningRepo.name}
          onSuccess={() => {
            setPruningRepo(null);
            // Optionally refresh repository list
          }}
        />
      )}

      {/* Passphrase Verification Modal */}
      {passphraseRepo && (
        <PassphraseVerifyModal
          isOpen={!!passphraseRepo}
          onClose={() => {
            setPassphraseRepo(null);
            setPassphraseMessage('');
          }}
          onSuccess={handlePassphraseSuccess}
          repository={passphraseRepo}
          message={passphraseMessage}
        />
      )}

      {/* Loading overlay for passphrase verification */}
      {verifyingPassphrase && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg p-6 flex flex-col items-center space-y-3 max-w-sm">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <div className="text-center">
              <p className="text-gray-700 font-medium">Connecting to repository...</p>
              <p className="text-gray-500 text-sm mt-1">Verifying passphrase. This may take up to 1 minute for remote repositories.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Repositories;
