import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'react-query';
import { restoreAPI } from '../../services/api';
import { toast } from 'react-hot-toast';
import {
  X,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Home,
  ArrowUp,
  Check,
  Loader,
  AlertCircle,
  HardDrive,
  ArrowDownToLine,
  Search,
  Monitor,
  Info,
} from 'lucide-react';

interface RestoreDestinationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPaths: string[];
  repositoryPath: string;
  archiveName: string;
  onRestoreStart?: (destination: string) => void;
  onRestoreComplete?: (destination: string) => void;
}

interface DirectoryItem {
  name: string;
  path: string;
  type: 'directory' | 'file';
  writable: boolean;
}

const RestoreDestinationDialog: React.FC<RestoreDestinationDialogProps> = ({
  isOpen,
  onClose,
  selectedPaths,
  repositoryPath,
  archiveName,
  onRestoreStart,
  onRestoreComplete,
}) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  // Reset state when dialog opens - start at root; the backend tells us
  // whether we're running inside Docker (in_docker) and lists the allowed
  // roots as virtual entries for Docker installs, or the real filesystem
  // root for host installs.
  useEffect(() => {
    if (isOpen) {
      setCurrentPath('/');
      setNewFolderName('');
      setShowNewFolderInput(false);
      setPreserveStructure(true);
      setSearchFilter('');
    }
  }, [isOpen]);

  // Browse filesystem query
  const {
    data: browseData,
    isLoading,
    error,
    refetch,
  } = useQuery(
    ['browse-filesystem', currentPath],
    () => restoreAPI.browseFilesystem(currentPath),
    {
      enabled: isOpen,
      keepPreviousData: true,
      retry: 1,
    }
  );

  // Create directory mutation
  const createDirMutation = useMutation(
    ({ path, name }: { path: string; name: string }) => 
      restoreAPI.createDirectory(path, name),
    {
      onSuccess: (response) => {
        toast.success('Directory created');
        setShowNewFolderInput(false);
        setNewFolderName('');
        // Navigate to the new directory
        if (response.data?.data?.path) {
          setCurrentPath(response.data.data.path);
        }
        refetch();
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.detail || 'Failed to create directory');
      },
    }
  );

  // Restore mutation
  const restoreMutation = useMutation(
    (destination: string) => restoreAPI.restoreToPath(repositoryPath, archiveName, selectedPaths, destination, preserveStructure),
    {
      onSuccess: (response, destination) => {
        const data = response.data?.data;
        toast.success(`Restored ${data?.total_restored || selectedPaths.length} items to ${destination}!`);
        onRestoreComplete?.(destination);
      },
      onError: (error: any, destination) => {
        toast.error(error.response?.data?.detail || 'Restore failed');
        // Still call complete to clear the active state
        onRestoreComplete?.(destination);
      },
    }
  );

  const items: DirectoryItem[] = browseData?.data?.data?.items || [];
  const parentPath = browseData?.data?.data?.parent_path;
  const isWritable = browseData?.data?.data?.is_writable ?? false;
  const canCreate = browseData?.data?.data?.can_create ?? false;
  const inDocker = browseData?.data?.data?.in_docker ?? true;

  // Filter items based on search
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setShowNewFolderInput(false);
    setNewFolderName('');
    setSearchFilter('');
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }
    if (newFolderName.includes('/') || newFolderName.includes('\\')) {
      toast.error('Folder name cannot contain slashes');
      return;
    }
    createDirMutation.mutate({ path: currentPath, name: newFolderName.trim() });
  };

  const handleRestore = () => {
    if (!isWritable) {
      toast.error('Selected directory is not writable');
      return;
    }
    // Notify that restore is starting and close dialog immediately
    onRestoreStart?.(currentPath);
    onClose();
    // Start the restore
    restoreMutation.mutate(currentPath);
  };

  // Build breadcrumb segments
  const getBreadcrumbs = () => {
    if (currentPath === '/') return [{ name: '/', path: '/' }];
    const parts = currentPath.split('/').filter(Boolean);
    const breadcrumbs = [{ name: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      breadcrumbs.push({ name: part, path: accumulated });
    }
    return breadcrumbs;
  };

  if (!isOpen) return null;

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col" style={{ height: '600px' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <ArrowDownToLine className="w-6 h-6 text-green-600" />
              <div>
                <h2 className="text-lg font-bold text-gray-900">Restore Destination</h2>
                <p className="text-sm text-gray-600">
                  {selectedPaths.length} {selectedPaths.length === 1 ? 'item' : 'items'} to restore
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Docker host filesystem info banner - only shown when actually running in Docker */}
        {currentPath === '/' && inDocker && (
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex-shrink-0">
            <p className="text-xs text-blue-700 flex items-center">
              <Info className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
              <span>
                <strong>Running in Docker.</strong> Your host filesystem is mounted at{' '}
                <button
                  onClick={() => navigateTo('/host')}
                  className="text-blue-600 hover:underline font-mono"
                >
                  /host
                </button>
                . For example, host path <code className="bg-blue-100 px-1 rounded">/home/user</code> is at{' '}
                <code className="bg-blue-100 px-1 rounded">/host/home/user</code>.
              </span>
            </p>
          </div>
        )}

        {/* Current Path Display with Breadcrumbs */}
        <div className="px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center space-x-2 text-sm">
            <HardDrive className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-700">Destination:</span>
            <div className="flex-1 flex items-center overflow-x-auto">
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.path}>
                  {index > 0 && <ChevronRight className="w-3 h-3 text-gray-400 mx-1 flex-shrink-0" />}
                  <button
                    onClick={() => navigateTo(crumb.path)}
                    className={`px-1.5 py-0.5 rounded text-xs hover:bg-gray-100 whitespace-nowrap ${
                      index === breadcrumbs.length - 1 
                        ? 'bg-gray-100 font-medium text-gray-800' 
                        : 'text-blue-600 hover:text-blue-700'
                    }`}
                  >
                    {crumb.name === '/' ? 'root' : crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
            {isWritable ? (
              <span className="text-green-600 text-xs flex items-center flex-shrink-0">
                <Check className="w-3 h-3 mr-1" />
                Writable
              </span>
            ) : (
              <span className="text-red-500 text-xs flex items-center flex-shrink-0">
                <AlertCircle className="w-3 h-3 mr-1" />
                Not writable
              </span>
            )}
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="px-6 py-2 border-b border-gray-200 flex items-center space-x-2 bg-gray-50 flex-shrink-0">
          <button
            onClick={() => navigateTo('/')}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
            title="Go to root"
          >
            <Home className="w-4 h-4" />
          </button>
          {parentPath && (
            <button
              onClick={() => navigateTo(parentPath)}
              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="Go up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
          
          {/* Search filter */}
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter folders..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          {canCreate && (
            <button
              onClick={() => setShowNewFolderInput(!showNewFolderInput)}
              className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded transition-colors ${
                showNewFolderInput 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <FolderPlus className="w-4 h-4" />
              <span>New Folder</span>
            </button>
          )}
        </div>

        {/* New Folder Input */}
        {showNewFolderInput && (
          <div className="px-6 py-3 border-b border-gray-200 bg-blue-50 flex-shrink-0">
            <div className="flex items-center space-x-2">
              <FolderPlus className="w-5 h-5 text-blue-600" />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }
                }}
                autoFocus
              />
              <button
                onClick={handleCreateFolder}
                disabled={createDirMutation.isLoading || !newFolderName.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
              >
                {createDirMutation.isLoading ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Create</span>
              </button>
              <button
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName('');
                }}
                className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Directory List - Fixed height scrollable area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2 text-gray-600">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-600">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p>Failed to load directory</p>
              <button 
                onClick={() => navigateTo('/')}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Go to root
              </button>
            </div>
          ) : filteredItems.length === 0 && items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <FolderOpen className="w-12 h-12 mb-2 text-gray-300" />
              <p>No subdirectories</p>
              <p className="text-sm text-gray-400 mt-1">
                {canCreate ? 'Create a new folder or select this location' : 'Select this location'}
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Search className="w-8 h-8 mb-2 text-gray-300" />
              <p>No folders match "{searchFilter}"</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                const isHostMount = item.path === '/host';
                
                return (
                  <button
                    key={item.path}
                    onClick={() => navigateTo(item.path)}
                    className={`w-full flex items-center px-6 py-3 group transition-colors text-left ${
                      isHostMount 
                        ? 'bg-emerald-50 hover:bg-emerald-100 border-l-4 border-emerald-500' 
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Special icon for /host folder */}
                    {isHostMount ? (
                      <Monitor className="w-5 h-5 text-emerald-600 mr-3 flex-shrink-0" />
                    ) : (
                      <Folder className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" />
                    )}
                    
                    <span className={`flex-1 ${
                      isHostMount 
                        ? 'font-semibold text-emerald-700' 
                        : 'text-gray-800 group-hover:text-blue-600'
                    }`}>
                      {item.name}
                    </span>
                    
                    {/* Badge for /host folder */}
                    {isHostMount && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full mr-2 flex items-center">
                        Host System
                      </span>
                    )}
                    
                    {item.writable ? (
                      <span className="text-xs text-green-500 mr-2">writable</span>
                    ) : (
                      <span className="text-xs text-gray-400 mr-2">read-only</span>
                    )}
                    <ChevronRight className={`w-4 h-4 ${
                      isHostMount ? 'text-emerald-500' : 'text-gray-400 group-hover:text-blue-600'
                    }`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={preserveStructure}
              onChange={(e) => setPreserveStructure(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              Preserve original directory structure
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            Files will be restored with their full path (e.g., /host/opt/app/...)
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{selectedPaths.length}</span> items → 
            <code className="ml-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs">
              {currentPath}
            </code>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={!isWritable || restoreMutation.isLoading}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restoreMutation.isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Restoring...</span>
                </>
              ) : (
                <>
                  <ArrowDownToLine className="w-4 h-4" />
                  <span>Restore Here</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestoreDestinationDialog;
