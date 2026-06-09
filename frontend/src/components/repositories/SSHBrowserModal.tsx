import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Folder, 
  FolderPlus, 
  Home, 
  ArrowUp, 
  RefreshCw, 
  ChevronRight,
  Loader,
  AlertCircle,
  Database,
  Search
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { repositoriesAPI } from '../../services/api';

interface SSHBrowserModalProps {
  isOpen: boolean;
  host: string;
  port: number;
  username: string;
  sshKeyId?: string | number | null;
  sshAuthMethod?: 'key' | 'password';
  sshPassword?: string;
  // Initial transport for browsing. Lets the caller (e.g. the SSH source card)
  // open the browser in the same mode the user selected for Test/backup.
  initialUseSftp?: boolean;
  currentPath?: string;
  onSelectPath: (path: string) => void;
  onClose: () => void;
  title?: string;
}

interface BrowseItem {
  name: string;
  type: 'folder' | 'file';
  path: string;
  is_borg_repo?: boolean;
}

const SSHBrowserModal: React.FC<SSHBrowserModalProps> = ({
  isOpen,
  host,
  port,
  username,
  sshKeyId,
  sshAuthMethod = 'key',
  sshPassword,
  initialUseSftp = false,
  currentPath,
  onSelectPath,
  onClose,
  title = 'Browse Remote Directory',
}) => {
  const [loading, setLoading] = useState(false);
  // Always start browsing from root "/" - currentPath is the value to return, not where to start
  const [browsePath, setBrowsePath] = useState<string>('/');
  // For SFTP-only chrooted servers (e.g. Hetzner Storage Box) the user's effective
  // top-level directory is their home, not "/" — the backend reports it via pwd.
  // When set, we treat it as the visual root for breadcrumbs and the Home button.
  const [homePath, setHomePath] = useState<string>('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [useSftpMode, setUseSftpMode] = useState(!!initialUseSftp);
  const [sftpModeNote, setSftpModeNote] = useState<string | null>(null);

  // Auto-detect Hetzner Storage Boxes and other SFTP-only servers
  const isLikelyHetzner = host?.includes('.your-storagebox.de') || host?.includes('storagebox');

  // Reset state when modal opens - always start from root "/"
  useEffect(() => {
    if (isOpen) {
      setBrowsePath('/');
      setHomePath('');
      setItems([]);
      setError(null);
      setSelectedPath(null);
      setShowNewFolderInput(false);
      setNewFolderName('');
      setSearchFilter('');
      setSftpModeNote(null);
      // Reflect the caller's chosen transport each time the modal opens.
      setUseSftpMode(!!initialUseSftp);
    }
  }, [isOpen, initialUseSftp]);

  const browseSSH = useCallback(async (path: string = '/') => {
    if (!host || !username) {
      toast.error('Host and username are required');
      return;
    }

    if (sshAuthMethod === 'key' && !sshKeyId) {
      toast.error('SSH key is required');
      return;
    }

    if (sshAuthMethod === 'password' && !sshPassword) {
      toast.error('SSH password is required');
      return;
    }

    setLoading(true);
    setError(null);
    setSftpModeNote(null);
    try {
      const response = await repositoriesAPI.sshBrowse({
        host,
        port,
        username,
        ssh_key_id: sshKeyId || undefined,
        ssh_auth_method: sshAuthMethod,
        ssh_password: sshPassword || undefined,
        remote_path: path || '/',
        use_sftp: useSftpMode || isLikelyHetzner,
      });

      if (response.data.success) {
        setItems(response.data.data.items || []);
        setBrowsePath(response.data.data.currentPath || '/');
        setSelectedPath(null);
        if (response.data.data.homePath) {
          setHomePath(response.data.data.homePath);
        }
        // Show note if server is SFTP-only
        if (response.data.data.mode === 'sftp') {
          setSftpModeNote(response.data.data.note || 'Using SFTP mode');
        }
      } else {
        setError(response.data.detail || 'Failed to browse');
        setItems([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to browse');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [host, port, username, sshKeyId, sshAuthMethod, sshPassword, useSftpMode, isLikelyHetzner]);

  useEffect(() => {
    if (isOpen) {
      browseSSH(currentPath || '/');
    }
  }, [isOpen, currentPath, browseSSH]);

  const handleItemClick = (item: BrowseItem) => {
    if (item.type === 'folder') {
      // Single-click navigates into folder (like local file explorer)
      // Exception: Borg repos are selected, not navigated into
      if (item.is_borg_repo) {
        setSelectedPath(item.path);
      } else {
        browseSSH(item.path);
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

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    const newPath = browsePath === '/' 
      ? `/${newFolderName.trim()}`
      : `${browsePath.replace(/\/$/, '')}/${newFolderName.trim()}`;

    setLoading(true);
    try {
      const response = await repositoriesAPI.sshCreateFolder({
        host,
        port,
        username,
        ssh_key_id: sshKeyId || undefined,
        ssh_auth_method: sshAuthMethod,
        ssh_password: sshPassword || undefined,
        remote_path: newPath,
        use_sftp: useSftpMode || isLikelyHetzner,
      });

      if (response.data.success) {
        toast.success(`Folder created: ${newFolderName}`);
        setShowNewFolderInput(false);
        setNewFolderName('');
        // Navigate into the newly created folder
        browseSSH(newPath);
      } else {
        toast.error(`Failed to create folder: ${response.data.detail}`);
      }
    } catch (err: any) {
      toast.error(`Failed to create folder: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (path: string) => {
    browseSSH(path);
    setSearchFilter('');
  };

  // The visual "root" of navigation. For SFTP-chrooted servers this is the user's
  // home (returned by the backend); otherwise it's the filesystem root.
  const effectiveRoot = homePath || '/';
  const atEffectiveRoot = browsePath === effectiveRoot || browsePath === '/' || (homePath && browsePath === homePath);

  const navigateUp = () => {
    if (atEffectiveRoot) return;
    const parts = browsePath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    // Don't allow stepping above the effective root (would 404 on chrooted servers).
    if (homePath && !parent.startsWith(homePath)) {
      navigateTo(homePath);
    } else {
      navigateTo(parent === '/' ? '/' : parent);
    }
  };

  const buildBreadcrumbs = () => {
    // When a homePath is known and the user is browsing within it, hide the
    // segments above home and show the home as "Root". Clicking "Root" then jumps
    // back to the user's effective top — not to "/", which often 404s on chroots.
    if (homePath && browsePath.startsWith(homePath)) {
      const breadcrumbs = [{ name: 'Root', path: homePath }];
      const tail = browsePath.substring(homePath.length).replace(/^\/+/, '');
      if (tail) {
        let acc = homePath.replace(/\/$/, '');
        for (const part of tail.split('/').filter(Boolean)) {
          acc += '/' + part;
          breadcrumbs.push({ name: part, path: acc });
        }
      }
      return breadcrumbs;
    }
    const parts = browsePath.split('/').filter(Boolean);
    const breadcrumbs = [{ name: 'Root', path: '/' }];
    let accPath = '';
    for (const part of parts) {
      accPath += '/' + part;
      breadcrumbs.push({ name: part, path: accPath });
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

        {/* Connection info banner */}
        <div className={`px-4 py-2 border-b ${loading ? 'bg-gray-100 border-gray-200' : 'bg-blue-50 border-blue-100'}`}>
          <div className={`flex items-center justify-between gap-2 text-sm ${loading ? 'text-gray-600' : 'text-blue-800'}`}>
            <div className="flex items-start gap-2">
              {loading ? (
                <Loader className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-500 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
              )}
              <div>
                <strong>{loading ? 'Connecting to:' : 'Connected to:'}</strong>{' '}
                <code className={`px-1 rounded ${loading ? 'bg-gray-200' : 'bg-blue-100'}`}>{username}@{host}:{port}</code>
                {!loading && sftpModeNote && (
                  <span className="ml-2 text-xs text-blue-600">({sftpModeNote})</span>
                )}
              </div>
            </div>
            {/* SFTP mode toggle */}
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={useSftpMode || isLikelyHetzner}
                onChange={(e) => setUseSftpMode(e.target.checked)}
                disabled={isLikelyHetzner || loading}
                className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={isLikelyHetzner ? 'text-blue-600' : ''}>
                SFTP-only mode
                {isLikelyHetzner && ' (auto-detected)'}
              </span>
            </label>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-gray-50 border-b space-y-2">
          {/* Navigation buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigateTo(effectiveRoot)}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title={homePath ? `Go to home (${homePath})` : 'Go to root'}
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={navigateUp}
              disabled={atEffectiveRoot}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Go up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => browseSSH(browsePath)}
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
                  title={crumb.path}
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
                disabled={!newFolderName.trim() || loading}
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
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-amber-600">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">Failed to load directory</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
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
                          <Database className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        ) : item.type === 'folder' ? (
                          <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                        ) : (
                          <div className="w-4 h-4" />
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
                      {item.is_borg_repo ? 'Borg Repo' : item.type === 'folder' ? 'Folder' : 'File'}
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
            Selected: <code className="bg-gray-100 px-1 rounded">{selectedPath || browsePath}</code>
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

export default SSHBrowserModal;
