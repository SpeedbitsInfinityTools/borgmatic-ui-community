import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Repository } from '../../types/repositories';

interface DeleteRepositoryModalProps {
  repository: Repository | null;
  onConfirm: (deleteOnDisk: boolean) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const DeleteRepositoryModal: React.FC<DeleteRepositoryModalProps> = ({
  repository,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [deleteOnDisk, setDeleteOnDisk] = useState(false);

  if (!repository) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
      <div className="relative mx-auto p-6 border w-full max-w-md shadow-lg rounded-md bg-white">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-lg font-medium text-gray-900">
              Delete Repository
            </h3>
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                Are you sure you want to delete repository <span className="font-semibold text-gray-900">"{repository.name}"</span>?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This action cannot be undone.
              </p>
              {repository.archive_count && repository.archive_count > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-sm text-yellow-800">
                    <strong>Warning:</strong> This repository contains {repository.archive_count} archive{repository.archive_count > 1 ? 's' : ''}.
                    The actual backup data will remain on disk, but you'll lose the connection to it in this UI.
                  </p>
                </div>
              )}

              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteOnDisk}
                    onChange={(e) => setDeleteOnDisk(e.target.checked)}
                    className="mt-1 mr-3 h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-red-900">
                      Also delete Backup Repo on Disk (deletes all Backups!)
                    </span>
                    <p className="text-xs text-red-700 mt-1">
                      ⚠️ This will permanently delete all backup archives in this repository. This action cannot be undone!
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteOnDisk)}
            disabled={isLoading}
            className={`px-4 py-2 text-white rounded transition-colors flex items-center ${deleteOnDisk
              ? 'bg-red-800 hover:bg-red-900 font-semibold'
              : 'bg-red-600 hover:bg-red-700'
              } disabled:opacity-50`}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {isLoading
              ? 'Deleting...'
              : deleteOnDisk
                ? 'Delete Repository & All Backups'
                : 'Delete Repository'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteRepositoryModal;

