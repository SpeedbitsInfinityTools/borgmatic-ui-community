import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'react-query';
import {
  X,
  Folder,
  File,
  ChevronRight,
  Home,
  ArrowUp,
  RefreshCw,
  Database,
  Check,
  Search,
  Loader,
  FolderPlus,
  AlertCircle,
  Monitor,
} from 'lucide-react';
import { filesystemAPI } from '../services/api';
import { toast } from 'react-hot-toast';

interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  is_file: boolean;
  is_symlink: boolean;
  size: number | null;
  modified: string | null;
  is_borg_repo: boolean;
  is_accessible: boolean;
  permissions: string | null;
}

interface FileExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (paths: string[]) => void;
  initialPath?: string;
  selectMode?: 'directories' | 'files' | 'both';
  multiSelect?: boolean;
  title?: string;
  selectButtonText?: string;
  /**
   * Opt into Borg-repository detection (the "Borg Repo" badge and
   * select-instead-of-navigate behaviour). Off by default because the probe is
   * slow on FUSE/cloud mounts; only the repository picker needs it.
   */
  detectBorgRepos?: boolean;
}

const FileExplorerModal: React.FC<FileExplorerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  initialPath = '/',
  selectMode = 'directories',
  multiSelect = false,
  title = 'Browse Filesystem',
  selectButtonText = 'Select',
  detectBorgRepos = false,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath || '/');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPath(initialPath || '/');
      setSelectedPaths(new Set());
      setSearchFilter('');
      setShowNewFolderInput(false);
      setNewFolderName('');
    }
  }, [isOpen, initialPath]);

  // Browse directory query
  const {
    data: browseData,
    isLoading,
    error,
    refetch,
  } = useQuery(
    ['filesystem-browse', currentPath, selectMode, detectBorgRepos],
    () => filesystemAPI.browse(currentPath, selectMode, detectBorgRepos),
    {
      enabled: isOpen,
      retry: 1,
      onError: (err: any) => {
        // 404 errors are expected when browsing non-existent paths
        if (err?.response?.status !== 404) {
          console.error('Browse error:', err);
        }
      },
    }
  );

  // Create directory mutation
  const createDirMutation = useMutation({
    mutationFn: (path: string) => filesystemAPI.createDirectory(path),
    onSuccess: (_data, newPath) => {
      toast.success('Directory created successfully');
      setShowNewFolderInput(false);
      setNewFolderName('');
      // Navigate into the newly created folder
      setCurrentPath(newPath);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create directory');
    },
  });

  const items: FileItem[] = browseData?.data?.data?.items || [];
  const parentPath = browseData?.data?.data?.parent_path || '/';
  const isRoot = browseData?.data?.data?.is_root || currentPath === '/';

  // Filter items by search
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Navigate to a directory
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSearchFilter('');
  }, []);

  // Handle item click
  const handleItemClick = (item: FileItem) => {
    // In files/both mode, clicking a file should select it (so the Select button becomes enabled)
    if (item.is_file && (selectMode === 'files' || selectMode === 'both')) {
      toggleSelection(item.path);
      return;
    }

    if (item.is_directory && !item.is_borg_repo) {
      // Navigate into directory (unless it's a borg repo we want to select)
      navigateTo(item.path);
      return;
    }

    // For borg repos, we might want to select them (treat as directory selection)
    if (item.is_directory && item.is_borg_repo && (selectMode === 'directories' || selectMode === 'both')) {
      toggleSelection(item.path);
    }
  };

  // Handle item double-click (for selection)
  const handleItemDoubleClick = (item: FileItem) => {
    if (selectMode === 'directories' && item.is_directory) {
      // Select and close
      onSelect([item.path]);
      onClose();
    } else if (selectMode === 'files' && item.is_file) {
      onSelect([item.path]);
      onClose();
    } else if (selectMode === 'both') {
      onSelect([item.path]);
      onClose();
    }
  };

  // Toggle selection
  const toggleSelection = (path: string) => {
    const newSelected = new Set(selectedPaths);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      if (!multiSelect) {
        newSelected.clear();
      }
      newSelected.add(path);
    }
    setSelectedPaths(newSelected);
  };

  // Handle checkbox change
  const handleCheckboxChange = (path: string, checked: boolean) => {
    const newSelected = new Set(selectedPaths);
    if (checked) {
      if (!multiSelect) {
        newSelected.clear();
      }
      newSelected.add(path);
    } else {
      newSelected.delete(path);
    }
    setSelectedPaths(newSelected);
  };

  // Use current directory
  const useCurrentDirectory = () => {
    onSelect([currentPath]);
    onClose();
  };

  // Confirm selection
  const confirmSelection = () => {
    if (selectedPaths.size > 0) {
      onSelect(Array.from(selectedPaths));
      onClose();
    }
  };

  // Create new folder
  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      const newPath = `${currentPath}/${newFolderName.trim()}`.replace(/\/+/g, '/');
      createDirMutation.mutate(newPath);
    }
  };

  // Build breadcrumbs
  const buildBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(Boolean);
    const breadcrumbs = [{ name: 'Root', path: '/' }];
    let accPath = '';
    for (const part of parts) {
      accPath += '/' + part;
      breadcrumbs.push({ name: part, path: accPath });
    }
    return breadcrumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative mx-auto mt-10 mb-10 p-0 border w-full max-w-3xl shadow-lg rounded-lg bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Folder className="w-5 h-5 text-blue-600" />
            <span>{title}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Docker host filesystem info banner */}
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
          <div className="flex items-start gap-2 text-sm text-blue-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
            <div>
              <strong>Running in Docker?</strong> Your host filesystem is mounted at{' '}
              <button
                onClick={() => navigateTo('/host')}
                className="font-mono font-semibold text-blue-700 hover:text-blue-900 underline"
              >
                /host
              </button>
              . For example, host path <code className="bg-blue-100 px-1 rounded">/opt/backups</code> is at{' '}
              <code className="bg-blue-100 px-1 rounded">/host/opt/backups</code>.
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-gray-50 border-b space-y-2">
          {/* Navigation buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigateTo('/')}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Go to root"
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={() => !isRoot && navigateTo(parentPath)}
              disabled={isRoot}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Go up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <div className="h-4 w-px bg-gray-300 mx-1" />
            <button
              onClick={() => setShowNewFolderInput(!showNewFolderInput)}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Create new folder"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center space-x-1 text-sm overflow-x-auto pb-1">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                {index > 0 && <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                <button
                  onClick={() => navigateTo(crumb.path)}
                  className={`px-2 py-0.5 rounded hover:bg-gray-200 whitespace-nowrap ${
                    index === breadcrumbs.length - 1
                      ? 'font-medium text-blue-600'
                      : 'text-gray-600'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* New folder input */}
          {showNewFolderInput && (
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolderInput(false);
                }}
              />
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || createDirMutation.isLoading}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => setShowNewFolderInput(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* File list */}
        <div className="h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-amber-600">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">
                {(error as any)?.response?.status === 404 
                  ? 'Directory does not exist' 
                  : 'Failed to load directory'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(error as any)?.response?.status === 404
                  ? 'You can create it using the folder icon above'
                  : (error as any)?.response?.data?.error || 'Unknown error'}
              </p>
              <button
                onClick={() => navigateTo('/')}
                className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Go to root
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Folder className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">
                {searchFilter ? 'No matches found' : 'This directory is empty'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  {multiSelect && <th className="w-10 px-3 py-2"></th>}
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-24">Size</th>
                  <th className="px-3 py-2 w-16">Perms</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isHostMount = item.path === '/host' && item.is_directory;
                  return (
                  <tr
                    key={item.path}
                    onClick={() => handleItemClick(item)}
                    onDoubleClick={() => handleItemDoubleClick(item)}
                    className={`
                      border-b cursor-pointer
                      ${isHostMount 
                        ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' 
                        : 'border-gray-100 hover:bg-gray-50'}
                      ${selectedPaths.has(item.path) ? 'bg-blue-50' : ''}
                      ${!item.is_accessible ? 'opacity-50' : ''}
                    `}
                  >
                    {multiSelect && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(item.path)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCheckboxChange(item.path, e.target.checked);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 text-blue-600 rounded"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        {/* Special icon for /host folder (Docker host filesystem mount) */}
                        {item.path === '/host' && item.is_directory ? (
                          <Monitor className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        ) : item.is_borg_repo ? (
                          <Database className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        ) : item.is_directory ? (
                          <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )}
                        <span className={`text-sm truncate ${item.path === '/host' ? 'font-semibold text-emerald-700' : 'text-gray-900'}`}>
                          {item.name}
                        </span>
                        {/* Badge for /host folder */}
                        {item.path === '/host' && item.is_directory && (
                          <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">
                            🖥️ Host System
                          </span>
                        )}
                        {item.is_borg_repo && (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                            Borg Repo
                          </span>
                        )}
                        {item.is_symlink && (
                          <span className="text-xs text-gray-400">→</span>
                        )}
                        {selectedPaths.has(item.path) && !multiSelect && (
                          <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {item.is_file && item.size !== null
                        ? formatSize(item.size)
                        : item.is_directory
                        ? '—'
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                      {item.permissions || '—'}
                    </td>
                  </tr>
                  );
                  })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {selectedPaths.size > 0 ? (
              <span className="font-medium text-blue-600">
                {selectedPaths.size} selected
              </span>
            ) : (
              <span>Current: <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs">{currentPath}</code></span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            {selectMode === 'directories' ? (
              // In directory mode, the primary action is to use the current directory
              <button
                onClick={useCurrentDirectory}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Select This Directory
              </button>
            ) : selectMode === 'both' ? (
              // In "both" mode, support BOTH workflows:
              // - choose the current folder (caller can create a file inside it)
              // - choose an explicit file
              <>
                <button
                  onClick={useCurrentDirectory}
                  className="px-4 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  title="Select the current folder"
                >
                  Select this Folder
                </button>
                <button
                  onClick={confirmSelection}
                  disabled={selectedPaths.size === 0}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={selectedPaths.size === 0 ? 'Select a file to enable this button' : 'Select the chosen file'}
                >
                  Select File
                </button>
              </>
            ) : (
              // In files or both mode, show the Select button for explicit selections
              <button
                onClick={confirmSelection}
                disabled={selectedPaths.size === 0}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {selectButtonText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default FileExplorerModal;

