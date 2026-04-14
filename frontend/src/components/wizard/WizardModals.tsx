import React from 'react';
import { X, Database, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export interface WizardModalsProps {
  showCloseConfirm: boolean;
  setShowCloseConfirm: (v: boolean) => void;
  onClose: () => void;
  saveAsDraftAndClose: () => void;
  isSavingDraft: boolean;

  showDiscoveryOptions: boolean;
  setShowDiscoveryOptions: (v: boolean) => void;
  discoveryOptions: { includeHost: boolean; networks: string[] };
  setDiscoveryOptions: React.Dispatch<React.SetStateAction<{ includeHost: boolean; networks: string[] }>>;
  availableNetworks: string[];
  isLoadingNetworks: boolean;
  handleAutoDiscover: () => void;

  showDiscoveryResults: boolean;
  setShowDiscoveryResults: (v: boolean) => void;
  discoveredDatabases: any[];
  selectedDatabases: string[];
  toggleDatabaseSelection: (dbId: string) => void;
  selectAllDatabases: () => void;
  deselectAllDatabases: () => void;
  addSelectedDatabases: () => void;

  dbBrowserState: {
    isOpen: boolean;
    sourceIndex: number;
    isLoading: boolean;
    databases: string[];
    error: string | null;
  };
  setDbBrowserState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    sourceIndex: number;
    isLoading: boolean;
    databases: string[];
    error: string | null;
  }>>;
  selectDatabaseFromBrowser: (dbName: string) => void;

  showRetentionModal: boolean;
  setShowRetentionModal: (v: boolean) => void;
  customRetention: {
    name: string;
    description: string;
    keep_hourly: number;
    keep_daily: number;
    keep_weekly: number;
    keep_monthly: number;
    keep_yearly: number;
  };
  setCustomRetention: React.Dispatch<React.SetStateAction<{
    name: string;
    description: string;
    keep_hourly: number;
    keep_daily: number;
    keep_weekly: number;
    keep_monthly: number;
    keep_yearly: number;
  }>>;
  createRetentionMutation: { mutate: (data: any) => void; isLoading: boolean };
}

const WizardModals: React.FC<WizardModalsProps> = (props) => {
  const {
    showCloseConfirm, setShowCloseConfirm, onClose, saveAsDraftAndClose, isSavingDraft,
    showDiscoveryOptions, setShowDiscoveryOptions, discoveryOptions, setDiscoveryOptions,
    availableNetworks, isLoadingNetworks, handleAutoDiscover,
    showDiscoveryResults, setShowDiscoveryResults, discoveredDatabases, selectedDatabases,
    toggleDatabaseSelection, selectAllDatabases, deselectAllDatabases, addSelectedDatabases,
    dbBrowserState, setDbBrowserState, selectDatabaseFromBrowser,
    showRetentionModal, setShowRetentionModal, customRetention, setCustomRetention, createRetentionMutation,
  } = props;

  return (
    <>
      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Save Template as Draft?</h3>
            <p className="text-sm text-gray-600 mb-6">
              You have unsaved changes. Would you like to save this template as a draft so you can continue editing it later?
            </p>
            <div className="flex space-x-3">
              <button onClick={() => { setShowCloseConfirm(false); onClose(); }} className="btn-secondary flex-1">Discard Changes</button>
              <button onClick={saveAsDraftAndClose} disabled={isSavingDraft} className="btn-primary flex-1">{isSavingDraft ? 'Saving...' : 'Save as Draft'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Database Discovery Options Modal */}
      {showDiscoveryOptions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Database Discovery Options</h3>
              <button onClick={() => setShowDiscoveryOptions(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
            </div>
            <div className="space-y-4">
              <label className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={discoveryOptions.includeHost} onChange={(e) => setDiscoveryOptions(prev => ({ ...prev, includeHost: e.target.checked }))} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                <div>
                  <span className="font-medium text-gray-900">Include Host System</span>
                  <p className="text-sm text-gray-500">Scan for databases running directly on the host</p>
                </div>
              </label>
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">Docker Networks</span>
                  {isLoadingNetworks && (<div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>)}
                </div>
                <p className="text-sm text-gray-500 mb-3">Select networks to scan for database containers</p>
                {availableNetworks.length === 0 && !isLoadingNetworks ? (
                  <p className="text-sm text-gray-400 italic">No Docker networks found. Is Docker running?</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableNetworks.map((network) => (
                      <label key={network} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={discoveryOptions.networks.includes(network)} onChange={(e) => { if (e.target.checked) { setDiscoveryOptions(prev => ({ ...prev, networks: [...prev.networks, network] })); } else { setDiscoveryOptions(prev => ({ ...prev, networks: prev.networks.filter(n => n !== network) })); } }} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                        <span className="text-sm text-gray-700">{network}</span>
                        {network === 'borgmatic-db' && (<span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">recommended</span>)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setShowDiscoveryOptions(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleAutoDiscover} disabled={!discoveryOptions.includeHost && discoveryOptions.networks.length === 0} className="btn-primary flex items-center space-x-2"><Database className="w-4 h-4" /><span>Scan for Databases</span></button>
            </div>
          </div>
        </div>
      )}

      {/* Database Discovery Results Modal */}
      {showDiscoveryResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Discovered Databases</h3>
              <button onClick={() => setShowDiscoveryResults(false)} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
            </div>
            {discoveredDatabases.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No database containers found.</p>
                <p className="text-sm text-gray-500 mt-2">Make sure your database containers (MariaDB, PostgreSQL, MongoDB) are running.</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600">Found {discoveredDatabases.length} database{discoveredDatabases.length !== 1 ? 's' : ''}. Select which ones to add:</p>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
                      <p className="text-xs text-blue-800 font-medium mb-1">Connection Methods:</p>
                      <div className="flex flex-wrap gap-3 text-xs text-blue-700">
                        <span><span className="font-medium">🐳 docker network</span> - Connect to DB container over borgmatic-db (dump runs in borgmatic container)</span>
                        <span><span className="font-medium">🖥️ host</span> - Connect to host DB via host.docker.internal</span>
                        <span><span className="font-medium">📁 file</span> - SQLite file backup</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2 shrink-0">
                    <button onClick={selectAllDatabases} className="text-sm text-blue-600 hover:text-blue-800">Select All</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={deselectAllDatabases} className="text-sm text-blue-600 hover:text-blue-800">Deselect All</button>
                  </div>
                </div>
                <div className="overflow-auto flex-1 border rounded-lg">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Container</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Database</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Connection</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credentials</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {discoveredDatabases.map((db: any) => (
                        <tr key={db.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3"><input type="checkbox" checked={selectedDatabases.includes(db.id)} onChange={() => toggleDatabaseSelection(db.id)} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" /></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              {db.type === 'mariadb' && <span className="text-xl">🐬</span>}
                              {db.type === 'mysql' && <span className="text-xl">🐬</span>}
                              {db.type === 'postgresql' && <span className="text-xl">🐘</span>}
                              {db.type === 'sqlite' && <span className="text-xl">🗄️</span>}
                              {db.type === 'mongodb' && <span className="text-xl">🍃</span>}
                              <span className="text-sm font-medium text-gray-900 capitalize">{db.type}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">{db.container}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{db.database}</td>
                          <td className="px-4 py-3">
                            {db.type === 'sqlite' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">📁 File</span>
                            ) : db.container ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title={`docker network (${db.container} on borgmatic-db)`}>🐳 docker network</span>
                            ) : db.is_host_database ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800" title="host.docker.internal">🖥️ host</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">🔗 network</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {db.type === 'sqlite' ? (
                              <span className="text-xs text-gray-400">N/A</span>
                            ) : db.username && db.password ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">✓ Found</span>
                            ) : db.username ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">User only</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Manual entry</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button onClick={() => setShowDiscoveryResults(false)} className="btn-secondary">Cancel</button>
                  <button onClick={addSelectedDatabases} disabled={selectedDatabases.length === 0} className="btn-primary">Add {selectedDatabases.length > 0 ? `${selectedDatabases.length} ` : ''}Database{selectedDatabases.length !== 1 ? 's' : ''}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Database Browser Modal */}
      {dbBrowserState.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Select Database</h3>
              <button onClick={() => setDbBrowserState(prev => ({ ...prev, isOpen: false }))} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
            </div>
            {dbBrowserState.isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600">Connecting to database server...</p>
              </div>
            ) : dbBrowserState.error ? (
              <div className="py-8">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4"><p className="text-red-700 text-sm">{dbBrowserState.error}</p></div>
                <p className="text-gray-600 text-sm">Make sure the database server is running and the credentials are correct.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">Select a database from the server. Choose <strong>"all"</strong> to backup all databases.</p>
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  {dbBrowserState.databases.map((dbName) => (
                    <button key={dbName} onClick={() => selectDatabaseFromBrowser(dbName)} className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 transition-colors flex items-center justify-between ${dbName === 'all' ? 'bg-purple-50 hover:bg-purple-100' : ''}`}>
                      <span className={`font-medium ${dbName === 'all' ? 'text-purple-700' : 'text-gray-900'}`}>{dbName}</span>
                      {dbName === 'all' && (<span className="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded">All DBs</span>)}
                    </button>
                  ))}
                </div>
                {dbBrowserState.databases.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Database className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No databases found</p>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end mt-6">
              <button onClick={() => setDbBrowserState(prev => ({ ...prev, isOpen: false }))} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Retention Profile Modal */}
      {showRetentionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Create Custom Retention Profile</h3>
              <button onClick={() => setShowRetentionModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Profile Name <span className="text-red-500">*</span></label>
                <input type="text" value={customRetention.name} onChange={(e) => setCustomRetention(prev => ({ ...prev, name: e.target.value }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="My Custom Policy" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea value={customRetention.description} onChange={(e) => setCustomRetention(prev => ({ ...prev, description: e.target.value }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Optional description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(['keep_hourly', 'keep_daily', 'keep_weekly', 'keep_monthly'] as const).map(field => (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{field.replace('keep_', 'Keep ').replace(/^\w/, c => c.toUpperCase())}{field === 'keep_hourly' ? ' (0 to disable)' : ''}</label>
                    <input type="number" min="0" value={customRetention[field]} onChange={(e) => setCustomRetention(prev => ({ ...prev, [field]: parseInt(e.target.value) || 0 }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Keep Yearly</label>
                  <input type="number" min="0" value={customRetention.keep_yearly} onChange={(e) => setCustomRetention(prev => ({ ...prev, keep_yearly: parseInt(e.target.value) || 0 }))} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800"><strong>Tip:</strong> Set a value to 0 to disable that retention period. At least one period should have a non-zero value.</p>
              </div>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button onClick={() => setShowRetentionModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => {
                if (!customRetention.name.trim()) { toast.error('Profile name is required'); return; }
                const hasAnyRetention = customRetention.keep_hourly > 0 || customRetention.keep_daily > 0 || customRetention.keep_weekly > 0 || customRetention.keep_monthly > 0 || customRetention.keep_yearly > 0;
                if (!hasAnyRetention) { toast.error('At least one retention period must be greater than 0'); return; }
                createRetentionMutation.mutate(customRetention);
              }} disabled={createRetentionMutation.isLoading} className="btn-primary">{createRetentionMutation.isLoading ? 'Creating...' : 'Create Profile'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default WizardModals;
