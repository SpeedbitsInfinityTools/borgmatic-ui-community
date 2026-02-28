import React, { useState, useMemo } from 'react';
import { useQuery } from 'react-query';
import { backupAPI } from '../services/api';
import {
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  Clock,
  HardDrive,
  FileText,
  Filter,
  Copy,
  Download,
  RefreshCw,
  Loader,
  Play,
  ChevronDown,
  ChevronUp,
  Database,
  Archive,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import TerminalLogViewer from './TerminalLogViewer';

interface BackupJobLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  jobStatus?: string;
  jobName?: string;
}

interface ParsedLogEntry {
  type: 'log_message' | 'progress' | 'archive_progress' | 'finish' | 'file_status' | 'unknown';
  timestamp?: string;
  level?: 'error' | 'warning' | 'info' | 'success' | 'debug';
  message: string;
  raw: string;
  data?: any;
}

// Parse borgmatic JSON log output
const parseBorgmaticLogs = (logsString: string): ParsedLogEntry[] => {
  const entries: ParsedLogEntry[] = [];
  
  if (!logsString) return entries;
  
  const lines = logsString.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Try to parse as JSON
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        const entry: ParsedLogEntry = {
          type: json.type || 'unknown',
          timestamp: json.time,
          message: '',
          raw: trimmed,
          data: json,
        };
        
        // Determine level and message based on type
        switch (json.type) {
          case 'log_message':
            entry.level = json.levelname?.toLowerCase() === 'error' ? 'error' :
                         json.levelname?.toLowerCase() === 'warning' ? 'warning' :
                         json.levelname?.toLowerCase() === 'info' ? 'info' : 'debug';
            entry.message = json.message || '';
            break;
          case 'progress_percent':
          case 'progress_message':
            entry.level = 'info';
            entry.message = json.message || `Progress: ${json.current}/${json.total}`;
            break;
          case 'archive_progress':
            entry.level = 'info';
            entry.message = `Archiving: ${json.path || ''} (${formatBytes(json.nfiles || 0)} files)`;
            break;
          case 'file_status':
            entry.level = 'debug';
            entry.message = `${json.status}: ${json.path}`;
            break;
          case 'finish':
            entry.level = 'success';
            entry.message = 'Backup completed';
            break;
          default:
            entry.message = JSON.stringify(json);
        }
        
        entries.push(entry);
        continue;
      } catch (e) {
        // Not valid JSON, fall through to text parsing
      }
    }
    
    // Parse as plain text
    const entry: ParsedLogEntry = {
      type: 'log_message',
      message: trimmed,
      raw: trimmed,
    };
    
    // Determine level from content
    const lower = trimmed.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) {
      entry.level = 'error';
    } else if (lower.includes('warning') || lower.includes('warn')) {
      entry.level = 'warning';
    } else if (lower.includes('success') || lower.includes('completed')) {
      entry.level = 'success';
    } else if (lower.includes('starting') || lower.includes('creating') || lower.includes('info')) {
      entry.level = 'info';
    } else {
      entry.level = 'debug';
    }
    
    // Try to extract timestamp
    const timestampMatch = trimmed.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
    if (timestampMatch) {
      entry.timestamp = timestampMatch[1];
    }
    
    entries.push(entry);
  }
  
  return entries;
};

// Format bytes to human-readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get stats from parsed logs
const getLogStats = (entries: ParsedLogEntry[]) => {
  const errors = entries.filter(e => e.level === 'error');
  const warnings = entries.filter(e => e.level === 'warning');
  const archiveStats = entries.find(e => e.type === 'finish' || e.data?.stats);
  
  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    archiveStats: archiveStats?.data?.stats,
  };
};

const BackupJobLogsModal: React.FC<BackupJobLogsModalProps> = ({
  isOpen,
  onClose,
  jobId,
  jobStatus,
  jobName,
}) => {
  const [viewMode, setViewMode] = useState<'parsed' | 'raw'>('parsed');
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [showStats, setShowStats] = useState(true);

  // Fetch logs
  const { data: logsData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['backup-logs', jobId],
    queryFn: () => backupAPI.getLogs(jobId),
    enabled: isOpen && !!jobId,
    refetchInterval: jobStatus === 'running' ? 2000 : false,
  });

  const logs = logsData?.data?.data?.logs || '';
  const errorMessage = logsData?.data?.data?.error_message || '';

  // Parse logs
  const parsedLogs = useMemo(() => parseBorgmaticLogs(logs), [logs]);
  const stats = useMemo(() => getLogStats(parsedLogs), [parsedLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (filter === 'all') return parsedLogs;
    if (filter === 'errors') return parsedLogs.filter(e => e.level === 'error');
    if (filter === 'warnings') return parsedLogs.filter(e => e.level === 'warning' || e.level === 'error');
    return parsedLogs;
  }, [parsedLogs, filter]);

  // Get status badge color
  const getStatusBadge = () => {
    switch (jobStatus) {
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Copy logs
  const copyLogs = async () => {
    await navigator.clipboard.writeText(logs);
    toast.success('Logs copied to clipboard');
  };

  // Download logs
  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${jobId}_logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Logs downloaded');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Backup Logs</h2>
              <div className="flex items-center space-x-2 mt-0.5">
                {jobName && <span className="text-sm text-gray-600">{jobName}</span>}
                {jobStatus && (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadge()}`}>
                    {jobStatus}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-300">
              <button
                onClick={() => setViewMode('parsed')}
                className={`px-3 py-1.5 text-sm font-medium ${
                  viewMode === 'parsed'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Parsed
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-3 py-1.5 text-sm font-medium ${
                  viewMode === 'raw'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Raw
              </button>
            </div>

            {/* Filter */}
            {viewMode === 'parsed' && (
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">All Logs ({parsedLogs.length})</option>
                  <option value="errors">Errors Only ({stats.errorCount})</option>
                  <option value="warnings">Warnings & Errors ({stats.errorCount + stats.warningCount})</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {jobStatus === 'running' && (
              <span className="flex items-center space-x-1 text-xs text-green-600">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span>Live</span>
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={copyLogs}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Copy logs"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={downloadLogs}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Download logs"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Summary */}
        {viewMode === 'parsed' && showStats && (stats.errorCount > 0 || stats.warningCount > 0 || stats.archiveStats) && (
          <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
            <button
              onClick={() => setShowStats(!showStats)}
              className="flex items-center justify-between w-full"
            >
              <span className="text-sm font-medium text-gray-700">Summary</span>
              {showStats ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              {stats.errorCount > 0 && (
                <div className="flex items-center space-x-2 p-2 bg-red-50 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-700">{stats.errorCount} Errors</span>
                </div>
              )}
              {stats.warningCount > 0 && (
                <div className="flex items-center space-x-2 p-2 bg-yellow-50 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm text-yellow-700">{stats.warningCount} Warnings</span>
                </div>
              )}
              {stats.archiveStats?.nfiles !== undefined && (
                <div className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-blue-700">{stats.archiveStats.nfiles} Files</span>
                </div>
              )}
              {stats.archiveStats?.original_size !== undefined && (
                <div className="flex items-center space-x-2 p-2 bg-green-50 rounded-lg">
                  <HardDrive className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-700">{formatBytes(stats.archiveStats.original_size)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Message Banner */}
        {errorMessage && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">Error Message</p>
                <p className="text-sm text-red-700 mt-1 font-mono">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : viewMode === 'raw' ? (
            <TerminalLogViewer
              logs={logs.split('\n')}
              title="Raw Logs"
              maxHeight="calc(90vh - 300px)"
              showControls={false}
              showSearch={true}
            />
          ) : (
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 300px)' }}>
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mb-2 text-gray-300" />
                  <p>{logs ? 'No matching log entries' : 'No logs available yet'}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredLogs.map((entry, idx) => (
                    <ParsedLogEntry key={idx} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {parsedLogs.length} log entries
          </span>
          <button onClick={onClose} className="btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Parsed Log Entry Component
const ParsedLogEntry: React.FC<{ entry: ParsedLogEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);

  const getLevelStyles = () => {
    switch (entry.level) {
      case 'error':
        return 'bg-red-50 border-l-4 border-red-500';
      case 'warning':
        return 'bg-yellow-50 border-l-4 border-yellow-500';
      case 'success':
        return 'bg-green-50 border-l-4 border-green-500';
      case 'info':
        return 'bg-blue-50 border-l-4 border-blue-500';
      default:
        return 'bg-gray-50 border-l-4 border-gray-300';
    }
  };

  const getLevelIcon = () => {
    const iconClass = 'w-4 h-4 flex-shrink-0';
    switch (entry.level) {
      case 'error':
        return <AlertCircle className={`${iconClass} text-red-500`} />;
      case 'warning':
        return <AlertTriangle className={`${iconClass} text-yellow-500`} />;
      case 'success':
        return <CheckCircle className={`${iconClass} text-green-500`} />;
      case 'info':
        return <Info className={`${iconClass} text-blue-500`} />;
      default:
        return <FileText className={`${iconClass} text-gray-400`} />;
    }
  };

  const hasData = entry.data && Object.keys(entry.data).length > 2;

  return (
    <div className={`px-4 py-3 ${getLevelStyles()}`}>
      <div className="flex items-start space-x-3">
        {getLevelIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 flex-wrap">
            {entry.timestamp && (
              <span className="text-xs text-gray-500 font-mono">{entry.timestamp}</span>
            )}
            {entry.level && (
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded uppercase ${
                entry.level === 'error' ? 'bg-red-100 text-red-700' :
                entry.level === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                entry.level === 'success' ? 'bg-green-100 text-green-700' :
                entry.level === 'info' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {entry.level}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
            {entry.message}
          </p>
          
          {hasData && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span>{expanded ? 'Hide details' : 'Show details'}</span>
            </button>
          )}
          
          {expanded && entry.data && (
            <pre className="mt-2 p-2 bg-gray-900 text-green-400 text-xs rounded overflow-x-auto font-mono">
              {JSON.stringify(entry.data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default BackupJobLogsModal;

