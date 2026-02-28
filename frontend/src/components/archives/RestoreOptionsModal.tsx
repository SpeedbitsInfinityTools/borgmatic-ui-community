import React, { useState } from 'react';
import { restoreAPI } from '../../services/api';
import { toast } from 'react-hot-toast';
import {
  X,
  Download,
  FolderInput,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import RestoreDestinationDialog from './RestoreDestinationDialog';

// Info passed when restore starts/completes
export interface RestoreInfo {
  repoPath: string;
  archiveName: string;
  destination: string;
  destinationType: 'local' | 'download' | 'original';
}

interface RestoreOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: string;
  archiveName: string;
  selectedPaths: string[];
  onRestoreStart?: (info: RestoreInfo) => void;
  onRestoreComplete?: (info: RestoreInfo) => void;
}

const RestoreOptionsModal: React.FC<RestoreOptionsModalProps> = ({
  isOpen,
  onClose,
  repositoryPath,
  archiveName,
  selectedPaths,
  onRestoreStart,
  onRestoreComplete,
}) => {
  const isSingleFile = selectedPaths.length === 1;
  const isMultipleItems = selectedPaths.length > 1;
  const isFullArchive = selectedPaths.length === 0;
  
  // Default to 'custom' (new location) which is the recommended option
  const [restoreMode, setRestoreMode] = useState<'custom' | 'download' | 'original'>('custom');
  const [isRestoring, setIsRestoring] = useState(false);
  const [showDestinationDialog, setShowDestinationDialog] = useState(false);
  const [showOriginalConfirm, setShowOriginalConfirm] = useState(false);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!isSingleFile) {
      toast.error('Download is only available for a single file or folder. For multiple items, use "Restore to new location".');
      return;
    }

    const restoreInfo: RestoreInfo = {
      repoPath: repositoryPath,
      archiveName,
      destination: selectedPaths[0].split('/').pop() || 'download',
      destinationType: 'download',
    };

    // Close modal and notify that download is starting
    onClose();
    onRestoreStart?.(restoreInfo);

    try {
      const loadingToast = toast.loading('Preparing download...');
      const response = await restoreAPI.downloadFile(repositoryPath, archiveName, selectedPaths[0]);

      // Get filename from Content-Disposition header, or fallback to path-based name
      let filename = selectedPaths[0].split('/').pop() || 'download';
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
      onRestoreComplete?.(restoreInfo);
    } catch (error: any) {
      console.error('Download error:', error);
      toast.error(error.response?.data?.detail || error.response?.data?.error || error.message || 'Failed to download file');
      // Still notify completion (with error) to clear the active state
      onRestoreComplete?.(restoreInfo);
    }
  };

  const handleOriginalRestore = async () => {
    const restoreInfo: RestoreInfo = {
      repoPath: repositoryPath,
      archiveName,
      destination: 'original location',
      destinationType: 'original',
    };

    // Close modal and notify that restore is starting
    setShowOriginalConfirm(false);
    onClose();
    onRestoreStart?.(restoreInfo);

    try {
      await restoreAPI.startRestore(repositoryPath, archiveName, selectedPaths, '');
      toast.success('Restore to original location completed!');
      onRestoreComplete?.(restoreInfo);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to restore');
      onRestoreComplete?.(restoreInfo);
    }
  };

  const handleAction = () => {
    if (restoreMode === 'custom') {
      // Open the destination dialog directly
      setShowDestinationDialog(true);
    } else if (restoreMode === 'download') {
      handleDownload();
    } else if (restoreMode === 'original') {
      // Show confirmation for original location
      setShowOriginalConfirm(true);
    }
  };

  // Called when restore to custom location starts
  const handleRestoreStartFromDialog = (destination: string) => {
    const restoreInfo: RestoreInfo = {
      repoPath: repositoryPath,
      archiveName,
      destination,
      destinationType: 'local',
    };
    onClose();
    onRestoreStart?.(restoreInfo);
    return restoreInfo;
  };

  // Called when restore to custom location completes
  const handleRestoreCompleteFromDialog = (destination: string) => {
    const restoreInfo: RestoreInfo = {
      repoPath: repositoryPath,
      archiveName,
      destination,
      destinationType: 'local',
    };
    onRestoreComplete?.(restoreInfo);
  };

  // If showing destination dialog, render it instead
  if (showDestinationDialog) {
    return (
      <RestoreDestinationDialog
        isOpen={true}
        onClose={() => setShowDestinationDialog(false)}
        selectedPaths={selectedPaths}
        repositoryPath={repositoryPath}
        archiveName={archiveName}
        onRestoreStart={handleRestoreStartFromDialog}
        onRestoreComplete={handleRestoreCompleteFromDialog}
      />
    );
  }

  // Confirmation dialog for original location restore
  if (showOriginalConfirm) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
          <div className="px-6 py-4 border-b border-gray-200 bg-amber-50">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
              <h2 className="text-lg font-bold text-gray-900">Confirm Original Location Restore</h2>
            </div>
          </div>
          <div className="p-6">
            <p className="text-gray-700 mb-4">
              You are about to restore {isFullArchive ? 'the entire archive' : `${selectedPaths.length} item(s)`} to their <strong>original locations</strong>.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800">
                <strong>Warning:</strong> This will overwrite any existing files with the same names at their original paths. This action cannot be undone.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Are you sure you want to proceed?
            </p>
          </div>
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
            <button
              onClick={() => setShowOriginalConfirm(false)}
              className="btn-secondary"
              disabled={isRestoring}
            >
              Cancel
            </button>
            <button
              onClick={handleOriginalRestore}
              disabled={isRestoring}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center space-x-2"
            >
              {isRestoring ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Restoring...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>Yes, Restore to Original</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Restore Archive</h2>
              <p className="text-sm text-gray-600 mt-1">{archiveName}</p>
              {!isFullArchive && (
                <p className="text-sm text-blue-600 mt-1">
                  {selectedPaths.length} {selectedPaths.length === 1 ? 'item' : 'items'} selected
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Choose restore method
            </label>

            <div className="space-y-3">
              {/* Option 1: Restore to new location (Recommended) */}
              <label 
                className={`flex items-start space-x-3 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                  restoreMode === 'custom' 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="restoreMode"
                  value="custom"
                  checked={restoreMode === 'custom'}
                  onChange={(e) => setRestoreMode(e.target.value as 'custom' | 'download' | 'original')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900 flex items-center space-x-2">
                    <FolderInput className="w-4 h-4 text-blue-600" />
                    <span>Restore to new location</span>
                    <span className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded">Recommended</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Browse and select a destination folder on the server
                  </div>
                </div>
              </label>

              {/* Option 2: Download to browser (single file only) */}
              <label 
                className={`flex items-start space-x-3 p-3 border rounded-lg transition-colors ${
                  !isSingleFile 
                    ? 'opacity-50 cursor-not-allowed bg-gray-50' 
                    : restoreMode === 'download'
                      ? 'border-blue-500 bg-blue-50 cursor-pointer'
                      : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="restoreMode"
                  value="download"
                  checked={restoreMode === 'download'}
                  onChange={(e) => setRestoreMode(e.target.value as 'custom' | 'download' | 'original')}
                  disabled={!isSingleFile}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900 flex items-center space-x-2">
                    <Download className="w-4 h-4 text-green-600" />
                    <span>Download to browser</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {isSingleFile 
                      ? 'Download directly to your computer (folders will be zipped)'
                      : isMultipleItems
                        ? 'Only available for single items (use "Restore to new location" for multiple items)'
                        : 'Select a single file or folder to enable download'
                    }
                  </div>
                </div>
              </label>

              {/* Option 3: Original location (with warning) */}
              <label 
                className={`flex items-start space-x-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  restoreMode === 'original' 
                    ? 'border-amber-500 bg-amber-50' 
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="restoreMode"
                  value="original"
                  checked={restoreMode === 'original'}
                  onChange={(e) => setRestoreMode(e.target.value as 'custom' | 'download' | 'original')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900 flex items-center space-x-2">
                    <RotateCcw className="w-4 h-4 text-amber-600" />
                    <span>Restore to original location</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    Restore {isFullArchive ? 'all files' : 'selected items'} to their original paths (overwrites existing files)
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
          <button onClick={onClose} className="btn-secondary" disabled={isRestoring}>
            Cancel
          </button>
          <button
            onClick={handleAction}
            disabled={isRestoring || (restoreMode === 'download' && !isSingleFile)}
            className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRestoring ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Processing...</span>
              </>
            ) : restoreMode === 'custom' ? (
              <>
                <FolderInput className="w-4 h-4" />
                <span>Choose Destination</span>
              </>
            ) : restoreMode === 'download' ? (
              <>
                <Download className="w-4 h-4" />
                <span>Download</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                <span>Restore</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreOptionsModal;
