import React from 'react';
import {
  Database,
  Edit2,
  CheckCircle,
  AlertTriangle,
  Check,
  X,
  Eye,
  RefreshCw,
  Trash2,
  Info,
  Scissors,
  XCircle,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { Repository } from '../../types/repositories';
import { getDisplayPath, getEncryptionIcon, getCompressionLabel } from '../../utils/repositoryUtils';
import { formatDate } from '../../utils/dateFormat';
import ActionButton from './ActionButton';

export interface CheckResult {
  status: 'success' | 'error';
  message: string;
}

interface RepositoryCardProps {
  repository: Repository;
  isEditing: boolean;
  editingName: string;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onNameChange: (name: string) => void;
  onView: () => void;
  onCheck: () => void;
  onCompact: () => void;
  onPrune?: () => void;
  onDelete: () => void;
  onLoadStats?: () => void;
  isAdmin?: boolean;
  isChecking?: boolean;
  isCompacting?: boolean;
  isLoadingStats?: boolean;
  checkResult?: CheckResult | null;
  onDismissCheckResult?: () => void;
}

const RepositoryCard: React.FC<RepositoryCardProps> = ({
  repository,
  isEditing,
  editingName,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onNameChange,
  onView,
  onCheck,
  onCompact,
  onPrune,
  onDelete,
  onLoadStats,
  isAdmin = false,
  isChecking = false,
  isLoadingStats = false,
  isCompacting = false,
  checkResult = null,
  onDismissCheckResult,
}) => {
  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="p-4">
        <div className="mb-3">
          <div className="flex flex-col mb-1">
            <div className="flex items-center space-x-2 mb-1">
              <Database className="w-5 h-5 text-blue-500 flex-shrink-0" />
              {isEditing ? (
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 text-lg font-medium border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSaveEdit();
                      if (e.key === 'Escape') onCancelEdit();
                    }}
                  />
                  <button
                    onClick={onSaveEdit}
                    className="p-1 text-green-600 hover:text-green-800 flex-shrink-0"
                    title="Save"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="p-1 text-red-600 hover:text-red-800 flex-shrink-0"
                    title="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <h3
                    className="text-lg font-medium text-gray-900 break-words line-clamp-2"
                    title={repository.name}
                  >
                    {repository.name}
                  </h3>
                  {repository.read_only && (
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full" title="Monitor only - no backups allowed">
                      Read-Only
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              {/* Borg Version Badge */}
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${repository.borg_version === '1.x'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-purple-100 text-purple-800'
                }`}>
                Borg {repository.borg_version || '2.x'}
              </span>
              {/* Encryption Badge */}
              <div className="flex items-center space-x-1">
                {getEncryptionIcon(repository.encryption)}
                <span className="text-xs text-gray-500 whitespace-nowrap">{repository.encryption}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-gray-500">Path</label>
            <p className="text-sm text-gray-900 font-mono break-all">{getDisplayPath(repository)}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Compression</label>
            <p className="text-sm text-gray-900">{getCompressionLabel(repository.compression)}</p>
          </div>

          {/* Usage Status */}
          <div>
            <label className="text-xs font-medium text-gray-500">Usage Status</label>
            {repository.isUsed ? (
              <div className="mt-1">
                <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  In Use
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Used in backup{repository.usedInBackups && repository.usedInBackups.length > 1 ? 's' : ''}:{' '}
                  <span className="font-semibold">{repository.usedInBackups?.join(', ')}</span>
                </p>
              </div>
            ) : (
              <div className="mt-1">
                <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Currently not in use
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This repository is not assigned to any backup configuration yet.
                </p>
              </div>
            )}
          </div>

          {/* Stats Section - Archives, Size, Last Backup */}
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500">Archives</label>
              <p className="text-sm text-gray-900">
                {repository.archive_count !== null && repository.archive_count !== undefined
                  ? repository.archive_count
                  : <span className="text-gray-400">—</span>}
              </p>
            </div>
            {repository.total_size && (
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500">Size</label>
                <p className="text-sm text-gray-900">{repository.total_size}</p>
              </div>
            )}
            {/* Load Stats button - shows when stats not loaded */}
            {onLoadStats && repository.archive_count === null && (
              <button
                onClick={onLoadStats}
                disabled={isLoadingStats}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Load archive count and size (may take a few seconds for remote repos)"
              >
                {isLoadingStats ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-3.5 h-3.5" />
                    <span>Load Stats</span>
                  </>
                )}
              </button>
            )}
          </div>

          {repository.last_backup && (
            <div>
              <label className="text-xs font-medium text-gray-500">Last Backup</label>
              <p className="text-sm text-gray-900">
                {formatDate(repository.last_backup)}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {isAdmin && (
          <div className="mt-4 pt-3 border-t border-gray-200">
            <div className="flex flex-wrap gap-1.5">
              <ActionButton
                icon={<Info className="w-3.5 h-3.5" />}
                label="Info"
                tooltip="View detailed repository statistics, encryption type, and location"
                onClick={onView}
                color="info"
                showInfoIcon={false}
              />
              <ActionButton
                icon={<CheckCircle className="w-3.5 h-3.5" />}
                label="Check"
                tooltip="Verify repository integrity. Detects data corruption in chunks and metadata. Recommended: Run monthly."
                onClick={onCheck}
                loading={isChecking}
                color="primary"
              />
              <ActionButton
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                label="Compact"
                tooltip="Reclaim disk space by removing unused data segments. Run after pruning old archives to free up storage."
                onClick={onCompact}
                loading={isCompacting}
                color="warning"
              />
              {onPrune && (
                <ActionButton
                  icon={<Scissors className="w-3.5 h-3.5" />}
                  label="Prune"
                  tooltip="Delete old archives based on retention rules (e.g., keep 7 daily, 4 weekly, 6 monthly). Frees space while keeping important backups."
                  onClick={onPrune}
                  color="secondary"
                />
              )}
              <ActionButton
                icon={<Edit2 className="w-3.5 h-3.5" />}
                label="Edit"
                tooltip="Edit repository settings including name, encryption passphrase, and other configuration options."
                onClick={onStartEdit}
                color="primary"
              />
              <ActionButton
                icon={<Trash2 className="w-3.5 h-3.5" />}
                label="Delete"
                tooltip="Remove repository from configuration. Optionally delete backup data from disk permanently."
                onClick={onDelete}
                color="error"
              />
            </div>

            {/* Check Result Banner */}
            {checkResult && (
              <div
                className={`mt-3 p-3 rounded-lg flex items-start gap-2 ${checkResult.status === 'success'
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
                  }`}
              >
                {checkResult.status === 'success' ? (
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${checkResult.status === 'success' ? 'text-green-800' : 'text-red-800'
                    }`}>
                    {checkResult.status === 'success' ? 'Check Completed Successfully' : 'Check Failed'}
                  </p>
                  <p className={`text-xs mt-0.5 break-words ${checkResult.status === 'success' ? 'text-green-700' : 'text-red-700'
                    }`}>
                    {checkResult.message}
                  </p>
                </div>
                {onDismissCheckResult && (
                  <button
                    onClick={onDismissCheckResult}
                    className={`p-1 rounded hover:bg-opacity-20 ${checkResult.status === 'success'
                      ? 'text-green-600 hover:bg-green-600'
                      : 'text-red-600 hover:bg-red-600'
                      }`}
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RepositoryCard;

