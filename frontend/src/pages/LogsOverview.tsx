import { useState } from 'react';
import { useQuery } from 'react-query';
import { directorAPI, logsAPI } from '../services/api';
import { Activity, CheckCircle, AlertTriangle, XCircle, Info, Eye, RefreshCw, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface ClientLogs {
  client_id: string;
  client_name: string;
  logs: string[];
  is_connected: boolean;
}

export default function LogsOverview() {
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Fetch connected clients
  const { data: clientsData, refetch: refetchClients } = useQuery({
    queryKey: ['director-clients'],
    queryFn: () => directorAPI.getClients(),
    refetchInterval: 30000,
  });

  const connectedClients = clientsData?.data?.data?.clients?.filter((c: any) => c.is_connected) || [];

  // Fetch recent logs for all connected clients
  const { data: aggregatedLogsData, refetch: refetchLogs } = useQuery({
    queryKey: ['all-client-logs'],
    queryFn: async () => {
      // Fetch logs for each connected client sequentially
      const results: ClientLogs[] = [];
      
      for (const client of connectedClients) {
        try {
          // Temporarily set this client for the API call
          const { setRemoteClientId } = await import('../services/api');
          setRemoteClientId(client.client_id);
          
          const response = await logsAPI.getLogs({
            log_type: 'borgmatic',
            lines: 3,
          });
          
          results.push({
            client_id: client.client_id,
            client_name: client.client_name,
            logs: response.data?.logs || [],
            is_connected: client.is_connected,
          });
        } catch (error) {
          console.error(`Failed to fetch logs for ${client.client_name}:`, error);
          results.push({
            client_id: client.client_id,
            client_name: client.client_name,
            logs: [],
            is_connected: client.is_connected,
          });
        }
      }
      
      // Reset to no client selected
      const { setRemoteClientId } = await import('../services/api');
      setRemoteClientId(null);
      
      return results;
    },
    refetchInterval: 30000,
    enabled: connectedClients.length > 0,
  });

  // Fetch extended logs for selected client (100 lines)
  const { data: extendedLogsData } = useQuery({
    queryKey: ['client-extended-logs', selectedClient?.id],
    queryFn: async () => {
      if (!selectedClient) return null;
      try {
        // Temporarily set this client for the API call
        const { setRemoteClientId } = await import('../services/api');
        setRemoteClientId(selectedClient.id);
        
        const response = await logsAPI.getLogs({
          log_type: 'borgmatic',
          lines: 100,
        });
        
        // Reset to no client selected
        setRemoteClientId(null);
        
        return response.data?.logs || [];
      } catch (error) {
        console.error(`Failed to fetch extended logs for ${selectedClient.name}:`, error);
        const { setRemoteClientId } = await import('../services/api');
        setRemoteClientId(null);
        return [];
      }
    },
    enabled: !!selectedClient && showModal,
  });

  const handleViewAll = (clientId: string, clientName: string) => {
    setSelectedClient({ id: clientId, name: clientName });
    setShowModal(true);
  };

  const handleRefresh = () => {
    refetchClients();
    refetchLogs();
    toast.success('Refreshed client events');
  };

  const stripTimestamp = (logLine: string): { message: string; timestamp: string } => {
    const timestampMatch = logLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const timestamp = timestampMatch ? timestampMatch[1] : '';
    const message = timestamp ? logLine.replace(timestamp, '').trim() : logLine;
    return { message, timestamp };
  };

  const cleanLogLine = (logLine: string): string => {
    // Remove log metadata like [,264], [,962] etc.
    let cleaned = logLine.replace(/^\[\s*,?\d+\]\s*/g, '');
    
    // Remove additional metadata patterns
    cleaned = cleaned.replace(/^\[\d+,\d+\]\s*/g, '');

    // Remove log level prefixes (INFO:, WARNING:, ERROR:, DEBUG:, CRITICAL:, ANSWER:)
    cleaned = cleaned.replace(/^(INFO|WARNING|ERROR|DEBUG|CRITICAL|ANSWER):\s*/i, '');
    
    return cleaned.trim();
  };

  const hasLogContent = (logLine: string): boolean => {
    const { message } = stripTimestamp(logLine);
    const cleaned = cleanLogLine(message);
    if (!cleaned || cleaned.length === 0) return false;
    if (/^summary:?\s*$/i.test(cleaned)) return false;
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cleaned)) return false;
    return true;
  };

  const getLogSeverity = (logLine: string): 'error' | 'warning' | 'success' | 'info' => {
    const line = logLine.toUpperCase();
    if (line.includes('ERROR') || line.includes('FAILED')) return 'error';
    if (line.includes('WARNING') || line.includes('WARN')) return 'warning';
    if (line.includes('SUCCESS') || line.includes('COMPLETED')) return 'success';
    return 'info';
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Info className="w-4 h-4 text-blue-600" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    const colors = {
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      error: 'bg-red-100 text-red-800',
      info: 'bg-blue-100 text-blue-800',
    };
    return colors[severity as keyof typeof colors] || colors.info;
  };

  const clientLogs = aggregatedLogsData || [];

  if (connectedClients.length === 0) {
    // Show empty state immediately if no clients
  } else if (!aggregatedLogsData && connectedClients.length > 0) {
    // Loading logs for connected clients
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Activity className="w-8 h-8 mr-3 text-primary-600" />
            Logs Overview
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor logs and events from all connected clients
            <span className="ml-2 text-xs text-gray-400">(timestamps are in server time / UTC)</span>
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="btn-secondary flex items-center space-x-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* No Connected Clients */}
      {connectedClients.length === 0 && (
        <div className="card">
          <div className="p-8 text-center">
            <Activity className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No clients connected</h3>
            <p className="mt-1 text-sm text-gray-500">
              Connect clients to start monitoring their events and logs.
            </p>
          </div>
        </div>
      )}

      {/* Client Logs Table */}
      {connectedClients.length > 0 && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Recent Events (Last 3)
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {clientLogs.map((clientData, index) => {
                  const { client_id, client_name, logs, is_connected } = clientData;
                  const hasLogs = logs && logs.length > 0;

                  return (
                    <tr key={client_id}>
                      {/* Client Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{client_name}</div>
                            <div className="text-xs text-gray-500">{client_id.substring(0, 8)}...</div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          is_connected
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {is_connected ? 'Connected' : 'Disconnected'}
                        </span>
                      </td>

                      {/* Recent Events */}
                      <td className="px-6 py-4">
                        {hasLogs ? (
                          <div className="space-y-2">
                            {logs
                              .filter((log) => hasLogContent(log))
                              .slice(0, 3)
                              .map((log, logIndex) => {
                              const severity = getLogSeverity(log);
                              const { message, timestamp } = stripTimestamp(log);
                              const cleanedMessage = cleanLogLine(message);

                              return (
                                <div key={logIndex} className="flex items-start space-x-2">
                                  {getSeverityIcon(severity)}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-900 font-mono truncate" title={cleanedMessage}>
                                      {cleanedMessage.length > 80 ? cleanedMessage.substring(0, 80) + '...' : cleanedMessage}
                                    </p>
                                    {timestamp && (
                                      <p className="text-xs text-gray-500">{timestamp}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">No recent events</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleViewAll(client_id, client_name)}
                          className="text-primary-600 hover:text-primary-900 inline-flex items-center space-x-1"
                          title="View more logs"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Extended Logs Modal */}
      {showModal && selectedClient && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
          <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Log Events: {selectedClient.name}
                </h3>
                <p className="text-sm text-gray-500 mt-1">Last 100 log entries <span className="text-xs text-gray-400">(timestamps are in server time / UTC)</span></p>
              </div>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedClient(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {extendedLogsData && extendedLogsData.length > 0 ? (
                <div className="space-y-2">
                  {extendedLogsData
                    .filter((log: string) => hasLogContent(log))
                    .map((log: string, index: number) => {
                    const severity = getLogSeverity(log);
                    const { message, timestamp } = stripTimestamp(log);
                    const cleanedMessage = cleanLogLine(message);

                    return (
                      <div
                        key={index}
                        className={`flex items-start space-x-3 p-3 rounded-lg border ${
                          severity === 'error' ? 'bg-red-50 border-red-200' :
                          severity === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                          severity === 'success' ? 'bg-green-50 border-green-200' :
                          'bg-blue-50 border-blue-200'
                        }`}
                      >
                        {getSeverityIcon(severity)}
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
              ) : (
                <div className="text-center py-12">
                  <Info className="mx-auto h-12 w-12 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">No log entries found</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedClient(null);
                }}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
