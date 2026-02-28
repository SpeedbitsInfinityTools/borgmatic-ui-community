import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  Monitor,
  CheckCircle,
  XCircle,
  Trash2,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { directorAPI, vaultAPI } from '../services/api';
import { formatDateTime } from '../utils/dateFormat';
import VaultSetupModal from './VaultSetupModal';
import { useDirector } from '../contexts/DirectorContext';

export default function DirectorDashboard() {
  const queryClient = useQueryClient();
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const { selectClientWithPulse } = useDirector();

  // Handle viewing a client's dashboard
  const handleViewClient = (client: any) => {
    // Create a client object compatible with DirectorContext
    selectClientWithPulse({
      client_id: client.client_id,
      client_name: client.client_name,
      status: 'connected',
      is_connected: true,
      ip_address: client.ip_address,
      ip_locked: client.ip_locked || false,
      last_seen: client.last_seen
    });
  };

  // Check vault status on mount
  useEffect(() => {
    const checkVaultStatus = async () => {
      try {
        const response = await vaultAPI.getStatus();
        if (!response.data.data.initialized) {
          setShowVaultSetup(true);
        }
      } catch (error) {
        console.error('Failed to check vault status:', error);
      }
    };
    checkVaultStatus();
  }, []);

  // Fetch clients
  const { data: clientsData, isLoading, refetch } = useQuery({
    queryKey: ['director-clients'],
    queryFn: () => directorAPI.getClients().then(res => res.data),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch stats
  const { data: statsData } = useQuery({
    queryKey: ['director-stats'],
    queryFn: () => directorAPI.getStats().then(res => res.data),
    refetchInterval: 30000,
  });

  // Remove client mutation
  const removeClientMutation = useMutation({
    mutationFn: (clientId: string) => directorAPI.rejectClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['director-clients'] });
    },
  });

  const clients = clientsData?.data?.categorized || { connected: [], disconnected: [] };
  const summary = clientsData?.data?.summary || { total: 0, connected: 0, disconnected: 0 };
  const stats = statsData?.data || {};

  const handleRemoveClient = (client: any) => {
    if (confirm(`Are you sure you want to remove "${client.client_name}"?`)) {
      removeClientMutation.mutate(client.client_id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <>
      {/* Vault Setup Modal */}
      {showVaultSetup && (
        <VaultSetupModal onComplete={() => setShowVaultSetup(false)} />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Director Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage connected backup clients
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-secondary flex items-center space-x-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600">Total Clients</p>
                <p className="mt-2 text-3xl font-bold text-blue-900">{summary.total}</p>
              </div>
              <Monitor className="h-12 w-12 text-blue-400" />
            </div>
          </div>

          <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">Connected</p>
                <p className="mt-2 text-3xl font-bold text-green-900">{summary.connected}</p>
              </div>
              <CheckCircle className="h-12 w-12 text-green-400" />
            </div>
          </div>

          <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600">Total Backups</p>
                <p className="mt-2 text-3xl font-bold text-purple-900">{stats.total_backups || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Connected Clients */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
            <h2 className="text-lg font-semibold text-green-900 flex items-center">
              <CheckCircle className="w-5 h-5 mr-2" />
              Connected Clients ({clients.connected.length})
            </h2>
          </div>
          {clients.connected.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No connected clients
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IPv4 Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Backups</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Repos</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {clients.connected.map((client: any) => (
                    <tr key={client.client_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                          <span className="font-medium text-gray-900">{client.client_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm text-gray-700">{client.ip_address}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {client.metadata?.backups_count || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {client.metadata?.repos_count || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {formatDateTime(client.last_seen)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleViewClient(client)}
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                          title="View client dashboard"
                        >
                          <ExternalLink className="w-4 h-4 mr-1.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Disconnected Clients */}
        {clients.disconnected.length > 0 && (
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <XCircle className="w-5 h-5 mr-2 text-gray-400" />
                Disconnected Clients ({clients.disconnected.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IPv4 Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {clients.disconnected.map((client: any) => (
                    <tr key={client.client_id} className="hover:bg-gray-50 opacity-60">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-2 h-2 bg-gray-400 rounded-full mr-2"></div>
                          <span className="font-medium text-gray-700">{client.client_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-600">
                        {client.ip_address}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDateTime(client.last_seen)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleRemoveClient(client)}
                          className="text-red-600 hover:text-red-700"
                          title="Remove client"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

