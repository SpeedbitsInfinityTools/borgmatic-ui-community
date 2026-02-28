import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { useLocation } from 'react-router-dom'
import { deploymentsAPI, templatesAPI, directorAPI } from '../services/api'
import { Send, Users, CheckCircle, XCircle, Clock, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { formatDateTime } from '../utils/dateFormat'

interface Template {
  id: string
  type: string
  name: string
  description: string
  sources_summary?: any[]
  repositories_summary?: any[]
}

interface Client {
  client_id: string
  client_name: string
  status: string
  ip_address?: string
}

interface Deployment {
  id: string
  template_id: string
  template_name: string
  client_id: string
  client_name: string
  status: 'pending' | 'deploying' | 'success' | 'failed'
  deployed_at: string
  deployed_by: string
  error_message?: string
}

export default function Deployments() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'deploy' | 'manage'>('deploy')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set())
  const [selectedManageClient, setSelectedManageClient] = useState<string>('')
  const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set())

  // Pre-select template if navigated from Templates page
  useEffect(() => {
    if (location.state?.selectedTemplate) {
      const template = location.state.selectedTemplate
      setSelectedTemplate(template.id)
      setActiveTab('deploy')
    }
  }, [location.state])

  // Fetch templates
  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesAPI.getTemplates(),
  })

  const templates: Template[] = templatesData?.data?.data?.backups || []

  // Fetch clients
  const { data: clientsData } = useQuery({
    queryKey: ['director-clients'],
    queryFn: () => directorAPI.getClients(),
    // No auto-refresh - manual changes only
  })

  const clients: Client[] = clientsData?.data?.data?.clients?.filter(
    (c: Client) => c.status === 'approved' || c.status === 'connected'
  ) || []

  // Fetch deployments
  const { data: deploymentsData } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsAPI.getAll(),
    // No auto-refresh - manual changes only
  })

  const deployments: Deployment[] = deploymentsData?.data?.data?.deployments || []

  // Fetch client backups for selected client
  const { data: clientBackupsData } = useQuery({
    queryKey: ['client-backups', selectedManageClient],
    queryFn: () => deploymentsAPI.getClientDeployments(selectedManageClient),
    enabled: !!selectedManageClient && activeTab === 'manage',
  })

  const clientBackups = clientBackupsData?.data?.data?.deployments || []

  // Deploy mutation
  const deployMutation = useMutation({
    mutationFn: (data: { template_id: string; client_ids: string[] }) =>
      deploymentsAPI.deployTemplate(data.template_id, data.client_ids),
    onSuccess: () => {
      toast.success('Deployment initiated')
      setSelectedClients(new Set())
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Deployment failed')
    },
  })

  // Remove deployment mutation
  const removeMutation = useMutation({
    mutationFn: (deploymentIds: string[]) =>
      deploymentsAPI.removeDeployments(deploymentIds),
    onSuccess: () => {
      toast.success('Backups removed successfully')
      setSelectedBackups(new Set())
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
      queryClient.invalidateQueries({ queryKey: ['client-backups', selectedManageClient] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to remove backups')
    },
  })

  const handleDeploy = () => {
    if (!selectedTemplate) {
      toast.error('Please select a template')
      return
    }
    if (selectedClients.size === 0) {
      toast.error('Please select at least one client')
      return
    }

    deployMutation.mutate({
      template_id: selectedTemplate,
      client_ids: Array.from(selectedClients),
    })
  }

  const handleRemoveSelected = () => {
    if (selectedBackups.size === 0) {
      toast.error('Please select backups to remove')
      return
    }

    if (confirm(`Remove ${selectedBackups.size} backup(s) from ${clients.find(c => c.client_id === selectedManageClient)?.client_name}?`)) {
      removeMutation.mutate(Array.from(selectedBackups))
    }
  }

  const toggleClient = (clientId: string) => {
    const newSelected = new Set(selectedClients)
    if (newSelected.has(clientId)) {
      newSelected.delete(clientId)
    } else {
      newSelected.add(clientId)
    }
    setSelectedClients(newSelected)
  }

  const toggleBackup = (backupId: string) => {
    const newSelected = new Set(selectedBackups)
    if (newSelected.has(backupId)) {
      newSelected.delete(backupId)
    } else {
      newSelected.add(backupId)
    }
    setSelectedBackups(newSelected)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />
      case 'deploying':
        return <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    const colors = {
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      deploying: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
    }
    return colors[status as keyof typeof colors] || colors.pending
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Deployments</h1>
        <p className="mt-1 text-sm text-gray-500">
          Deploy templates to clients and manage deployed backups
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('deploy')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'deploy'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            <Send className="w-4 h-4 inline mr-2" />
            Deploy Templates
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'manage'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Manage Client Backups
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'deploy' ? (
        <div className="space-y-6">
          {/* Deploy Form */}
          <div className="card">
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Choose a template...</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Deploy to Clients (Select multiple)
                </label>
                <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                  {clients.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No clients available</p>
                  ) : (
                    clients.map((client) => (
                      <label
                        key={client.client_id}
                        className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedClients.has(client.client_id)}
                          onChange={() => toggleClient(client.client_id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-3"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{client.client_name}</div>
                          <div className="text-xs text-gray-500">
                            {client.client_id.substring(0, 12)}... • {client.status}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleDeploy}
                  disabled={!selectedTemplate || selectedClients.size === 0 || deployMutation.isLoading}
                  className="btn-primary flex items-center space-x-2 disabled:opacity-50"
                >
                  {deployMutation.isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Deploying...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Deploy to Selected ({selectedClients.size})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Deployment History */}
          <div className="card">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Recent Deployments</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Template
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Client
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Deployed
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {deployments.slice(0, 10).map((deployment) => (
                    <tr key={deployment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{deployment.template_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{deployment.client_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(deployment.status)}
                          <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(deployment.status)}`}>
                            {deployment.status.toUpperCase()}
                          </span>
                        </div>
                        {deployment.error_message && (
                          <div className="text-xs text-red-600 mt-1">{deployment.error_message}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{formatDateTime(deployment.deployed_at)}</div>
                        <div className="text-xs text-gray-400">by {deployment.deployed_by}</div>
                      </td>
                    </tr>
                  ))}
                  {deployments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                        No deployments yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Manage Client Backups Tab */
        <div className="space-y-6">
          <div className="card">
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Client
                </label>
                <select
                  value={selectedManageClient}
                  onChange={(e) => {
                    setSelectedManageClient(e.target.value)
                    setSelectedBackups(new Set())
                  }}
                  className="input w-full"
                >
                  <option value="">Choose a client...</option>
                  {clients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedManageClient && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Deployed Backups on {clients.find(c => c.client_id === selectedManageClient)?.client_name}
                    </label>
                    <div className="border rounded-lg p-4 max-h-96 overflow-y-auto space-y-2">
                      {clientBackups.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No deployed backups</p>
                      ) : (
                        clientBackups.map((backup: any) => (
                          <label
                            key={backup.id}
                            className="flex items-start p-3 hover:bg-gray-50 rounded cursor-pointer border"
                          >
                            <input
                              type="checkbox"
                              checked={selectedBackups.has(backup.id)}
                              onChange={() => toggleBackup(backup.id)}
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-3 mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{backup.template_name}</div>
                              <div className="text-sm text-gray-600 mt-1">
                                Deployed: {formatDateTime(backup.deployed_at)}
                              </div>
                              <div className="flex items-center mt-1 space-x-2">
                                {getStatusIcon(backup.status)}
                                <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadge(backup.status)}`}>
                                  {backup.status}
                                </span>
                              </div>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleRemoveSelected}
                      disabled={selectedBackups.size === 0 || removeMutation.isLoading}
                      className="btn-danger flex items-center space-x-2 disabled:opacity-50"
                    >
                      {removeMutation.isLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Removing...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          <span>Remove Selected ({selectedBackups.size})</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

