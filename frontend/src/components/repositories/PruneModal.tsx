import React, { useState } from 'react';
import { X, Scissors, AlertTriangle, Info, Loader } from 'lucide-react';
import { useMutation } from 'react-query';
import { toast } from 'react-hot-toast';
import { repositoriesAPI } from '../../services/api';

interface PruneModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: string;
  repositoryName: string;
  onSuccess?: () => void;
}

const PruneModal: React.FC<PruneModalProps> = ({
  isOpen,
  onClose,
  repositoryPath,
  repositoryName,
  onSuccess,
}) => {
  const [keepDaily, setKeepDaily] = useState(7);
  const [keepWeekly, setKeepWeekly] = useState(4);
  const [keepMonthly, setKeepMonthly] = useState(6);
  const [keepYearly, setKeepYearly] = useState(2);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'preview' | 'prune' | null>(null);

  const pruneMutation = useMutation({
    mutationFn: (options: { dry_run: boolean }) =>
      repositoriesAPI.pruneRepository(repositoryPath, {
        keep_daily: keepDaily,
        keep_weekly: keepWeekly,
        keep_monthly: keepMonthly,
        keep_yearly: keepYearly,
        dry_run: options.dry_run,
      }),
    onSuccess: (response, variables) => {
      if (variables.dry_run) {
        setPreviewResult(response.data.output || 'No archives would be pruned with current settings.');
        toast.success('Preview generated successfully');
      } else {
        toast.success('Archives pruned successfully');
        onSuccess?.();
        onClose();
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to prune archives');
    },
  });

  const handlePreview = () => {
    setPreviewResult(null);
    setActiveAction('preview');
    pruneMutation.mutate({ dry_run: true });
  };

  const handlePrune = () => {
    if (!window.confirm('Are you sure you want to permanently delete these archives? This cannot be undone.')) {
      return;
    }
    setActiveAction('prune');
    pruneMutation.mutate({ dry_run: false });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 py-10">
      <div className="relative mx-auto p-6 border w-full max-w-lg shadow-lg rounded-lg bg-white">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <Scissors className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">Prune Archives</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Repository Name */}
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            Repository: <span className="font-medium text-gray-900">{repositoryName}</span>
          </p>
        </div>

        {/* Info Box */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-800">
              Pruning removes old archives based on retention rules, keeping only the most recent 
              archives according to your settings. This helps free up disk space while preserving 
              important backups.
            </p>
          </div>
        </div>

        {/* Retention Settings */}
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Retention Policy</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center text-sm font-medium text-gray-600 mb-1">
                Keep daily
                <span 
                  className="ml-1 text-gray-400 cursor-help"
                  title="Number of daily archives to keep"
                >
                  ℹ️
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={keepDaily}
                onChange={(e) => setKeepDaily(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="flex items-center text-sm font-medium text-gray-600 mb-1">
                Keep weekly
                <span 
                  className="ml-1 text-gray-400 cursor-help"
                  title="Number of weekly archives to keep (first archive of each week)"
                >
                  ℹ️
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={keepWeekly}
                onChange={(e) => setKeepWeekly(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="flex items-center text-sm font-medium text-gray-600 mb-1">
                Keep monthly
                <span 
                  className="ml-1 text-gray-400 cursor-help"
                  title="Number of monthly archives to keep (first archive of each month)"
                >
                  ℹ️
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={keepMonthly}
                onChange={(e) => setKeepMonthly(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="flex items-center text-sm font-medium text-gray-600 mb-1">
                Keep yearly
                <span 
                  className="ml-1 text-gray-400 cursor-help"
                  title="Number of yearly archives to keep (first archive of each year)"
                >
                  ℹ️
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={keepYearly}
                onChange={(e) => setKeepYearly(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Preview Result */}
        {previewResult && (
          <div className="mb-4 p-3 bg-gray-900 rounded-lg max-h-48 overflow-y-auto">
            <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono">
              {previewResult}
            </pre>
          </div>
        )}

        {/* Warning */}
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-yellow-800">
              <strong>Warning:</strong> Pruned archives cannot be recovered. We strongly recommend 
              running a preview first to see what would be deleted.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Cancel
          </button>
          <button
            onClick={handlePreview}
            disabled={pruneMutation.isLoading}
            className="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-300 rounded-md hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50"
          >
            {pruneMutation.isLoading && activeAction === 'preview' ? (
              <span className="flex items-center space-x-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Previewing...</span>
              </span>
            ) : (
              'Preview'
            )}
          </button>
          <button
            onClick={handlePrune}
            disabled={pruneMutation.isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50"
          >
            {pruneMutation.isLoading && activeAction === 'prune' ? (
              <span className="flex items-center space-x-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Pruning...</span>
              </span>
            ) : (
              'Prune Archives'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PruneModal;

