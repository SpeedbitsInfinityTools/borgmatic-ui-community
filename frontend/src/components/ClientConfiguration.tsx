import { useState, useEffect } from 'react';
import { useQueryClient } from 'react-query';
import { Wifi, XCircle, RefreshCw, CheckCircle, AlertCircle, Copy, Eye, EyeOff } from 'lucide-react';
import { identityAPI } from '../services/api';

export default function ClientConfiguration() {
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<any>(null);
    const [clientConfig, setClientConfig] = useState({
        client_name: '',
        connection_token: '',
        director_url: '' // e.g. https://<director-ip>:9000 (the Director's HTTPS API port)
    });
    const [originalConfig, setOriginalConfig] = useState<any>(null);
    const [savingConfig, setSavingConfig] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [connectionTestResult, setConnectionTestResult] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<{client_name?: boolean; director_url?: boolean}>({});
    const [showToken, setShowToken] = useState(false);

    const fetchStatus = async () => {
        try {
            const response = await identityAPI.getStatus();
            const data = response.data.data;
            setStatus(data);

            if (data.identity) {
                const config = {
                    client_name: data.identity.client_name || '',
                    connection_token: data.identity.connection_token || '',
                    director_url: data.identity.director_url || '' // User will enter Director URL
                };
                setClientConfig(config);
                setOriginalConfig(config);
            }
        } catch (err) {
            console.error('Failed to fetch status:', err);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const hasChanges = () => {
        if (!originalConfig) return false;
        return JSON.stringify(clientConfig) !== JSON.stringify(originalConfig);
    };

    const handleSaveClientConfig = async () => {
        // Validate required fields BEFORE setting loading state
        const errors: {client_name?: boolean; director_url?: boolean} = {};
        if (!clientConfig.client_name?.trim()) errors.client_name = true;
        if (!clientConfig.director_url?.trim()) errors.director_url = true;
        
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            setError('Please fill in the required fields (marked in red).');
            return;
        }

        // Validate URL format using URL constructor
        try {
            const url = new URL(clientConfig.director_url.trim());
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                setFieldErrors({ director_url: true });
                setError('Director URL must use http:// or https:// protocol');
                return;
            }
            // Check for valid port (if specified)
            if (url.port && (parseInt(url.port) < 1 || parseInt(url.port) > 65535)) {
                setFieldErrors({ director_url: true });
                setError('Invalid port number in URL');
                return;
            }
        } catch (err) {
            setFieldErrors({ director_url: true });
            setError('Invalid URL format. Example: https://your-server.example.com:9000 (default Director API port is 9000).');
            return;
        }
        
        setFieldErrors({});

        try {
            setSavingConfig(true);
            setError(null);
            setConnectionTestResult(null);

            const configToSave = {
                client_name: clientConfig.client_name.trim(),
                connection_token: clientConfig.connection_token.trim(),
                director_url: clientConfig.director_url.trim()
            };

            // Minimum 3 second delay for better UX
            const minDelay = new Promise(resolve => setTimeout(resolve, 3000));

            await Promise.all([
                identityAPI.updateClientConfig(configToSave),
                minDelay
            ]);

            setClientConfig(configToSave);
            setOriginalConfig(configToSave);

            await fetchStatus();
            // Invalidate queries to update UI immediately
            queryClient.invalidateQueries({ queryKey: ['identityStatus'] });

            setConnectionTestResult({
                success: true,
                message: 'Client configuration saved successfully'
            });
        } catch (err: any) {
            console.error('Failed to save client config:', err);
            setError(err.response?.data?.detail || 'Failed to save configuration');
        } finally {
            setSavingConfig(false);
        }
    };

    const handleTestConnection = async () => {
        // Validate URL before testing
        if (!clientConfig.director_url?.trim()) {
            setFieldErrors({ director_url: true });
            setError('Please enter a Director URL to test');
            return;
        }
        setFieldErrors({});

        try {
            setTestingConnection(true);
            setConnectionTestResult(null);
            setError(null);

            // Pass current form values for testing (allows testing before saving)
            const response = await identityAPI.testConnection({
                director_url: clientConfig.director_url.trim(),
                connection_token: clientConfig.connection_token?.trim() || ''
            });
            setConnectionTestResult({
                success: true,
                message: response.data.data.message || 'Connection successful! Director server is reachable.'
            });
        } catch (err: any) {
            console.error('Connection test failed:', err);
            setConnectionTestResult({
                success: false,
                message: err.response?.data?.detail || 'Connection test failed'
            });
        } finally {
            setTestingConnection(false);
        }
    };

    const handleConnect = async () => {
        // Validate required fields before connecting (connection_token can be empty string)
        const errors: {client_name?: boolean; director_url?: boolean} = {};
        if (!clientConfig.client_name?.trim()) errors.client_name = true;
        if (!clientConfig.director_url?.trim()) errors.director_url = true;
        
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            setError('Please fill in the required fields (marked in red).');
            return;
        }
        setFieldErrors({});

        // Check if there are unsaved changes
        if (hasChanges()) {
            setError('Please save your configuration changes before connecting.');
            return;
        }

        try {
            setConnecting(true);
            setError(null);
            setConnectionTestResult(null);

            const response = await identityAPI.connect();

            setConnectionTestResult({
                success: true,
                message: response.data.data.message || 'Successfully connected to Director'
            });

            // Refresh status and sync originalConfig to prevent hasChanges() issues
            await fetchStatus();
            queryClient.invalidateQueries({ queryKey: ['identityStatus'] });
        } catch (err: any) {
            console.error('Connection failed:', err);
            setConnectionTestResult({
                success: false,
                message: err.response?.data?.detail || 'Failed to connect to Director'
            });
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            setConnecting(true);
            setError(null);
            setConnectionTestResult(null);

            await identityAPI.disconnect();

            setConnectionTestResult({
                success: true,
                message: 'Disconnected from Director'
            });

            // Refresh status and sync originalConfig to prevent hasChanges() issues
            await fetchStatus();
            queryClient.invalidateQueries({ queryKey: ['identityStatus'] });
        } catch (err: any) {
            console.error('Disconnect failed:', err);
            setConnectionTestResult({
                success: false,
                message: err.response?.data?.detail || 'Failed to disconnect from Director'
            });
        } finally {
            setConnecting(false);
        }
    };

    const handleCopyPublicKey = () => {
        if (status?.identity?.public_key) {
            navigator.clipboard.writeText(status.identity.public_key);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const getConnectionStatus = () => {
        if (!status?.identity) return null;

        const { last_connected, director_url, connection_status } = status.identity;

        if (!director_url) {
            return {
                type: 'standalone' as const,
                label: 'Standalone Mode',
                description: 'Not connected to any Director'
            };
        }

        // Use live connection status if available
        if (connection_status?.is_connected && connection_status?.is_authenticated) {
            return {
                type: 'connected' as const,
                label: 'Connected',
                description: last_connected 
                    ? `Last connected: ${new Date(last_connected).toLocaleString()}`
                    : 'Connected to Director'
            };
        }

        // Show disconnected if we have connection status but not connected
        if (connection_status !== null && connection_status !== undefined) {
            return {
                type: 'disconnected' as const,
                label: 'Not Connected',
                description: 'Director URL configured but not connected'
            };
        }

        // Fallback to last_connected for backward compatibility (shouldn't happen with new backend)
        if (last_connected) {
            return {
                type: 'connected' as const,
                label: 'Connected (cached)',
                description: `Last connected: ${new Date(last_connected).toLocaleString()}`
            };
        }

        return {
            type: 'disconnected' as const,
            label: 'Not Connected',
            description: 'Director URL configured but not connected'
        };
    };

    const connStatus = getConnectionStatus();

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="text-lg font-semibold text-gray-900">Client Configuration</h3>
                <p className="mt-1 text-sm text-gray-600">
                    Configure connection to your Director server
                </p>
            </div>

            <div className="p-6 space-y-4">
                {/* Client Name */}
                <div>
                    <label className={`block text-sm font-medium mb-2 ${fieldErrors.client_name ? 'text-red-600' : 'text-gray-700'}`}>
                        Client Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={clientConfig.client_name}
                        onChange={(e) => {
                            setClientConfig({ ...clientConfig, client_name: e.target.value });
                            if (fieldErrors.client_name) setFieldErrors({ ...fieldErrors, client_name: false });
                        }}
                        className={`input ${fieldErrors.client_name ? 'border-red-500 border-2 focus:border-red-500 focus:ring-red-500' : ''}`}
                        placeholder="Production Server 1"
                        required
                    />
                    {fieldErrors.client_name && (
                        <p className="mt-1 text-xs text-red-600 font-medium">Client Name is required</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                        A friendly name to identify this client in the Director
                    </p>
                </div>

                {/* Director URL */}
                <div>
                    <label className={`block text-sm font-medium mb-2 ${fieldErrors.director_url ? 'text-red-600' : 'text-gray-700'}`}>
                        Director URL <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={clientConfig.director_url}
                        onChange={(e) => {
                            setClientConfig({ ...clientConfig, director_url: e.target.value });
                            if (fieldErrors.director_url) setFieldErrors({ ...fieldErrors, director_url: false });
                        }}
                        className={`input ${fieldErrors.director_url ? 'border-red-500 border-2 focus:border-red-500 focus:ring-red-500' : ''}`}
                        placeholder="https://<server-ip-or-hostname>:9000"
                        required
                    />
                    {fieldErrors.director_url && (
                        <p className="mt-1 text-xs text-red-600 font-medium">Director URL is required</p>
                    )}
                    <div className="mt-1 text-xs text-gray-500 space-y-1">
                        <p>
                            The Director&apos;s <strong>API</strong> endpoint over HTTPS (default port <strong>9000</strong>),
                            e.g. <code className="bg-gray-100 px-1 rounded">https://your-server.example.com:9000</code> or
                            <code className="ml-1 bg-gray-100 px-1 rounded">https://10.0.0.5:9000</code>.
                        </p>
                        <p>
                            Use the <strong>server&apos;s reachable IP or hostname</strong> (LAN or public) — not
                            <code className="mx-1 bg-gray-100 px-1 rounded">localhost</code>, which points at this client,
                            not the Director. This is true even when both the client and the Director run on the same machine,
                            because the request originates inside the client container.
                        </p>
                        <p>
                            The Director&apos;s web-UI port is a different port from the API port — copy the
                            API URL from the Director&apos;s <em>Settings → Connection</em> page if unsure.
                        </p>
                    </div>
                </div>

                {/* Connection Token */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Connection Token
                    </label>
                    <div className="relative">
                        <input
                            type={showToken ? 'text' : 'password'}
                            value={clientConfig.connection_token}
                            onChange={(e) => setClientConfig({ ...clientConfig, connection_token: e.target.value })}
                            className="input pr-10"
                            placeholder="Leave empty if Director has no token (open access)"
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowToken((v) => !v)}
                            className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 hover:text-gray-800"
                            title={showToken ? 'Hide token' : 'Reveal token'}
                            aria-label={showToken ? 'Hide token' : 'Reveal token'}
                        >
                            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                        This token must match the Director's connection token (get it from Director's Settings). Leave empty if the Director has no token configured (open access mode).
                    </p>
                </div>

                {/* Public Key */}
                {status?.identity?.public_key && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Public Key
                        </label>
                        <div className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={status.identity.public_key_fingerprint || status.identity.public_key.substring(0, 50) + '...'}
                                readOnly
                                className="input flex-1 font-mono text-xs"
                            />
                            <button
                                onClick={handleCopyPublicKey}
                                className="btn-secondary flex items-center space-x-2"
                            >
                                {copied ? (
                                    <><CheckCircle className="w-4 h-4" /> <span>Copied!</span></>
                                ) : (
                                    <><Copy className="w-4 h-4" /> <span>Copy</span></>
                                )}
                            </button>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                            Unique cryptographic key used to verify this client's identity
                        </p>
                    </div>
                )}

                {/* Connection Status */}
                {connStatus && (
                    <div className={`p-4 ${connStatus.type === 'connected' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'} border rounded-lg flex items-center space-x-3`}>
                        <CheckCircle className={`w-5 h-5 ${connStatus.type === 'connected' ? 'text-green-600' : 'text-gray-600'}`} />
                        <div>
                            <p className={`text-sm font-medium ${connStatus.type === 'connected' ? 'text-green-900' : 'text-gray-900'}`}>
                                {connStatus.label}
                            </p>
                            <p className={`text-xs ${connStatus.type === 'connected' ? 'text-green-700' : 'text-gray-700'}`}>
                                {connStatus.description}
                            </p>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-800">{error}</p>
                    </div>
                )}

                {/* Connection Test Result */}
                {connectionTestResult && (
                    <div className={`p-4 ${connectionTestResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border rounded-lg flex items-start space-x-3`}>
                        {connectionTestResult.success ? (
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        ) : (
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <p className={`text-sm ${connectionTestResult.success ? 'text-green-800' : 'text-red-800'}`}>
                            {connectionTestResult.message}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center space-x-3 pt-4">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            handleSaveClientConfig();
                        }}
                        disabled={savingConfig}
                        className="btn-primary flex items-center space-x-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {savingConfig ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> <span>Saving...</span></>
                        ) : (
                            <span>Save Configuration</span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            handleTestConnection();
                        }}
                        disabled={testingConnection}
                        className="btn-secondary flex items-center space-x-2"
                        title="Test connection with current form values (no need to save first)"
                    >
                        {testingConnection ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> <span>Testing...</span></>
                        ) : (
                            <span>Test Connection</span>
                        )}
                    </button>

                    {connStatus?.type === 'connected' ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                handleDisconnect();
                            }}
                            disabled={connecting}
                            className="btn-secondary flex items-center space-x-2 text-red-600 hover:bg-red-50"
                        >
                            {connecting ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Disconnecting...</span>
                                </>
                            ) : (
                                <>
                                    <XCircle className="w-4 h-4" />
                                    <span>Disconnect</span>
                                </>
                            )}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                handleConnect();
                            }}
                            disabled={connecting}
                            className="btn-primary flex items-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400"
                        >
                            {connecting ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Connecting...</span>
                                </>
                            ) : (
                                <>
                                    <Wifi className="w-4 h-4" />
                                    <span>Connect</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

