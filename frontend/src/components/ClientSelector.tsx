import { useState } from 'react'
import { useDirector } from '../contexts/DirectorContext'
import { Monitor, ChevronDown, Check, RefreshCw } from 'lucide-react'

export default function ClientSelector() {
  const { selectedClient, setSelectedClient, clients, isDirectorMode, loadClients, isLoading, selectorPulse } = useDirector()
  const [isOpen, setIsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Don't show selector if not in Director mode
  if (!isDirectorMode) {
    return null
  }

  const handleOpen = async () => {
    setIsOpen(!isOpen)
    // Refresh clients when opening dropdown
    if (!isOpen) {
      setRefreshing(true)
      await loadClients()
      setRefreshing(false)
    }
  }

  const getStatusColor = (isConnected: boolean) => {
    return isConnected ? 'bg-green-400' : 'bg-gray-400'
  }

  const currentDisplay = selectedClient
    ? selectedClient.client_name
    : 'Director (Local)'

  return (
    <div className="relative">
      {/* Selector Button - Made wider and more prominent */}
      <button
        onClick={handleOpen}
        className={`flex items-center space-x-2 px-4 py-2.5 bg-white border-2 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-all shadow-sm ${
          selectorPulse 
            ? 'border-green-500 ring-4 ring-green-300 ring-opacity-75 animate-pulse bg-green-50' 
            : 'border-blue-200'
        }`}
      >
        <Monitor className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-medium text-gray-700">
          {currentDisplay}
        </span>
        {selectedClient && (
          <span className={`w-2 h-2 rounded-full ${getStatusColor(selectedClient.is_connected)}`} />
        )}
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu - Made wider */}
          <div className="absolute right-0 mt-2 w-96 bg-white border border-gray-200 rounded-xl shadow-xl z-20">
            <div className="p-3">
              {/* Local Director Option */}
              <button
                onClick={() => {
                  setSelectedClient(null)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${!selectedClient
                    ? 'bg-blue-50 text-blue-700'
                    : 'hover:bg-gray-50 text-gray-700'
                  }`}
              >
                <div className="flex items-center space-x-3">
                  <Monitor className="w-4 h-4" />
                  <div className="text-left">
                    <div className="text-sm font-medium">Director (Local)</div>
                    <div className="text-xs text-gray-500">Manage local resources</div>
                  </div>
                </div>
                {!selectedClient && (
                  <Check className="w-4 h-4 text-blue-600" />
                )}
              </button>

              {/* Divider */}
              {clients.length > 0 && (
                <div className="my-2 border-t border-gray-200" />
              )}

              {/* Client Options */}
              {clients.map((client) => (
                <button
                  key={client.client_id}
                  onClick={() => {
                    setSelectedClient(client)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${selectedClient?.client_id === client.client_id
                      ? 'bg-blue-50 text-blue-700'
                      : 'hover:bg-gray-50 text-gray-700'
                    }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(client.is_connected)}`} />
                    <div className="text-left">
                      <div className="text-sm font-medium">{client.client_name}</div>
                      <div className="text-xs text-gray-500">
                        {client.is_connected ? 'Online' : 'Offline'}
                        {client.last_seen && ` • ${new Date(client.last_seen).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  {selectedClient?.client_id === client.client_id && (
                    <Check className="w-4 h-4 text-blue-600" />
                  )}
                </button>
              ))}

              {/* Loading or No Clients Message */}
              {refreshing ? (
                <div className="px-3 py-4 text-center text-sm text-gray-500 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading clients...</span>
                </div>
              ) : clients.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-500">
                  No connected clients available
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

