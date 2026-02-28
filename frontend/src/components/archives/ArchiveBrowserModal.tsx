import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from 'react-query';
import { archivesAPI, restoreAPI } from '../../services/api';
import { toast } from 'react-hot-toast';
import {
  X,
  Folder,
  FolderOpen,
  FileText,
  File,
  ChevronRight,
  Home,
  ArrowUp,
  Search,
  Download,
  Eye,
  Square,
  CheckSquare,
  Loader,
  AlertCircle,
  RefreshCw,
  Archive,
  FileCode,
  Image,
  Music,
  Video,
  FileArchive,
  Database,
  RotateCcw,
} from 'lucide-react';
import RestoreOptionsModal from './RestoreOptionsModal';

interface ArchiveBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: string;
  archiveName: string;
  onRestore: (selectedPaths: string[]) => void;
  onRestoreStart?: (info: { repoPath: string; archiveName: string; destination: string; destinationType: 'local' | 'download' | 'original' }) => void;
  onRestoreComplete?: (info: { repoPath: string; archiveName: string; destination: string; destinationType: 'local' | 'download' | 'original' }) => void;
}

interface BrowseItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  sizeFormatted: string | null;
  modified: string | null;
  childCount?: number;
}

interface Breadcrumb {
  name: string;
  path: string;
}

// Get icon based on file extension
const getFileIcon = (filename: string, isDirectory: boolean) => {
  if (isDirectory) return <Folder className="w-4 h-4 text-blue-500" />;

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Code files
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'swift'].includes(ext)) {
    return <FileCode className="w-4 h-4 text-purple-500" />;
  }
  // Config/text files
  if (['json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'cfg', 'md', 'txt', 'log', 'csv'].includes(ext)) {
    return <FileText className="w-4 h-4 text-gray-500" />;
  }
  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff'].includes(ext)) {
    return <Image className="w-4 h-4 text-green-500" />;
  }
  // Audio
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return <Music className="w-4 h-4 text-pink-500" />;
  }
  // Video
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)) {
    return <Video className="w-4 h-4 text-red-500" />;
  }
  // Archives
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) {
    return <FileArchive className="w-4 h-4 text-yellow-600" />;
  }
  // Database
  if (['sql', 'db', 'sqlite', 'mdb'].includes(ext)) {
    return <Database className="w-4 h-4 text-blue-600" />;
  }

  return <File className="w-4 h-4 text-gray-400" />;
};

// Check if file is previewable
const isPreviewable = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const previewableExts = [
    'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'cfg',
    'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php',
    'html', 'css', 'scss', 'less', 'sh', 'bash', 'zsh', 'fish',
    'sql', 'log', 'csv', 'env', 'gitignore', 'dockerfile', 'makefile',
  ];
  return previewableExts.includes(ext) || filename.startsWith('.');
};

const ArchiveBrowserModal: React.FC<ArchiveBrowserModalProps> = ({
  isOpen,
  onClose,
  repositoryPath,
  archiveName,
  onRestore,
  onRestoreStart,
  onRestoreComplete,
}) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restoreSelection, setRestoreSelection] = useState<string[]>([]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPath('/');
      setSearchQuery('');
      setDebouncedSearch('');
      setSelectedPaths(new Set());
      setPreviewingFile(null);
    }
  }, [isOpen]);

  // Browse query
  const {
    data: browseData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery(
    ['archive-browse', repositoryPath, archiveName, currentPath, debouncedSearch],
    () => archivesAPI.browseArchive(repositoryPath, archiveName, currentPath, debouncedSearch || undefined),
    {
      enabled: isOpen,
      keepPreviousData: true,
      staleTime: 60000,
    }
  );

  // Preview query
  const {
    data: previewData,
    isLoading: previewLoading,
  } = useQuery(
    ['archive-preview', repositoryPath, archiveName, previewingFile],
    () => archivesAPI.previewFile(repositoryPath, archiveName, previewingFile!),
    {
      enabled: !!previewingFile,
    }
  );

  const items: BrowseItem[] = browseData?.data?.data?.items || [];
  const breadcrumbs: Breadcrumb[] = browseData?.data?.data?.breadcrumbs || [{ name: 'Root', path: '/' }];
  const totalItems = browseData?.data?.data?.total_archive_items || 0;
  const isSearchResults = browseData?.data?.data?.is_search || false;

  // Navigation
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSearchQuery('');
    setDebouncedSearch('');
  }, []);

  const navigateUp = () => {
    const parentPath = browseData?.data?.data?.parent_path;
    if (parentPath) {
      navigateTo(parentPath);
    }
  };

  // Selection
  const toggleSelection = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allPaths = items.map(item => item.path);
    setSelectedPaths(new Set(allPaths));
  };

  const clearSelection = () => {
    setSelectedPaths(new Set());
  };

  // Download single file
  const handleDownload = async (filePath: string) => {
    const loadingToast = toast.loading('Preparing download...');
    try {
      const response = await restoreAPI.downloadFile(repositoryPath, archiveName, filePath);

      const filename = filePath.split('/').pop() || 'download';
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.dismiss(loadingToast);
      toast.success('File downloaded!');
    } catch (error: any) {
      toast.dismiss(loadingToast);
      toast.error(error.response?.data?.detail || 'Download failed');
    }
  };

  // Restore selected - show destination picker
  const handleRestore = () => {
    if (selectedPaths.size === 0) {
      toast.error('Please select at least one file or folder');
      return;
    }
    setRestoreSelection(Array.from(selectedPaths));
    setShowRestoreDialog(true);
  };

  // Handle restore completion - just clear the selection, don't call onRestore
  // (onRestore was for the old flow, now RestoreOptionsModal handles everything)
  const handleRestoreComplete = () => {
    setSelectedPaths(new Set());
    setRestoreSelection([]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <Archive className="w-6 h-6 text-blue-600" />
              <div>
                <h2 className="text-lg font-bold text-gray-900">Browse Archive</h2>
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

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files in archive..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setDebouncedSearch(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumbs & Actions */}
        <div className="px-6 py-2 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center space-x-1 text-sm overflow-x-auto">
            {/* Loading indicator when fetching */}
            {isFetching && !isLoading && (
              <div className="flex items-center mr-2 text-blue-600">
                <Loader className="w-4 h-4 animate-spin" />
              </div>
            )}
            {!isSearchResults && (
              <>
                <button
                  onClick={() => navigateTo('/')}
                  className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title="Go to root"
                >
                  <Home className="w-4 h-4" />
                </button>
                {currentPath !== '/' && (
                  <button
                    onClick={navigateUp}
                    className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Go up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
                <span className="text-gray-300 mx-1">/</span>
                {breadcrumbs.slice(1).map((crumb, idx) => (
                  <React.Fragment key={crumb.path}>
                    <button
                      onClick={() => navigateTo(crumb.path)}
                      className="text-blue-600 hover:underline whitespace-nowrap"
                    >
                      {crumb.name}
                    </button>
                    {idx < breadcrumbs.length - 2 && (
                      <span className="text-gray-300 mx-1">/</span>
                    )}
                  </React.Fragment>
                ))}
              </>
            )}
            {isSearchResults && (
              <span className="text-gray-600">
                Search results for "{debouncedSearch}" ({items.length} matches)
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
            <button
              onClick={() => refetch()}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {items.length > 0 && (
              <>
                <button
                  onClick={selectAll}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Select All
                </button>
                {selectedPaths.size > 0 && (
                  <button
                    onClick={clearSelection}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* File List */}
          <div className={`flex-1 overflow-y-auto ${previewingFile ? 'w-1/2' : 'w-full'}`}>
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader className="w-6 h-6 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Loading...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full text-red-600">
                <AlertCircle className="w-8 h-8 mb-2" />
                <p>Failed to load archive contents</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <FolderOpen className="w-12 h-12 mb-2 text-gray-300" />
                <p>{isSearchResults ? 'No matching files found' : 'This folder is empty'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map((item) => (
                  <div
                    key={item.path}
                    className={`flex items-center px-4 py-2.5 hover:bg-gray-50 group transition-colors ${selectedPaths.has(item.path) ? 'bg-blue-50' : ''
                      }`}
                  >
                    {/* Selection Checkbox */}
                    <button
                      onClick={() => toggleSelection(item.path)}
                      className="flex-shrink-0 mr-3"
                    >
                      {selectedPaths.has(item.path) ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-300 group-hover:text-gray-400" />
                      )}
                    </button>

                    {/* Icon */}
                    <div className="flex-shrink-0 mr-3">
                      {getFileIcon(item.name, item.type === 'directory')}
                    </div>

                    {/* Name & Info */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (item.type === 'directory') {
                          navigateTo(item.path);
                        } else if (isPreviewable(item.name)) {
                          setPreviewingFile(item.path);
                        }
                      }}
                    >
                      <p className={`text-sm truncate ${item.type === 'directory'
                        ? 'font-medium text-gray-900 hover:text-blue-600'
                        : 'text-gray-700 hover:text-blue-600'
                        }`}>
                        {item.name}
                        {item.type === 'directory' && item.childCount && (
                          <span className="ml-2 text-xs text-gray-400">
                            ({item.childCount} items)
                          </span>
                        )}
                      </p>
                      {isSearchResults && (
                        <p className="text-xs text-gray-400 truncate">{item.path}</p>
                      )}
                    </div>

                    {/* Size */}
                    <div className="flex-shrink-0 w-20 text-right text-xs text-gray-500 mr-2">
                      {item.sizeFormatted || '—'}
                    </div>

                    {/* Download button (always visible for files) */}
                    {item.type === 'file' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(item.path); }}
                        className="flex-shrink-0 p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded mr-1"
                        title="Download file"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}

                    {/* Actions (preview, navigate) */}
                    <div className="flex-shrink-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {item.type === 'file' && isPreviewable(item.name) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPreviewingFile(item.path); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {item.type === 'directory' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigateTo(item.path); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Open folder"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview Panel */}
          {previewingFile && (
            <div className="w-1/2 border-l border-gray-200 flex flex-col bg-gray-50">
              <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-white">
                <div className="flex items-center space-x-2 min-w-0">
                  <Eye className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {previewingFile.split('/').pop()}
                  </span>
                </div>
                <button
                  onClick={() => setPreviewingFile(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {previewLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : previewData?.data?.data?.content ? (
                  <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap break-words bg-white p-4 rounded border border-gray-200 overflow-x-auto">
                    {previewData.data.data.content}
                  </pre>
                ) : previewData?.data?.data?.truncated ? (
                  <div className="text-center py-8 text-gray-500">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                    <p>{previewData.data.data.message}</p>
                    <button
                      onClick={() => handleDownload(previewingFile)}
                      className="mt-4 btn-primary text-sm"
                    >
                      Download Instead
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                    <p>Unable to preview this file</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div className="text-sm text-gray-600">
            {selectedPaths.size > 0 ? (
              <span className="font-medium text-blue-600">
                {selectedPaths.size} {selectedPaths.size === 1 ? 'item' : 'items'} selected
              </span>
            ) : (
              <span>
                {totalItems > 0 && `${totalItems.toLocaleString()} total files in archive`}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={selectedPaths.size === 0}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restore Selected</span>
            </button>
          </div>
        </div>
      </div>

      {/* Restore Options Modal */}
      <RestoreOptionsModal
        isOpen={showRestoreDialog}
        onClose={() => setShowRestoreDialog(false)}
        selectedPaths={restoreSelection}
        repositoryPath={repositoryPath}
        archiveName={archiveName}
        onRestoreStart={(info) => {
          setShowRestoreDialog(false);
          onClose();
          onRestoreStart?.(info);
        }}
        onRestoreComplete={(info) => {
          handleRestoreComplete();
          onRestoreComplete?.(info);
        }}
      />
    </div>
  );
};

export default ArchiveBrowserModal;

