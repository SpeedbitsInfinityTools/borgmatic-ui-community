import { useState, useEffect } from 'react';
import { Copy, CheckCircle, RefreshCw, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { identityAPI } from '../services/api';
import { toast } from 'react-hot-toast';

export default function ConnectionConfiguration() {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Director token editing
    const [editingToken, setEditingToken] = useState(false);
    const [tokenValue, setTokenValue] = useState('');
    const [savingToken, setSavingToken] = useState(false);
    const [tokenSuccess, setTokenSuccess] = useState(false);
    // Token reveal — defaults to hidden so a screenshot or screen-share doesn't leak it.
    const [showToken, setShowToken] = useState(false);
    const [showTokenInput, setShowTokenInput] = useState(false);

    // Port editing
    const [editingPort, setEditingPort] = useState(false);
    const [portValue, setPortValue] = useState(8000);
    const [savingPort, setSavingPort] = useState(false);
    const [showRestartWarning, setShowRestartWarning] = useState(false);

    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        try {
            setLoading(true);
            const response = await identityAPI.getStatus();
            const data = response.data.data;
            setStatus(data);

            // Set token value for editing
            if (data.identity?.connection_token !== undefined) {
                setTokenValue(data.identity.connection_token);
            }

            // Set port value for editing
            if (data.identity?.listen_port) {
                setPortValue(data.identity.listen_port);
            }
        } catch (err: any) {
            console.error('Failed to fetch status:', err);
            setError(err.response?.data?.detail || 'Failed to load connection settings');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveToken = async () => {
        try {
            setSavingToken(true);
            setError(null);
            setTokenSuccess(false);

            await identityAPI.updateDirectorToken(tokenValue);

            setTokenSuccess(true);
            setEditingToken(false);

            // Auto-hide success message after 3 seconds
            setTimeout(() => setTokenSuccess(false), 3000);

            // Refresh status
            await fetchStatus();
        } catch (err: any) {
            console.error('Failed to save token:', err);
            setError(err.response?.data?.detail || 'Failed to save connection token');
        } finally {
            setSavingToken(false);
        }
    };

    const handleSavePort = async () => {
        if (portValue < 1 || portValue > 65535) {
            setError('Port must be between 1 and 65535');
            return;
        }

        if (portValue === status.identity?.listen_port) {
            setEditingPort(false);
            return;
        }

        setShowRestartWarning(true);
    };

    const confirmPortChange = async () => {
        try {
            setSavingPort(true);
            setError(null);

            const response = await identityAPI.updateDirectorPort(portValue);

            if (response.data.data.requires_restart) {
                toast.success('Port updated! Server is restarting...', { duration: 5000 });

                // Wait a moment for the server to start shutting down
                setTimeout(() => {
                    // Show a message about refreshing
                    toast.loading('Waiting for server restart... Page will reload automatically.', { duration: 10000 });

                    // Try to reconnect after 3 seconds
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                }, 1000);
            } else {
                await fetchStatus();
                setEditingPort(false);
                toast.success('Port updated successfully!');
            }
        } catch (err: any) {
            console.error('Failed to save port:', err);
            setError(err.response?.data?.detail || 'Failed to save port');
        } finally {
            setSavingPort(false);
            setShowRestartWarning(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                </div>
            )}

            {/* Listening Port */}
            <div className="card">
                <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Listening Port</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        Configure the port where the Director server listens for connections
                    </p>
                </div>

                <div className="p-6">
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-purple-900">HTTP Server Port</h4>
                            {!editingPort && (
                                <button
                                    onClick={() => setEditingPort(true)}
                                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                    Change Port
                                </button>
                            )}
                        </div>

                        {editingPort ? (
                            <div className="space-y-3 mt-3">
                                <input
                                    type="number"
                                    value={portValue}
                                    onChange={(e) => setPortValue(parseInt(e.target.value) || 8000)}
                                    className="input text-sm w-32"
                                    min="1"
                                    max="65535"
                                    placeholder="8000"
                                />
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={handleSavePort}
                                        disabled={savingPort}
                                        className="btn-primary text-xs px-4 py-2"
                                    >
                                        Save Port
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingPort(false);
                                            setPortValue(status.identity?.listen_port || 8000);
                                        }}
                                        disabled={savingPort}
                                        className="btn-secondary text-xs px-4 py-2"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-purple-800 mt-2">
                                Port <strong>{status.identity?.listen_port || 8000}</strong> (Socket.IO runs on same port)
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Connection Token (a.k.a. bootstrap token) */}
            <div className="card">
                <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Bootstrap Connection Token</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        Used by a client the <strong>first time</strong> it connects. After successful authentication
                        the director issues each client its own per-client token automatically; from then on the
                        per-client token is what the client uses, and rotating it on the Clients page only affects that one client.
                        Rotating the bootstrap token below globally re-keys initial joining for any future new client.
                    </p>
                </div>

                <div className="p-6">
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-green-900">Bootstrap Token</h4>
                            <div className="flex items-center space-x-2">
                                {!editingToken && (
                                    <>
                                        <button
                                            onClick={() => setShowToken((v) => !v)}
                                            className="text-xs px-2 py-1 text-green-800 hover:bg-green-100 rounded inline-flex items-center gap-1"
                                            title={showToken ? 'Hide token' : 'Reveal token'}
                                            aria-label={showToken ? 'Hide token' : 'Reveal token'}
                                        >
                                            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                            <span>{showToken ? 'Hide' : 'Show'}</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(status.identity?.connection_token || '');
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            }}
                                            className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-1"
                                        >
                                            {copied ? (
                                                <><CheckCircle className="w-3 h-3" /> <span>Copied!</span></>
                                            ) : (
                                                <><Copy className="w-3 h-3" /> <span>Copy</span></>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setEditingToken(true)}
                                            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                        >
                                            Edit
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {editingToken ? (
                            <div className="space-y-3">
                                <div className="relative">
                                    <input
                                        type={showTokenInput ? 'text' : 'password'}
                                        value={tokenValue}
                                        onChange={(e) => setTokenValue(e.target.value)}
                                        className="input text-xs font-mono w-full pr-10"
                                        placeholder="Leave empty for open access (no token required)"
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowTokenInput((v) => !v)}
                                        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 hover:text-gray-800"
                                        title={showTokenInput ? 'Hide token' : 'Reveal token'}
                                        aria-label={showTokenInput ? 'Hide token' : 'Reveal token'}
                                    >
                                        {showTokenInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={handleSaveToken}
                                        disabled={savingToken}
                                        className="btn-primary text-xs px-4 py-2 flex items-center space-x-2"
                                    >
                                        {savingToken ? (
                                            <><RefreshCw className="w-3 h-3 animate-spin" /> <span>Saving...</span></>
                                        ) : (
                                            <span>Save Token</span>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingToken(false);
                                            setTokenValue(status.identity?.connection_token || '');
                                            setShowTokenInput(false);
                                        }}
                                        disabled={savingToken}
                                        className="btn-secondary text-xs px-4 py-2"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="text-xs text-green-800 font-mono bg-white px-3 py-2 rounded border border-green-300 break-all select-all">
                                    {status.identity?.connection_token
                                        ? (showToken
                                            ? status.identity.connection_token
                                            : '•'.repeat(Math.min(48, String(status.identity.connection_token).length)))
                                        : <span className="text-gray-400 italic">Empty (open access)</span>}
                                </p>
                                {tokenSuccess && (
                                    <div className="mt-2 p-2 bg-green-100 border border-green-300 rounded flex items-center space-x-2">
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                        <span className="text-xs text-green-800 font-medium">Token saved successfully!</span>
                                    </div>
                                )}
                            </>
                        )}

                        <p className="text-xs text-green-700 mt-2">
                            {status.identity?.connection_token ?
                                'Share this token with clients to allow them to connect. This token must match on both Director and Client.' :
                                '⚠️ Empty token = Open access mode. Any client can connect without a token.'
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* Client Management Info */}
            <div className="card">
                <div className="p-6">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="text-sm font-semibold text-blue-900 mb-2">Client Management</h4>
                        <p className="text-sm text-blue-800">
                            View and manage connected clients on the Dashboard
                        </p>
                    </div>
                </div>
            </div>

            {/* Port Change Confirmation Modal */}
            {showRestartWarning && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">
                            ⚠️ Server Restart Required
                        </h3>
                        <p className="text-sm text-gray-700 mb-4">
                            Changing the port requires restarting the server. All active connections will be terminated.
                        </p>
                        <p className="text-sm text-gray-700 mb-4">
                            <strong>Current port:</strong> {status.identity?.listen_port || 8000}<br />
                            <strong>New port:</strong> {portValue}
                        </p>
                        <p className="text-sm text-red-600 mb-6">
                            After the restart, you'll need to access the UI at:<br />
                            <code className="bg-red-50 px-2 py-1 rounded">http://localhost:{portValue}</code>
                        </p>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={confirmPortChange}
                                disabled={savingPort}
                                className="btn-primary flex-1 flex items-center justify-center space-x-2"
                            >
                                {savingPort ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" /> <span>Restarting...</span></>
                                ) : (
                                    <span>Yes, Change Port</span>
                                )}
                            </button>
                            <button
                                onClick={() => {
                                    setShowRestartWarning(false);
                                    setEditingPort(false);
                                    setPortValue(status.identity?.listen_port || 8000);
                                }}
                                disabled={savingPort}
                                className="btn-secondary flex-1"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

