import React from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';
import { Repository } from '../../types/repositories';
import { getDisplayPath, getCompressionLabel } from '../../utils/repositoryUtils';
import { formatDate } from '../../utils/dateFormat';

interface ViewRepositoryModalProps {
  repository: Repository | null;
  onClose: () => void;
}

const ViewRepositoryModal: React.FC<ViewRepositoryModalProps> = ({
  repository,
  onClose,
}) => {
  if (!repository) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
      <div className="relative mx-auto p-6 border w-full max-w-2xl shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Repository Details</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
              {repository.name}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Repository Type</label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border capitalize">
              {repository.repository_type || 'local'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Path</label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border font-mono break-all">
              {getDisplayPath(repository)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Encryption</label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
              {repository.encryption}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Compression</label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
              {getCompressionLabel(repository.compression)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Usage Status</label>
            {repository.isUsed ? (
              <div className="mt-1">
                <div className="inline-flex items-center px-3 py-2 rounded bg-green-50 text-sm">
                  <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                  <span className="text-green-800">In Use</span>
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  Used in backup{repository.usedInBackups && repository.usedInBackups.length > 1 ? 's' : ''}:{' '}
                  <span className="font-semibold">{repository.usedInBackups?.join(', ')}</span>
                </p>
              </div>
            ) : (
              <div className="mt-1">
                <div className="inline-flex items-center px-3 py-2 rounded bg-gray-50 text-sm">
                  <AlertTriangle className="w-4 h-4 mr-2 text-gray-600" />
                  <span className="text-gray-800">Not in use</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Archives</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                {repository.archive_count || 0}
              </p>
            </div>

            {repository.total_size && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Total Size</label>
                <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                  {repository.total_size}
                </p>
              </div>
            )}
          </div>

          {repository.created_at && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Created</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                {formatDate(repository.created_at)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewRepositoryModal;

