import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Folder, 
  Database, 
  Home, 
  ArrowUp, 
  RefreshCw, 
  ChevronRight,
  Loader,
  AlertCircle,
  Search,
  Archive
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { repositoriesAPI } from '../../services/api';

interface S3BrowserModalProps {
  isOpen: boolean;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey: string;
  s3SecretKey: string;
  currentBucket?: string;
  currentPath?: string;
  onSelectBucket: (bucket: string) => void;
  onSelectPath: (bucket: string, path: string) => void;
  onClose: () => void;
}

interface BrowseItem {
  name: string;
  type: 'bucket' | 'folder' | 'file';
  path: string;
  is_borg_repo?: boolean;
}

const S3BrowserModal: React.FC<S3BrowserModalProps> = ({
  isOpen,
  s3Endpoint,
  s3Region,
  s3AccessKey,
  s3SecretKey,
  currentBucket,
  currentPath,
  onSelectBucket,
  onSelectPath,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>(currentBucket || '');
  const [browsePath, setBrowsePath] = useState<string>(currentPath || '');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const browseS3 = useCallback(async (bucket?: string, path: string = '') => {
    if (!s3AccessKey || !s3SecretKey) {
      toast.error('S3 credentials are required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await repositoriesAPI.s3Browse({
        s3_endpoint: s3Endpoint,
        s3_region: s3Region,
        s3_access_key: s3AccessKey,
        s3_secret_key: s3SecretKey,
        bucket: bucket,
        path: path,
      });

      if (response.data.success) {
        if (bucket) {
          setItems(response.data.data.items || []);
          setBrowsePath(response.data.data.currentPath || '/');
        } else {
          // Convert buckets to items for unified display
          const bucketItems: BrowseItem[] = (response.data.data.buckets || []).map((b: string) => ({
            name: b,
            type: 'bucket' as const,
            path: b,
          }));
          setItems(bucketItems);
        }
        setSelectedItem(null);
      } else {
        setError(response.data.detail || 'Failed to browse S3');
        setItems([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to browse S3');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [s3Endpoint, s3Region, s3AccessKey, s3SecretKey]);

  useEffect(() => {
    if (isOpen && s3AccessKey && s3SecretKey) {
      setSelectedBucket(currentBucket || '');
      setBrowsePath(currentPath || '');
      setItems([]);
      setError(null);
      browseS3(currentBucket || undefined, currentPath || '');
    }
  }, [isOpen, s3AccessKey, s3SecretKey, currentBucket, currentPath, browseS3]);

  const navigateToBucket = async (bucketName: string) => {
    setSelectedBucket(bucketName);
    setBrowsePath('');
    setSearchFilter('');
    await browseS3(bucketName, '');
  };

  const navigateToFolder = async (folderPath: string) => {
    setSearchFilter('');
    await browseS3(selectedBucket, folderPath);
  };

  const navigateTo = async (bucket: string, path: string) => {
    setSelectedBucket(bucket);
    setBrowsePath(path);
    setSearchFilter('');
    if (bucket) {
      await browseS3(bucket, path);
    } else {
      await browseS3();
    }
  };

  const navigateUp = async () => {
    if (!selectedBucket) {
      return; // Already at bucket list
    }
    if (!browsePath || browsePath === '/' || browsePath === '') {
      // Go back to bucket list
      setSelectedBucket('');
      setBrowsePath('');
      setSearchFilter('');
      await browseS3();
    } else {
      // Go up one level
      const segments = browsePath.split('/').filter(s => s);
      segments.pop();
      const parentPath = segments.length > 0 ? `/${segments.join('/')}` : '';
      setSearchFilter('');
      await browseS3(selectedBucket, parentPath);
    }
  };

  const handleItemClick = (item: BrowseItem) => {
    // Single-click navigates (like local file explorer)
    // Exception: Borg repos are selected, not navigated into
    if (item.type === 'bucket') {
      navigateToBucket(item.name);
    } else if (item.type === 'folder') {
      if (item.is_borg_repo) {
        setSelectedItem(item.path);
      } else {
        navigateToFolder(item.path);
      }
    }
  };

  const handleItemDoubleClick = (item: BrowseItem) => {
    // Double-click on Borg repo selects and closes
    if (item.is_borg_repo && selectedBucket) {
      onSelectPath(selectedBucket, item.path);
      onClose();
    }
    // Double-click on bucket/folder - already navigated on single-click
  };

  const buildBreadcrumbs = () => {
    const breadcrumbs = [{ name: 'Buckets', bucket: '', path: '' }];
    if (selectedBucket) {
      breadcrumbs.push({ name: selectedBucket, bucket: selectedBucket, path: '' });
      if (browsePath) {
        const parts = browsePath.split('/').filter(Boolean);
        let accPath = '';
        for (const part of parts) {
          accPath += '/' + part;
          breadcrumbs.push({ name: part, bucket: selectedBucket, path: accPath });
        }
      }
    }
    return breadcrumbs;
  };

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const handleSelect = () => {
    if (selectedBucket) {
      onSelectPath(selectedBucket, selectedItem || browsePath);
      onClose();
    } else if (selectedItem) {
      onSelectBucket(selectedItem);
      onClose();
    }
  };

  if (!isOpen) return null;

  const breadcrumbs = buildBreadcrumbs();

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative mx-auto mt-10 mb-10 p-0 border w-full max-w-3xl shadow-lg rounded-lg bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Database className="w-5 h-5 text-orange-600" />
            <span>Browse S3 Storage</span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connection info banner */}
        <div className="px-4 py-2 bg-orange-50 border-b border-orange-100">
          <div className="flex items-start gap-2 text-sm text-orange-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-orange-600" />
            <div>
              <strong>Endpoint:</strong>{' '}
              <code className="bg-orange-100 px-1 rounded">{s3Endpoint || 'AWS S3'}</code>
              {s3Region && (
                <>
                  {' · '}
                  <strong>Region:</strong>{' '}
                  <code className="bg-orange-100 px-1 rounded">{s3Region}</code>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-gray-50 border-b space-y-2">
          {/* Navigation buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigateTo('', '')}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Go to bucket list"
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={navigateUp}
              disabled={!selectedBucket}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Go up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => browseS3(selectedBucket || undefined, browsePath)}
              disabled={loading}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center space-x-1 text-sm overflow-x-auto pb-1">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb.bucket}-${crumb.path}`}>
                {index > 0 && <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                <button
                  onClick={() => navigateTo(crumb.bucket, crumb.path)}
                  className="text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[150px]"
                  title={crumb.bucket ? `${crumb.bucket}${crumb.path}` : 'Buckets'}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

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
              <Loader className="w-8 h-8 text-orange-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-amber-600">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">Failed to browse S3</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
              <button
                onClick={() => navigateTo('', '')}
                className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Go to buckets
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Database className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">
                {searchFilter ? 'No matches found' : selectedBucket ? 'This location is empty' : 'No buckets found'}
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
                      ${selectedItem === item.path ? 'bg-blue-50 border-blue-200' : ''}
                    `}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        {item.is_borg_repo ? (
                          <Archive className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        ) : item.type === 'bucket' ? (
                          <Database className="w-4 h-4 text-orange-500 flex-shrink-0" />
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
                      {item.is_borg_repo ? 'Borg Repo' : item.type === 'bucket' ? 'Bucket' : item.type === 'folder' ? 'Folder' : 'File'}
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
            Selected:{' '}
            <code className="bg-gray-100 px-1 rounded">
              {selectedBucket ? `${selectedBucket}${selectedItem || browsePath}` : selectedItem || '(none)'}
            </code>
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
              disabled={loading || (!selectedBucket && !selectedItem)}
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

export default S3BrowserModal;
