import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Folder, 
  Cloud, 
  Home, 
  ArrowUp, 
  RefreshCw, 
  ChevronRight,
  Loader,
  AlertCircle,
  Search,
  FolderPlus,
  Archive
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface RcloneBrowserModalProps {
  isOpen: boolean;
  rcloneRemote: string;
  currentPath?: string;
  onSelectPath: (path: string) => void;
  onClose: () => void;
}

interface BrowseItem {
  name: string;
  type: 'folder' | 'file';
  path: string;
  is_borg_repo?: boolean;
}

const RcloneBrowserModal: React.FC<RcloneBrowserModalProps> = ({
  isOpen,
  rcloneRemote,
  currentPath,
  onSelectPath,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const browseFolders = useCallback(async (path: string = '') => {
    if (!rcloneRemote) {
      toast.error('Please select a remote first');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/repositories/rclone-browse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          remote: rcloneRemote,
          path: path
        })
      });

      const result = await response.json();
      if (result.success) {
        // Convert folders to items
        const folderItems: BrowseItem[] = (result.folders || []).map((f: { name: string; is_borg_repo?: boolean }) => ({
          name: f.name,
          type: 'folder' as const,
          path: path ? `${path}/${f.name}` : f.name,
          is_borg_repo: f.is_borg_repo,
        }));
        setItems(folderItems);
        setBrowsePath(path);
        setSelectedPath(null);
      } else {
        setError(result.error || 'Failed to browse folders');
        setItems([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to browse folders');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [rcloneRemote]);

  useEffect(() => {
    if (isOpen && rcloneRemote) {
      setBrowsePath(currentPath || '');
      setItems([]);
      setError(null);
      setSearchFilter('');
      browseFolders(currentPath || '');
    }
  }, [isOpen, rcloneRemote, currentPath, browseFolders]);

  const navigateTo = (path: string) => {
    setSearchFilter('');
    browseFolders(path);
  };

  const navigateUp = () => {
    if (!browsePath) return;
    const segments = browsePath.split('/').filter(Boolean);
    segments.pop();
    const parentPath = segments.join('/');
    setSearchFilter('');
    browseFolders(parentPath);
  };

  const handleItemClick = (item: BrowseItem) => {
    if (item.type === 'folder') {
      // Single-click navigates into folder (like local file explorer)
      // Exception: Borg repos are selected, not navigated into
      if (item.is_borg_repo) {
        setSelectedPath(item.path);
      } else {
        navigateTo(item.path);
      }
    }
  };

  const handleItemDoubleClick = (item: BrowseItem) => {
    if (item.type === 'folder') {
      // Double-click on Borg repo selects it and closes
      if (item.is_borg_repo) {
        onSelectPath(item.path);
        onClose();
      }
      // Double-click on regular folder - already navigated on single-click
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;

    // Validate folder name
    if (/[/\\;&|`$()]/.test(newFolderName)) {
      toast.error('Invalid folder name. Only alphanumeric characters, dashes, and underscores are allowed.');
      return;
    }

    // Add the new folder to the list immediately (simulated)
    const newPath = browsePath ? `${browsePath}/${newFolderName.trim()}` : newFolderName.trim();
    setItems([...items, { name: newFolderName.trim(), type: 'folder', path: newPath }]);
    setNewFolderName('');
    setShowNewFolderInput(false);
    toast.success(`Folder "${newFolderName.trim()}" will be created when the repository is saved.`);
  };

  const buildBreadcrumbs = () => {
    const breadcrumbs = [{ name: rcloneRemote, path: '' }];
    if (browsePath) {
      const parts = browsePath.split('/').filter(Boolean);
      let accPath = '';
      for (const part of parts) {
        accPath = accPath ? `${accPath}/${part}` : part;
        breadcrumbs.push({ name: part, path: accPath });
      }
    }
    return breadcrumbs;
  };

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const handleSelect = () => {
    onSelectPath(selectedPath || browsePath);
    onClose();
  };

  if (!isOpen) return null;

  const breadcrumbs = buildBreadcrumbs();

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative mx-auto mt-10 mb-10 p-0 border w-full max-w-3xl shadow-lg rounded-lg bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Cloud className="w-5 h-5 text-cyan-600" />
            <span>Browse Rclone Remote</span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connection info banner */}
        <div className="px-4 py-2 bg-cyan-50 border-b border-cyan-100">
          <div className="flex items-start gap-2 text-sm text-cyan-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-cyan-600" />
            <div>
              <strong>Remote:</strong>{' '}
              <code className="bg-cyan-100 px-1 rounded">{rcloneRemote}</code>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-gray-50 border-b space-y-2">
          {/* Navigation buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigateTo('')}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Go to root"
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={navigateUp}
              disabled={!browsePath}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Go up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => browseFolders(browsePath)}
              disabled={loading}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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
                  className="text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[150px]"
                  title={`${rcloneRemote}:${crumb.path || '/'}`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* New folder input */}
          {showNewFolderInput && (
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateFolder()}
                placeholder="New folder name..."
                autoFocus
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Search/filter */}
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

        {/* Directory listing - fixed height */}
        <div className="h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader className="w-8 h-8 text-cyan-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-amber-600">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">Failed to browse remote</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
              <button
                onClick={() => navigateTo('')}
                className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Go to root
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Folder className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">
                {searchFilter ? 'No matches found' : 'This location is empty'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-24">Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.path}
                    onClick={() => handleItemClick(item)}
                    onDoubleClick={() => handleItemDoubleClick(item)}
                    className={`
                      border-b cursor-pointer
                      ${item.is_borg_repo 
                        ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' 
                        : 'border-gray-100 hover:bg-gray-50'}
                      ${selectedPath === item.path ? 'bg-blue-50 border-blue-200' : ''}
                    `}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        {item.is_borg_repo ? (
                          <Archive className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-900 truncate">{item.name}</span>
                        {item.is_borg_repo && (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                            Borg Repo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {item.is_borg_repo ? 'Borg Repo' : 'Folder'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600 truncate max-w-[60%]">
            Selected: <code className="bg-gray-100 px-1 rounded">{selectedPath || browsePath || '/'}</code>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RcloneBrowserModal;
