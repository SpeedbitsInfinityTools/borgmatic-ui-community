import React, { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import { backupAPI } from '../services/api';
import { useSSEContext } from '../contexts/SSEContext';
import {
  Play,
  Pause,
  X,
  Clock,
  HardDrive,
  FileText,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Loader,
  Archive,
  Activity,
  Eye,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import BackupJobLogsModal from './BackupJobLogsModal';

interface BackupJob {
  id: string;
  repository?: string;
  backup_name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  progress_percent?: number;
  current_file?: string;
  files_processed?: number;
  total_files?: number;
  bytes_processed?: number;
  bytes_total?: number;
  speed?: number;
  eta_seconds?: number;
  message?: string;
  error_message?: string;
}

interface BackupProgressCardProps {
  compact?: boolean;
  showCompleted?: boolean;
  maxJobs?: number;
}

// Format bytes to human-readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format duration
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

// Format speed
const formatSpeed = (bytesPerSecond: number): string => {
  return `${formatBytes(bytesPerSecond)}/s`;
};

// Calculate elapsed time
const getElapsedTime = (startedAt: string): number => {
  const start = new Date(startedAt).getTime();
  return (Date.now() - start) / 1000;
};

const BackupProgressCard: React.FC<BackupProgressCardProps> = ({
  compact = false,
  showCompleted = false,
  maxJobs = 5,
}) => {
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [viewingLogsJobId, setViewingLogsJobId] = useState<string | null>(null);
  const { lastEvent } = useSSEContext();

  // Fetch all backup jobs
  const { data: jobsData, refetch } = useQuery({
    queryKey: ['backup-jobs'],
    queryFn: () => backupAPI.getAllJobs(),
    refetchInterval: 2000, // Poll every 2 seconds
  });

  const allJobs: BackupJob[] = jobsData?.data?.data?.jobs || [];
  
  // Filter and sort jobs
  const jobs = allJobs
    .filter(job => showCompleted || job.status === 'running' || job.status === 'pending')
    .slice(0, maxJobs);

  const runningJobs = allJobs.filter(j => j.status === 'running');
  const hasRunningJobs = runningJobs.length > 0;

  // Listen for SSE events to refetch
  useEffect(() => {
    if (lastEvent?.type?.includes('backup')) {
      refetch();
    }
  }, [lastEvent, refetch]);

  const toggleExpanded = (jobId: string) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const handleCancel = async (jobId: string) => {
    try {
      await backupAPI.cancelJob(jobId);
      toast.success('Backup cancelled');
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to cancel backup');
    }
  };

  if (jobs.length === 0 && !hasRunningJobs) {
    return null; // Don't render if no jobs
  }

  return (
    <>
      <div className={`card overflow-hidden ${compact ? 'p-0' : ''}`}>
        {!compact && (
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-gray-900">Backup Progress</h3>
              {hasRunningJobs && (
                <span className="flex items-center space-x-1 text-xs text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span>{runningJobs.length} running</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className={`divide-y divide-gray-100 ${compact ? '' : 'max-h-96 overflow-y-auto'}`}>
          {jobs.map(job => (
            <JobProgressRow
              key={job.id}
              job={job}
              expanded={expandedJobs.has(job.id)}
              onToggle={() => toggleExpanded(job.id)}
              onCancel={() => handleCancel(job.id)}
              onViewLogs={() => setViewingLogsJobId(job.id)}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {/* Logs Modal */}
      {viewingLogsJobId && (
        <BackupJobLogsModal
          isOpen={true}
          onClose={() => setViewingLogsJobId(null)}
          jobId={viewingLogsJobId}
          jobStatus={allJobs.find(j => j.id === viewingLogsJobId)?.status}
          jobName={allJobs.find(j => j.id === viewingLogsJobId)?.backup_name}
        />
      )}
    </>
  );
};

// Individual job progress row
const JobProgressRow: React.FC<{
  job: BackupJob;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onViewLogs: () => void;
  compact: boolean;
}> = ({ job, expanded, onToggle, onCancel, onViewLogs, compact }) => {
  const [elapsedTime, setElapsedTime] = useState(0);

  // Update elapsed time for running jobs
  useEffect(() => {
    if (job.status === 'running') {
      const interval = setInterval(() => {
        setElapsedTime(getElapsedTime(job.started_at));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [job.status, job.started_at]);

  const progress = job.progress_percent || 0;
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const getStatusColor = () => {
    switch (job.status) {
      case 'running':
        return 'text-blue-600';
      case 'completed':
        return 'text-green-600';
      case 'failed':
        return 'text-red-600';
      case 'cancelled':
        return 'text-gray-600';
      default:
        return 'text-yellow-600';
    }
  };

  const getProgressBarColor = () => {
    if (isFailed) return 'bg-red-500';
    if (isCompleted) return 'bg-green-500';
    return 'bg-blue-500';
  };

  return (
    <div className={`${compact ? 'p-3' : 'p-4'} hover:bg-gray-50 transition-colors`}>
      {/* Main Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {/* Status Icon */}
          <div className={`flex-shrink-0 ${getStatusColor()}`}>
            {isRunning && <Loader className="w-5 h-5 animate-spin" />}
            {isCompleted && <CheckCircle className="w-5 h-5" />}
            {isFailed && <AlertCircle className="w-5 h-5" />}
            {job.status === 'pending' && <Clock className="w-5 h-5 text-yellow-500" />}
            {job.status === 'cancelled' && <X className="w-5 h-5" />}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-900 truncate">
                {job.backup_name || `Backup #${job.id.slice(-6)}`}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isRunning ? 'bg-blue-100 text-blue-700' :
                isCompleted ? 'bg-green-100 text-green-700' :
                isFailed ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {job.status}
              </span>
            </div>

            {/* Progress Bar */}
            {(isRunning || progress > 0) && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>
                    {job.current_file ? (
                      <span className="truncate max-w-xs inline-block align-bottom" title={job.current_file}>
                        {job.current_file.split('/').pop()}
                      </span>
                    ) : job.message || 'Processing...'}
                  </span>
                  <span className="font-medium">{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getProgressBarColor()} ${
                      isRunning ? 'animate-pulse' : ''
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              </div>
            )}

            {/* Quick Stats */}
            {isRunning && !compact && (
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatDuration(elapsedTime)}
                </span>
                {job.speed && (
                  <span className="flex items-center">
                    <Zap className="w-3 h-3 mr-1" />
                    {formatSpeed(job.speed)}
                  </span>
                )}
                {job.eta_seconds && (
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    ETA: {formatDuration(job.eta_seconds)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1 ml-4">
          <button
            onClick={onViewLogs}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="View logs"
          >
            <Eye className="w-4 h-4" />
          </button>
          {!compact && (
            <button
              onClick={onToggle}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          {isRunning && (
            <button
              onClick={onCancel}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Cancel backup"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && !compact && (
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Files */}
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Files</p>
              <p className="text-sm font-medium text-gray-900">
                {job.files_processed !== undefined 
                  ? `${job.files_processed.toLocaleString()}${job.total_files ? ` / ${job.total_files.toLocaleString()}` : ''}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Size */}
          <div className="flex items-center space-x-2">
            <HardDrive className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Size</p>
              <p className="text-sm font-medium text-gray-900">
                {job.bytes_processed !== undefined 
                  ? `${formatBytes(job.bytes_processed)}${job.bytes_total ? ` / ${formatBytes(job.bytes_total)}` : ''}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Speed */}
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Speed</p>
              <p className="text-sm font-medium text-gray-900">
                {job.speed ? formatSpeed(job.speed) : '—'}
              </p>
            </div>
          </div>

          {/* Duration / ETA */}
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">{isRunning ? 'ETA' : 'Duration'}</p>
              <p className="text-sm font-medium text-gray-900">
                {isRunning && job.eta_seconds 
                  ? formatDuration(job.eta_seconds)
                  : job.completed_at 
                    ? formatDuration((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
                    : formatDuration(elapsedTime)}
              </p>
            </div>
          </div>

          {/* Current File (full path) */}
          {job.current_file && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-gray-500 mb-1">Current File</p>
              <p className="text-xs font-mono text-gray-700 bg-gray-50 p-2 rounded truncate" title={job.current_file}>
                {job.current_file}
              </p>
            </div>
          )}

          {/* Error Message */}
          {job.error_message && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-red-500 mb-1">Error</p>
              <p className="text-xs font-mono text-red-700 bg-red-50 p-2 rounded">
                {job.error_message}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BackupProgressCard;

