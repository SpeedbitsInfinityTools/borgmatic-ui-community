import { useState, useRef } from 'react';
import { X, Upload, File, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { dashboardAPI } from '../services/api';
import { useMutation } from 'react-query';
import { toast } from 'react-hot-toast';

interface ImportConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ImportConfigModal({ isOpen, onClose, onSuccess }: ImportConfigModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => dashboardAPI.importConfigZip(file),
    onSuccess: (response) => {
      const data = response.data.data;
      toast.success(
        `Import completed! ${data.summary.repositories}, ${data.summary.backups}, ${data.summary.credentials}`,
        { duration: 8000 }
      );
      if (onSuccess) {
        onSuccess();
      }
      handleClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to import configuration backup');
    },
  });

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.bac.zip')) {
        toast.error('Please select a Borgmatic Director UI backup file (.bac.zip)');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleImport = () => {
    if (!selectedFile) {
      toast.error('Please select a backup file first');
      return;
    }
    importMutation.mutate(selectedFile);
  };

  const handleClose = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Import Configuration Backup
            </h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={importMutation.isLoading}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-blue-900">Before Importing</h3>
                  <p className="mt-1 text-sm text-blue-800">
                    Make sure you have the backup password that was used when creating this backup. 
                    You will need it to decrypt the encrypted credentials (passwords, SSH keys, etc.).
                  </p>
                </div>
              </div>
            </div>

            {/* File Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Backup File
              </label>
              <div className="mt-1">
                {!selectedFile ? (
                  <div className="flex items-center justify-center w-full">
                    <button
                      type="button"
                      onClick={handleBrowseClick}
                      className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                    >
                      <Upload className="w-10 h-10 text-gray-400 mb-2" />
                      <span className="text-sm font-medium text-gray-700">Click to browse</span>
                      <span className="text-xs text-gray-500 mt-1">Select a .bac.zip backup file</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <File className="w-8 h-8 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                        <p className="text-xs text-gray-500">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                      disabled={importMutation.isLoading}
                    >
                      Change
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bac.zip"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Only Borgmatic Director UI backup files (.bac.zip) are supported.
              </p>
            </div>

            {/* Import Results */}
            {importMutation.isLoading && (
              <div className="flex items-center justify-center p-6 bg-blue-50 border border-blue-200 rounded-lg">
                <Loader className="w-6 h-6 text-blue-600 animate-spin mr-3" />
                <span className="text-sm font-medium text-blue-900">Importing configuration backup...</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
            <button
              onClick={handleClose}
              className="btn-secondary"
              disabled={importMutation.isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className="btn-primary flex items-center space-x-2"
              disabled={!selectedFile || importMutation.isLoading}
            >
              {importMutation.isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Import Backup</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

