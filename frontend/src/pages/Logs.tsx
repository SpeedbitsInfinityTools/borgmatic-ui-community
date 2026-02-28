import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { 
  FileText, 
  Search, 
  Filter, 
  Download, 
  RefreshCw, 
  AlertTriangle, 
  Info, 
  CheckCircle,
  BarChart3,
  Play,
  Pause,
} from 'lucide-react';
import { logsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import TerminalLogViewer from '../components/TerminalLogViewer';

const Logs: React.FC = () => {
  const [selectedLogType, setSelectedLogType] = useState('borgmatic');
  const [lines, setLines] = useState(200);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);

  const queryClient = useQueryClient();

  // Fetch log types
  const { data: logTypes } = useQuery({
    queryKey: ['logTypes'],
    queryFn: logsAPI.getLogTypes,
  });

  // Fetch logs
  const { data: logsData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs', selectedLogType, lines, searchTerm, levelFilter, startTime, endTime],
    queryFn: () => logsAPI.getLogs({
      log_type: selectedLogType,
      lines,
      search: searchTerm || undefined,
      level: levelFilter || undefined,
      start_time: startTime || undefined,
      end_time: endTime || undefined,
    }),
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
  });

  // Fetch log statistics
  const { data: statsData } = useQuery({
    queryKey: ['logStats', selectedLogType],
    queryFn: () => logsAPI.getLogStats({
      log_type: selectedLogType,
      hours: 24,
    }),
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
  });

  // Clear logs mutation
  const clearLogsMutation = useMutation({
    mutationFn: logsAPI.clearLogs,
    onSuccess: () => {
      toast.success('Logs cleared successfully');
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      queryClient.invalidateQueries({ queryKey: ['logStats'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to clear logs');
    },
  });

  // Download logs
  const downloadLogs = () => {
    if (!logsData?.data?.logs) return;
    
    const content = logsData.data.logs.join('');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLogType}_logs_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Logs downloaded');
  };

  const handleClearLogs = () => {
    if (window.confirm('Are you sure you want to clear all logs for this log type?')) {
      clearLogsMutation.mutate({ log_type: selectedLogType });
    }
  };

  const logs = logsData?.data?.logs || [];
  const logTypeName = logTypes?.data?.log_types?.find((t: any) => t.id === selectedLogType)?.name || 'Logs';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
          <p className="text-gray-600">Monitor and analyze system and backup logs</p>
        </div>
        <div className="flex items-center space-x-2">
          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center px-3 py-2 text-sm font-medium border rounded-md transition-colors ${
              autoRefresh
                ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {autoRefresh ? (
              <>
                <Pause className="w-4 h-4 mr-2" />
                <span>Streaming ({refreshInterval}s)</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                <span>Stream</span>
              </>
            )}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={downloadLogs}
            className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Download
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      {statsData?.data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white p-3 rounded-lg border shadow-sm">
            <div className="flex items-center">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <span className="ml-2 text-xs font-medium text-gray-600">Total Entries</span>
            </div>
            <p className="text-xl font-bold text-gray-900 mt-1">{statsData.data.stats.total_entries.toLocaleString()}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border shadow-sm">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="ml-2 text-xs font-medium text-gray-600">Errors (24h)</span>
            </div>
            <p className="text-xl font-bold text-red-600 mt-1">{statsData.data.stats.error_count}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border shadow-sm">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="ml-2 text-xs font-medium text-gray-600">Warnings (24h)</span>
            </div>
            <p className="text-xl font-bold text-yellow-600 mt-1">{statsData.data.stats.warning_count}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border shadow-sm">
            <div className="flex items-center">
              <Info className="w-4 h-4 text-blue-500" />
              <span className="ml-2 text-xs font-medium text-gray-600">Info (24h)</span>
            </div>
            <p className="text-xl font-bold text-blue-600 mt-1">{statsData.data.stats.info_count}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border shadow-sm">
            <div className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="ml-2 text-xs font-medium text-gray-600">Success Rate</span>
            </div>
            <p className="text-xl font-bold text-green-600 mt-1">{statsData.data.stats.success_rate.toFixed(1)}%</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Log Type Selector */}
          <div className="min-w-[150px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Log Type</label>
            <select
              value={selectedLogType}
              onChange={(e) => setSelectedLogType(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {logTypes?.data?.log_types?.map((type: any) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          {/* Lines Selector */}
          <div className="w-24">
            <label className="block text-xs font-medium text-gray-700 mb-1">Lines</label>
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={-1}>All</option>
            </select>
          </div>

          {/* Level Filter */}
          <div className="w-32">
            <label className="block text-xs font-medium text-gray-700 mb-1">Level</label>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">All Levels</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
            </select>
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Filters Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center px-3 py-2 text-sm font-medium border rounded-md h-[38px] ${
              showFilters
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4 mr-2" />
            More
          </button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Interval (s)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Math.max(1, Number(e.target.value)))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setLevelFilter('');
                    setStartTime('');
                    setEndTime('');
                  }}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Terminal Log Viewer */}
      <TerminalLogViewer
        logs={logs}
        title={logTypeName}
        isLoading={isLoading}
        isStreaming={autoRefresh}
        maxHeight="600px"
        showLineNumbers={true}
        showTimestamps={true}
        showSearch={true}
        showControls={true}
        autoScroll={autoRefresh}
        onClear={handleClearLogs}
      />
    </div>
  );
};

export default Logs;
