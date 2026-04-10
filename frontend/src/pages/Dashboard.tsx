import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { configParserAPI, backupsAPI, scheduleAPI, identityAPI, logsAPI, dashboardAPI, settingsAPI, ntfyAPI, appriseAPI } from '../services/api';
import { CheckCircle, XCircle, Loader, RefreshCw, Database, FileText, Clock, Download, Upload, AlertTriangle, Activity, Info, Wrench, HeartPulse, KeyRound, Cloud, Package, Bell, MessageSquare } from 'lucide-react';
import { useBackupExecution } from '../hooks/useSSE';
import { formatDateTime } from '../utils/dateFormat';
import { calculateNextRun } from '../utils/cronNextRun';
import { getSafeDisplayPath } from '../utils/repositoryUtils';
import DirectorDashboard from '../components/DirectorDashboard';
import { useDirector } from '../contexts/DirectorContext';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isDirectorMode, isRemoteSession, selectedClient } = useDirector();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [showSecurityWarning, setShowSecurityWarning] = useState(true);

  // Check if accessing from localhost or LAN
  useEffect(() => {
    const hostname = window.location.hostname;

    // Check if localhost
    const isLocalhost = hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]';

    // Check if LAN IP (private IP ranges)
    const isLAN = /^10\./.test(hostname) ||                    // 10.0.0.0 - 10.255.255.255
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) || // 172.16.0.0 - 172.31.255.255
      /^192\.168\./.test(hostname) ||               // 192.168.0.0 - 192.168.255.255
      /^169\.254\./.test(hostname);                 // 169.254.0.0 - 169.254.255.255 (link-local)

    // Hide warning if localhost or LAN
    if (isLocalhost || isLAN) {
      setShowSecurityWarning(false);
    }
  }, []);

  // Check operating mode
  useEffect(() => {
    const checkMode = async () => {
      try {
        const response = await identityAPI.getStatus();
        setMode(response.data.data.mode);
      } catch (error) {
        console.error('Failed to check mode:', error);
      }
    };
    checkMode();
  }, []);

  // Config parser state
  const { data: configState, isLoading: configLoading, refetch: refreshConfigs } = useQuery(
    'config-parser-state',
    () => configParserAPI.getState().then(res => res.data.data),
    {
      refetchOnMount: true,
      staleTime: 30000,
    }
  );

  // Get all backups
  const { data: backupsData, isLoading: backupsLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsAPI.getBackups().then(res => res.data),
    refetchInterval: 30000,
  });

  // Get schedules for next run calculation
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => scheduleAPI.getSchedules().then(res => res.data),
  });

  // Get recent log events (last 5 with errors/warnings)
  const { data: recentLogsData } = useQuery({
    queryKey: ['recent-logs'],
    queryFn: () => logsAPI.getLogs({
      log_type: 'borgmatic',
      lines: 10,
    }).then(res => res.data),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Real-time backup execution status
  const { isRunning } = useBackupExecution();

  // Tools health check
  const queryClient = useQueryClient();
  const { data: toolsHealthData, isLoading: toolsHealthLoading, refetch: refetchToolsHealth } = useQuery(
    'tools-health',
    () => dashboardAPI.getToolsHealth().then(res => res.data.data),
    {
      staleTime: 60000, // Cache for 1 minute
      retry: 1, // Don't retry too many times
    }
  );

  // Vault health check
  const { data: vaultHealthData, isLoading: vaultHealthLoading, refetch: refetchVaultHealth } = useQuery(
    'vault-health',
    () => dashboardAPI.getVaultHealth().then(res => res.data.data),
    {
      staleTime: 60000, // Cache for 1 minute
      retry: 1,
    }
  );

  // Redis/Cache status
  const { data: cacheStatusData, refetch: refetchCacheStatus } = useQuery(
    'cache-status',
    () => settingsAPI.getCacheStatus().then(res => res.data.cache),
    {
      staleTime: 60000, // Cache for 1 minute
      retry: 1,
    }
  );

  // ntfy notification status
  const { data: ntfyStatusData, refetch: refetchNtfyStatus } = useQuery(
    'ntfy-status',
    () => ntfyAPI.getStatus().then(res => res.data),
    {
      staleTime: 60000,
      retry: 1,
    }
  );

  // Apprise notification status
  const { data: appriseStatusData, refetch: refetchAppriseStatus } = useQuery(
    'apprise-status',
    () => appriseAPI.getStatus().then(res => res.data),
    {
      staleTime: 60000,
      retry: 1,
    }
  );

  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const handleCheckHealth = async () => {
    setIsCheckingHealth(true);
    await Promise.all([refetchToolsHealth(), refetchVaultHealth(), refetchCacheStatus(), refetchNtfyStatus(), refetchAppriseStatus()]);
    setIsCheckingHealth(false);
  };

  const [isResettingVault, setIsResettingVault] = useState(false);
  const handleResetVault = async () => {
    if (!confirm('Are you sure you want to reset the passphrase vault? You will need to re-enter passphrases for all encrypted repositories.')) {
      return;
    }
    setIsResettingVault(true);
    try {
      await dashboardAPI.resetVault();
      toast.success('Passphrase vault has been reset');
      await refetchVaultHealth();
    } catch (error) {
      toast.error('Failed to reset passphrase vault');
    } finally {
      setIsResettingVault(false);
    }
  };

  const backups = backupsData?.data?.backups || [];
  const schedules = schedulesData?.data?.schedules || [];

  // Calculate counts
  const backupsCount = backups.length;
  const activeBackupsCount = backups.filter((b: any) => b.is_active).length;
  const repositoriesCount = configState?.totalUnusedRepos || 0 + (configState?.configs?.reduce((sum: number, config: any) => sum + (config.repositories?.length || 0), 0) || 0);

  const isLoading = configLoading || backupsLoading;

  // Handle refresh with minimum 3-second delay
  const handleRefreshConfigs = async () => {
    setIsRefreshing(true);
    const minDelay = new Promise(resolve => setTimeout(resolve, 3000));
    await Promise.all([refreshConfigs(), minDelay]);
    setIsRefreshing(false);
  };


  // Calculate next run from cron
  const getNextRun = (scheduleId: string | null): string => {
    if (!scheduleId) return 'Not scheduled';
    const schedule = schedules.find((s: any) => s.id === scheduleId);
    if (!schedule || !schedule.cron_expression) return 'N/A';
    return calculateNextRun(schedule.cron_expression);
  };

  // Truncate long paths for display
  const truncatePath = (path: string, maxLength: number = 30): string => {
    if (path.length <= maxLength) return path;
    return '...' + path.slice(-(maxLength - 3));
  };

  const stripTimestamp = (logLine: string): { message: string; timestamp: string } => {
    const timestampMatch = logLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const timestamp = timestampMatch ? timestampMatch[1] : '';
    const message = timestamp ? logLine.replace(timestamp, '').trim() : logLine;
    return { message, timestamp };
  };

  // Clean log line by removing metadata
  const cleanLogLine = (logLine: string): string => {
    // Remove log metadata like [,264], [,962] etc.
    let cleaned = logLine.replace(/^\[\s*,?\d+\]\s*/g, '');

    // Remove additional metadata patterns
    cleaned = cleaned.replace(/^\[\d+,\d+\]\s*/g, '');

    // Remove log level prefixes (INFO:, WARNING:, ERROR:, DEBUG:, CRITICAL:)
    cleaned = cleaned.replace(/^(INFO|WARNING|ERROR|DEBUG|CRITICAL):\s*/i, '');

    return cleaned.trim();
  };

  // Check if a log line has meaningful content (not just a log level or timestamp)
  const hasLogContent = (logLine: string): boolean => {
    const { message } = stripTimestamp(logLine);
    const cleaned = cleanLogLine(message);
    if (!cleaned || cleaned.length === 0) return false;
    if (/^summary:?\s*$/i.test(cleaned)) return false;
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cleaned)) return false;
    return true;
  };

  // Get log level icon and color
  const getLogLevelInfo = (logLine: string) => {
    const line = logLine.toUpperCase();
    if (line.includes('CRITICAL') || line.includes('ERROR') || line.includes('FAILED')) {
      return { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50', borderColor: 'border-red-200' };
    }
    if (line.includes('WARNING') || line.includes('WARN')) {
      return { icon: AlertTriangle, color: 'text-yellow-500', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' };
    }
    if (line.includes('SUCCESS') || line.includes('COMPLETED')) {
      return { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50', borderColor: 'border-green-200' };
    }
    return { icon: Info, color: 'text-blue-500', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' };
  };

  // Show Director Dashboard if in director mode AND not viewing a remote client
  // When a client is selected (isRemoteSession), show the client's dashboard instead
  if (mode === 'director' && !isRemoteSession) {
    return <DirectorDashboard />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <>
      {/* Import/Export moved to Settings → Export / Import */}

      {/* Blocking Modal: Vault Decryption Failed */}
      {vaultHealthData?.status === 'error' && vaultHealthData?.details?.can_decrypt === false && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="bg-red-600 px-6 py-4">
              <h2 className="text-xl font-bold text-white flex items-center">
                <KeyRound className="w-6 h-6 mr-2" />
                Passphrase Vault Inaccessible
              </h2>
            </div>
            <div className="p-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 font-medium">
                  {vaultHealthData.message}
                </p>
              </div>

              <div className="space-y-3 text-sm text-gray-700">
                <h3 className="font-semibold text-gray-900">What happened?</h3>
                <p>{vaultHealthData.recovery_info?.explanation}</p>

                <h3 className="font-semibold text-gray-900 pt-2">How to fix this:</h3>
                <ul className="list-disc pl-5 space-y-2">
                  {vaultHealthData.recovery_info?.solutions?.map((solution: string, idx: number) => (
                    <li key={idx}>{solution}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 flex flex-col space-y-3">
                <button
                  onClick={handleResetVault}
                  disabled={isResettingVault}
                  className="w-full px-4 py-3 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                >
                  {isResettingVault ? 'Resetting...' : 'Reset Vault (I will re-enter passphrases)'}
                </button>
                <p className="text-xs text-center text-gray-500">
                  Note: Repository configurations are NOT affected. Only stored passphrases will be cleared.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isRemoteSession ? `Dashboard: ${selectedClient?.client_name}` : 'Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {isRemoteSession
                ? `Viewing backup configurations on ${selectedClient?.client_name}`
                : 'Overview of all backup configurations'}
            </p>
          </div>

          <div className="flex items-center space-x-2 flex-wrap">
            <a
              href="https://docs.speedbits.io/books/borgmatic-director-ui/page/dashboard-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors whitespace-nowrap flex-shrink-0"
            >
              📖 Read this first!
            </a>
            <button
              onClick={() => navigate('/settings?tab=export-import')}
              className="btn-secondary flex items-center space-x-2 whitespace-nowrap flex-shrink-0"
            >
              <Package className="w-4 h-4 flex-shrink-0" />
              <span>Import / Export</span>
            </button>

            <button
              onClick={handleRefreshConfigs}
              disabled={isRefreshing}
              className={`btn-secondary flex items-center space-x-2 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0 ${isRefreshing ? 'animate-pulse' : ''
                }`}
            >
              <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600">Total Backups</p>
                <p className="mt-2 text-3xl font-bold text-blue-900">{backupsCount}</p>
              </div>
              <FileText className="h-12 w-12 text-blue-400" />
            </div>
          </div>

          <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">Active</p>
                <p className="mt-2 text-3xl font-bold text-green-900">{activeBackupsCount}</p>
              </div>
              <CheckCircle className="h-12 w-12 text-green-400" />
            </div>
          </div>

          <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600">Repositories</p>
                <p className="mt-2 text-3xl font-bold text-purple-900">{repositoriesCount}</p>
              </div>
              <Database className="h-12 w-12 text-purple-400" />
            </div>
          </div>
        </div>

        {/* Tools Health Check Widget */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center">
              <HeartPulse className="w-5 h-5 text-gray-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900">Backup Tools Health</h2>
            </div>
            <button
              onClick={handleCheckHealth}
              disabled={isCheckingHealth || toolsHealthLoading}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isCheckingHealth || toolsHealthLoading ? 'animate-spin' : ''}`} />
              {isCheckingHealth || toolsHealthLoading ? 'Checking...' : 'Check Health'}
            </button>
          </div>
          <div className="p-6">
            {toolsHealthLoading && !toolsHealthData ? (
              <div className="flex items-center justify-center py-4">
                <Loader className="w-6 h-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Checking tools...</span>
              </div>
            ) : toolsHealthData ? (
              <div className="space-y-4">
                {/* Overall Status */}
                <div className={`flex items-center p-3 rounded-lg ${toolsHealthData.status === 'healthy' ? 'bg-green-50 border border-green-200' :
                  toolsHealthData.status === 'warning' ? 'bg-yellow-50 border border-yellow-200' :
                    'bg-red-50 border border-red-200'
                  }`}>
                  {toolsHealthData.status === 'healthy' ? (
                    <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                  ) : toolsHealthData.status === 'warning' ? (
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mr-2" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 mr-2" />
                  )}
                  <span className={`font-medium ${toolsHealthData.status === 'healthy' ? 'text-green-800' :
                    toolsHealthData.status === 'warning' ? 'text-yellow-800' :
                      'text-red-800'
                    }`}>
                    {toolsHealthData.message}
                  </span>
                </div>

                {/* Individual Tool Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Borg Status */}
                  <div className={`p-4 rounded-lg border ${toolsHealthData.tools?.borg?.available ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Wrench className={`w-5 h-5 mr-2 ${toolsHealthData.tools?.borg?.available ? 'text-green-600' : 'text-red-600'
                          }`} />
                        <span className="font-semibold text-gray-900">Borg</span>
                      </div>
                      {toolsHealthData.tools?.borg?.available ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    {toolsHealthData.tools?.borg?.available ? (
                      <div className="mt-2 text-sm text-green-700">
                        <p>{toolsHealthData.tools.borg.version}</p>
                        {toolsHealthData.tools.borg.versions && Object.keys(toolsHealthData.tools.borg.versions).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {Object.entries(toolsHealthData.tools.borg.versions as Record<string, string>).map(([key, ver]) => (
                              <span key={key} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                {key}: {ver}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-red-700">
                        {toolsHealthData.tools?.borg?.error || 'Not installed'}
                      </p>
                    )}
                  </div>

                  {/* Borgmatic Status */}
                  <div className={`p-4 rounded-lg border ${toolsHealthData.tools?.borgmatic?.available ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Wrench className={`w-5 h-5 mr-2 ${toolsHealthData.tools?.borgmatic?.available ? 'text-green-600' : 'text-red-600'
                          }`} />
                        <span className="font-semibold text-gray-900">Borgmatic</span>
                      </div>
                      {toolsHealthData.tools?.borgmatic?.available ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    <p className={`mt-2 text-sm ${toolsHealthData.tools?.borgmatic?.available ? 'text-green-700' : 'text-red-700'
                      }`}>
                      {toolsHealthData.tools?.borgmatic?.available
                        ? toolsHealthData.tools.borgmatic.version
                        : toolsHealthData.tools?.borgmatic?.error || 'Not installed'}
                    </p>
                  </div>

                  {/* Rclone Status (optional) */}
                  <div className={`p-4 rounded-lg border ${toolsHealthData.tools?.rclone?.available ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Cloud className={`w-5 h-5 mr-2 ${toolsHealthData.tools?.rclone?.available ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        <span className="font-semibold text-gray-900">Rclone</span>
                        <span className="ml-1.5 text-xs text-gray-400">(optional)</span>
                      </div>
                      {toolsHealthData.tools?.rclone?.available ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <span className="text-xs text-gray-400">Not installed</span>
                      )}
                    </div>
                    {toolsHealthData.tools?.rclone?.available ? (
                      <p className="mt-2 text-sm text-green-700">
                        v{toolsHealthData.tools.rclone.version} • {toolsHealthData.tools.rclone.remotes_count ?? 0} remote(s)
                      </p>
                    ) : (
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">
                          Required for cloud storage sync (S3, B2, Google Drive, etc.)
                        </p>
                        <p className="mt-1 text-xs text-blue-600">
                          💡 Install Rclone on the host: <code className="bg-blue-100 px-1 rounded">apt install rclone</code>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Redis Cache Status (optional) */}
                  <div className={`p-4 rounded-lg border ${cacheStatusData?.connected ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Database className={`w-5 h-5 mr-2 ${cacheStatusData?.connected ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        <span className="font-semibold text-gray-900">Redis Cache</span>
                        <span className="ml-1.5 text-xs text-gray-400">(optional)</span>
                      </div>
                      {cacheStatusData?.connected ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <span className="text-xs text-gray-400">Not running</span>
                      )}
                    </div>
                    <p className={`mt-2 text-sm ${cacheStatusData?.connected ? 'text-green-700' : 'text-gray-500'
                      }`}>
                      {cacheStatusData?.connected
                        ? `${cacheStatusData.host}:${cacheStatusData.port} • ${cacheStatusData.memory_used || 'N/A'} used`
                        : 'Speeds up Borg 1.x archive browsing'}
                    </p>
                  </div>

                  {/* ntfy Status (optional) */}
                  <div className={`p-4 rounded-lg border ${ntfyStatusData?.enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Bell className={`w-5 h-5 mr-2 ${ntfyStatusData?.enabled ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        <span className="font-semibold text-gray-900">ntfy</span>
                        <span className="ml-1.5 text-xs text-gray-400">(optional)</span>
                      </div>
                      {ntfyStatusData?.enabled ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <span className="text-xs text-gray-400">Not configured</span>
                      )}
                    </div>
                    {ntfyStatusData?.enabled ? (
                      <p className="mt-2 text-sm text-green-700">
                        {ntfyStatusData.server ? new URL(ntfyStatusData.server).hostname : 'ntfy.sh'} • {ntfyStatusData.topic || 'No topic'}
                      </p>
                    ) : (
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">Push notifications to your phone</p>
                        <Link to="/notifications" className="mt-1 text-xs text-blue-600 hover:text-blue-800 inline-flex items-center">
                          💡 Configure in Notifications
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* Apprise Status (optional) */}
                  <div className={`p-4 rounded-lg border ${appriseStatusData?.apprise_installed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <MessageSquare className={`w-5 h-5 mr-2 ${appriseStatusData?.apprise_installed ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        <span className="font-semibold text-gray-900">Apprise</span>
                        <span className="ml-1.5 text-xs text-gray-400">(optional)</span>
                      </div>
                      {appriseStatusData?.apprise_installed ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <span className="text-xs text-gray-400">Not configured</span>
                      )}
                    </div>
                    {appriseStatusData?.apprise_installed ? (
                      <div className="mt-2 text-sm text-green-700">
                        <p>
                          {appriseStatusData.api_enabled 
                            ? `API: ${appriseStatusData.api_url ? new URL(appriseStatusData.api_url).hostname : 'configured'}`
                            : appriseStatusData.cli_available 
                              ? 'CLI mode'
                              : 'API mode'
                          }
                        </p>
                        <p className="text-xs mt-0.5">
                          {(appriseStatusData.success?.urlCount || 0) + (appriseStatusData.failure?.urlCount || 0) + (appriseStatusData.warning?.urlCount || 0)} destination(s)
                        </p>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">80+ notification services</p>
                        <Link to="/notifications" className="mt-1 text-xs text-blue-600 hover:text-blue-800 inline-flex items-center">
                          💡 Configure in Notifications
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Help text if tools are missing */}
                {toolsHealthData.status !== 'healthy' && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Installation Help:</strong> Visit{' '}
                      <a href="https://borgbackup.readthedocs.io/en/stable/installation.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-blue-900">
                        Borg Installation
                      </a>{' '}and{' '}
                      <a href="https://torsion.org/borgmatic/docs/how-to/set-up-backups/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-blue-900">
                        Borgmatic Setup
                      </a>{' '}for instructions.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">
                <p>Click "Check Health" to verify backup tools installation.</p>
              </div>
            )}
          </div>
        </div>

        {/* Passphrase Vault Health Widget */}
        {vaultHealthData && (vaultHealthData.status === 'error' || vaultHealthData.status === 'warning') && (
          <div className={`card ${vaultHealthData.status === 'error' ? 'border-red-300 bg-red-50' : 'border-yellow-300 bg-yellow-50'
            }`}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center">
                <KeyRound className={`w-5 h-5 mr-2 ${vaultHealthData.status === 'error' ? 'text-red-600' : 'text-yellow-600'
                  }`} />
                <h2 className="text-lg font-semibold text-gray-900">Passphrase Vault</h2>
              </div>
              {vaultHealthData.status === 'error' && (
                <button
                  onClick={handleResetVault}
                  disabled={isResettingVault}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 border border-red-300 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                >
                  {isResettingVault ? 'Resetting...' : 'Reset Vault'}
                </button>
              )}
            </div>
            <div className="p-6">
              <div className={`flex items-start p-4 rounded-lg ${vaultHealthData.status === 'error' ? 'bg-red-100 border border-red-200' : 'bg-yellow-100 border border-yellow-200'
                }`}>
                {vaultHealthData.status === 'error' ? (
                  <XCircle className="w-6 h-6 text-red-600 mr-3 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-yellow-600 mr-3 flex-shrink-0" />
                )}
                <div>
                  <h3 className={`font-semibold ${vaultHealthData.status === 'error' ? 'text-red-800' : 'text-yellow-800'
                    }`}>
                    {vaultHealthData.message}
                  </h3>

                  {vaultHealthData.recovery_info && (
                    <div className="mt-3 space-y-2 text-sm text-red-700">
                      <p>{vaultHealthData.recovery_info.explanation}</p>
                      <p className="font-medium mt-2">Solutions:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {vaultHealthData.recovery_info.solutions.map((solution: string, idx: number) => (
                          <li key={idx}>{solution}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {vaultHealthData.details?.repos_needing_passphrase?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm font-medium text-yellow-800">
                        Repositories needing passphrase:
                      </p>
                      <ul className="mt-1 text-sm text-yellow-700 space-y-1">
                        {vaultHealthData.details.repos_needing_passphrase.map((repo: any) => (
                          <li key={repo.id} className="flex items-center">
                            <Database className="w-4 h-4 mr-1" />
                            {repo.name || getSafeDisplayPath(repo.path)}
                          </li>
                        ))}
                      </ul>
                      <Link
                        to="/archives"
                        className="inline-flex items-center mt-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        Go to View/Restore to enter passphrases →
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Events Widget */}
        {recentLogsData?.logs && recentLogsData.logs.length > 0 && (
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center">
                <Activity className="w-5 h-5 text-gray-600 mr-2" />
                <h2 className="text-lg font-semibold text-gray-900">Recent Events</h2>
              </div>
              <Link
                to="/logs"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                View all logs →
              </Link>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {recentLogsData.logs
                  // Filter out empty or whitespace-only log lines
                  .filter((log: string) => hasLogContent(log))
                  .slice(0, 5)
                  .map((log: string, index: number) => {
                    const { icon: Icon, color, bgColor, borderColor } = getLogLevelInfo(log);
                    const { message, timestamp } = stripTimestamp(log);
                    // Clean metadata from display
                    const cleanedMessage = cleanLogLine(message);

                    return (
                      <div
                        key={index}
                        className={`flex items-start space-x-3 p-3 rounded-lg border ${bgColor} ${borderColor}`}
                      >
                        <Icon className={`w-5 h-5 ${color} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 font-mono break-words">{cleanedMessage}</p>
                          {timestamp && (
                            <p className="text-xs text-gray-500 mt-1">{timestamp}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* Backups Table */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">All Backups</h2>
          </div>

          {backups.length === 0 ? (
            <div className="p-8">
              <div className="text-center mb-6">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-lg font-medium text-gray-900">No backups configured yet</h3>
                <p className="mt-1 text-sm text-gray-500">Get started by setting up your first backup configuration.</p>
              </div>

              {/* Infinity Tools Quick Setup Card */}
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-5 mb-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                      <Activity className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-base font-semibold text-gray-900">Quick Setup with Infinity Tools Template</h4>
                    <p className="mt-1 text-sm text-gray-600">
                      Don't have time for manual configuration? Use the <strong>Infinity Tools Backup Template</strong> to automatically set up comprehensive backups for all your Infinity Tools applications with ransomware protection included.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/templates"
                        className="btn-primary text-sm inline-flex items-center gap-2"
                      >
                        <Activity className="w-4 h-4" />
                        Quick Setup with Template
                      </Link>
                      <button
                        onClick={() => navigate('/backups')}
                        className="btn-secondary text-sm"
                      >
                        Manual Configuration
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Sources
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Repository
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Run
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Result
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Next Run
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {backups.map((backup: any) => {
                    const running = isRunning(backup.id);
                    const schedule = schedules.find((s: any) => s.id === backup.schedule_id);
                    const sourcesText = backup.sources_summary?.map((s: any) => s.path || s.database_name).join(', ') || 'None';
                    const repoText = backup.repositories_summary?.[0]?.path || 'None';

                    return (
                      <tr
                        key={backup.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate('/backups')}
                      >
                        {/* Status */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          {running ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <Loader className="w-3 h-3 mr-1 animate-spin" />
                              Running
                            </span>
                          ) : backup.is_active ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              <XCircle className="w-3 h-3 mr-1" />
                              Inactive
                            </span>
                          )}
                        </td>

                        {/* Name */}
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">{backup.name}</div>
                          {backup.description && (
                            <div className="text-sm text-gray-500">{backup.description}</div>
                          )}
                        </td>

                        {/* Sources */}
                        <td className="px-6 py-4">
                          <div
                            className="text-sm text-gray-900 truncate max-w-xs"
                            title={sourcesText}
                          >
                            {truncatePath(sourcesText, 40)}
                          </div>
                          <div className="text-xs text-gray-500">{backup.source_count} source(s)</div>
                        </td>

                        {/* Repository */}
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            <div
                              className="text-sm text-gray-900 font-mono truncate max-w-xs"
                              title={repoText}
                            >
                              {truncatePath(repoText, 35)}
                            </div>
                            {backup.repositories_summary?.[0]?.borg_version && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${backup.repositories_summary[0].borg_version.startsWith('1')
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                                }`}>
                                {backup.repositories_summary[0].borg_version.startsWith('1') ? 'Borg 1.x' : 'Borg 2.x'}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Last Run */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          {backup.last_run ? (
                            <div className="text-sm text-gray-900">
                              {formatDateTime(backup.last_run)}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500">Never</span>
                          )}
                        </td>

                        {/* Result */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          {backup.last_run_status === 'success' ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : backup.last_run_status === 'warning' ? (
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                          ) : backup.last_run_status === 'failed' ? (
                            <XCircle className="w-5 h-5 text-red-600" />
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>

                        {/* Next Run */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          {schedule ? (
                            <div className="flex items-center text-sm text-gray-900">
                              <Clock className="w-4 h-4 mr-1 text-purple-600" />
                              {getNextRun(backup.schedule_id)}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500">Manual only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Security Warning - Only show if NOT on localhost or LAN */}
        {showSecurityWarning && (
          <div
            className="rounded-lg p-4 mb-5"
            style={{
              backgroundColor: '#8b0000',
              color: '#ffffff',
              border: '2px solid #660000'
            }}
          >
            <h5 className="flex items-center text-lg font-bold mb-3" style={{ color: '#ffffff', marginTop: 0 }}>
              <AlertTriangle className="w-5 h-5 mr-2" />
              SECURITY WARNING
            </h5>
            <p className="mb-3 text-base">
              <strong>We strongly discourage running this website directly on the internet, because the software was not carefully audited for security!</strong>
            </p>
            <p className="mb-0 text-sm">
              Either run it with a self-signed SSL certificate on a local area network or use the <strong>"Website Protection"</strong> under <strong>"Security"</strong> of your Infinity Tools to add an extra username/password protection layer!
            </p>
          </div>
        )}
      </div>
    </>
  );
}
