import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { appriseAPI, ntfyAPI, notificationRoutingAPI, directorNotificationsAPI, identityAPI, directorAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import {
    Bell,
    Plus,
    Trash2,
    Send,
    Check,
    X,
    ChevronRight,
    Loader,
    AlertTriangle,
    CheckCircle,
    HelpCircle,
    Radio,
    Server,
    Monitor,
    Zap,
    Sparkles,
    Pencil,
    Search,
    Users,
} from 'lucide-react';
import NotificationServicePicker from '../components/notifications/NotificationServicePicker';
import NotificationServiceForm from '../components/notifications/NotificationServiceForm';
import NtfyConfigForm from '../components/notifications/NtfyConfigForm';
import SharedNotificationSettings from '../components/notifications/SharedNotificationSettings';

interface NotificationConfig {
    notifications: {
        success: NotificationType;
        failure: NotificationType;
        warning: NotificationType;
        security_alert?: NotificationType;
        [key: string]: NotificationType | undefined;
    };
    settings: {
        timeout: number;
        retry_attempts: number;
        retry_delay: number;
    };
}

interface NotificationType {
    enabled: boolean;
    urls: string[];
    title: string;
    body: string;
}

interface ConfiguredDestination {
    id: string;
    service: string;
    serviceName: string;
    url: string;
    name: string;
    createdAt: string;
}

interface RoutingConfig {
    provider: 'apprise' | 'ntfy';
    routing: 'director_only' | 'local_only' | 'both';
    local_events: string[];
    director_events: string[];
}

// Parse Apprise URL helper
function parseAppriseUrl(url: string): { service: string; serviceName: string; name: string } {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.startsWith('ntfy://') || lowerUrl.startsWith('ntfys://')) {
        const match = url.match(/ntfys?:\/\/([^/]+)(?:\/(.+))?/);
        const topic = match?.[2] || match?.[1] || 'unknown';
        return { service: 'ntfy', serviceName: 'ntfy', name: `Topic: ${topic}` };
    }
    if (lowerUrl.startsWith('slack://') || lowerUrl.includes('hooks.slack.com')) {
        return { service: 'slack', serviceName: 'Slack', name: 'Slack Webhook' };
    }
    if (lowerUrl.startsWith('discord://') || lowerUrl.includes('discord.com/api/webhooks')) {
        return { service: 'discord', serviceName: 'Discord', name: 'Discord Webhook' };
    }
    if (lowerUrl.startsWith('msteams://') || lowerUrl.includes('webhook.office.com')) {
        return { service: 'msteams', serviceName: 'Microsoft Teams', name: 'Teams Webhook' };
    }
    if (lowerUrl.startsWith('mailto://') || lowerUrl.startsWith('mailtos://')) {
        const match = url.match(/mailto[s]?:\/\/[^@]+@([^?/]+)/);
        return { service: 'email', serviceName: 'Email (SMTP)', name: match?.[1] || 'Email' };
    }
    if (lowerUrl.startsWith('tgram://')) {
        return { service: 'telegram', serviceName: 'Telegram', name: 'Telegram Bot' };
    }
    if (lowerUrl.startsWith('gotify://') || lowerUrl.startsWith('gotifys://')) {
        return { service: 'gotify', serviceName: 'Gotify', name: 'Gotify Server' };
    }
    if (lowerUrl.startsWith('pover://')) {
        return { service: 'pushover', serviceName: 'Pushover', name: 'Pushover' };
    }
    if (lowerUrl.startsWith('pbul://')) {
        return { service: 'pushbullet', serviceName: 'Pushbullet', name: 'Pushbullet' };
    }
    if (lowerUrl.startsWith('json://') || lowerUrl.startsWith('jsons://')) {
        return { service: 'webhook', serviceName: 'Webhook (JSON)', name: 'Custom Webhook' };
    }
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
        return { service: 'webhook', serviceName: 'Webhook', name: 'HTTP Webhook' };
    }

    return { service: 'unknown', serviceName: 'Unknown', name: url.substring(0, 30) };
}

function getServiceIcon(service: string) {
    const icons: Record<string, string> = {
        ntfy: '📱',
        slack: '💬',
        discord: '🎮',
        msteams: '👔',
        email: '📧',
        telegram: '✈️',
        gotify: '🔔',
        pushover: '📲',
        pushbullet: '🔫',
        webhook: '🔗',
    };
    return icons[service] || '🔔';
}

// Apprise API Server Configuration Component
function AppriseApiConfig() {
    const queryClient = useQueryClient();
    const [apiUrl, setApiUrl] = useState('');
    const [apiEnabled, setApiEnabled] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [isTesting, setIsTesting] = useState(false);

    // Fetch current Apprise config
    const { data: appriseConfig, isLoading } = useQuery({
        queryKey: ['apprise-config'],
        queryFn: () => appriseAPI.getConfig(),
    });

    // Update state when config loads
    useEffect(() => {
        if (appriseConfig?.data) {
            setApiUrl(appriseConfig.data.api?.url || '');
            setApiEnabled(appriseConfig.data.api?.enabled || false);
            // Check if any notification type is enabled
            const hasEnabledNotifications = Object.values(appriseConfig.data.notifications || {}).some(
                (n: any) => n?.enabled
            );
            setNotificationsEnabled(hasEnabledNotifications);
        }
    }, [appriseConfig]);

    // Save API config mutation
    const saveApiMutation = useMutation({
        mutationFn: (config: { enabled: boolean; url: string }) => appriseAPI.updateApiConfig(config),
        onSuccess: () => {
            toast.success('Apprise API configuration saved');
            queryClient.invalidateQueries(['apprise-config']);
            queryClient.invalidateQueries(['apprise-status']);
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to save configuration');
        },
    });

    // Save full config mutation (for enabling/disabling notifications)
    const saveConfigMutation = useMutation({
        mutationFn: (config: any) => appriseAPI.saveConfig(config),
        onSuccess: () => {
            queryClient.invalidateQueries(['apprise-config']);
            queryClient.invalidateQueries(['apprise-status']);
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to save configuration');
        },
    });

    // Test API connection
    const handleTestApi = async () => {
        if (!apiUrl) {
            toast.error('Please enter an API URL first');
            return;
        }
        setIsTesting(true);
        try {
            const response = await appriseAPI.testApiConnection(apiUrl);
            if (response.data.success) {
                toast.success('Apprise API server is reachable!');
            } else {
                // Clean up multiline error messages for toast display
                const errorMsg = response.data.error || 'Failed to connect to Apprise API';
                // Replace newlines with spaces for toast, but show full message
                const cleanError = errorMsg.replace(/\n•/g, ' •').replace(/\n/g, ' ');
                toast.error(cleanError, { duration: 6000 });
            }
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Failed to test connection');
        } finally {
            setIsTesting(false);
        }
    };

    // Apply Infinity Tools defaults
    const handleApplyInfinityDefaults = () => {
        setApiUrl('http://apprise:8000');
        setApiEnabled(true);
        toast.success('Infinity Tools defaults applied - click Save to confirm');
    };

    const handleSave = () => {
        saveApiMutation.mutate({ enabled: apiEnabled, url: apiUrl });
    };

    // Toggle main notifications enabled
    const handleToggleNotifications = async (enabled: boolean) => {
        setNotificationsEnabled(enabled);
        const config = appriseConfig?.data || { notifications: {}, settings: {} };
        
        // Enable or disable all notification types
        const updatedNotifications = { ...config.notifications };
        if (enabled) {
            // Enable defaults: failure, warning, security_alert
            updatedNotifications.failure = { ...updatedNotifications.failure, enabled: true };
            updatedNotifications.warning = { ...updatedNotifications.warning, enabled: true };
            updatedNotifications.security_alert = { ...updatedNotifications.security_alert, enabled: true };
        } else {
            // Disable all
            Object.keys(updatedNotifications).forEach(key => {
                if (updatedNotifications[key]) {
                    updatedNotifications[key] = { ...updatedNotifications[key], enabled: false };
                }
            });
        }
        
        await saveConfigMutation.mutateAsync({ ...config, notifications: updatedNotifications });
        toast.success(enabled ? 'Apprise notifications enabled' : 'Apprise notifications disabled');
    };

    if (isLoading) {
        return (
            <div className="card">
                <div className="p-6 flex items-center justify-center">
                    <Loader className="w-6 h-6 animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Master Enable/Disable Toggle - PROMINENT */}
            <div className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                notificationsEnabled 
                    ? 'bg-green-50 border-green-500' 
                    : 'bg-amber-50 border-amber-400'
            }`}>
                <div className="flex items-center space-x-3">
                    {notificationsEnabled ? (
                        <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                            <Bell className="w-5 h-5 text-white" />
                        </div>
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center">
                            <Bell className="w-5 h-5 text-white" />
                        </div>
                    )}
                    <div>
                        <h3 className={`font-semibold ${notificationsEnabled ? 'text-green-800' : 'text-amber-800'}`}>
                            {notificationsEnabled ? 'Apprise Notifications Enabled' : 'Apprise Notifications Disabled'}
                        </h3>
                        <p className={`text-sm ${notificationsEnabled ? 'text-green-600' : 'text-amber-600'}`}>
                            {notificationsEnabled 
                                ? 'You will receive notifications via your configured destinations' 
                                : 'Enable to receive push notifications'}
                        </p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={notificationsEnabled}
                        onChange={(e) => handleToggleNotifications(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className={`w-14 h-7 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all ${
                        notificationsEnabled 
                            ? 'bg-green-500 peer-focus:ring-4 peer-focus:ring-green-300' 
                            : 'bg-gray-300 peer-focus:ring-4 peer-focus:ring-amber-300'
                    }`}></div>
                </label>
            </div>

            {/* Warning when disabled */}
            {!notificationsEnabled && (
                <div className="flex items-center space-x-2 p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-800">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-medium">
                        Notifications are disabled. You won't receive any alerts until you enable this.
                    </span>
                </div>
            )}

            {/* API Server Configuration Card */}
            <div className="card">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-medium text-gray-900 flex items-center">
                            <Server className="w-5 h-5 mr-2 text-purple-600" />
                            Apprise API Server
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                            Connect to an Apprise API server (like infinity-apprise) instead of using the CLI
                        </p>
                    </div>
                    <button
                        onClick={handleApplyInfinityDefaults}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
                    >
                        <Sparkles className="w-4 h-4 mr-1.5" />
                        Apply Infinity Tools Defaults
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    {/* Enable API Mode Toggle */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                            <h3 className="font-medium text-gray-900">Enable API Mode</h3>
                            <p className="text-sm text-gray-500">Use Apprise API server instead of CLI</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={apiEnabled}
                                onChange={(e) => setApiEnabled(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {/* API URL Input - Only show when API mode is enabled */}
                    {apiEnabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Apprise API Server URL
                            </label>
                            <div className="flex space-x-2">
                                <input
                                    type="url"
                                    value={apiUrl}
                                    onChange={(e) => setApiUrl(e.target.value)}
                                    placeholder="http://apprise:8000"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <button
                                    onClick={handleTestApi}
                                    disabled={!apiUrl || isTesting}
                                    className="btn-secondary flex items-center space-x-1"
                                >
                                    {isTesting ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                    <span>Test</span>
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                                For Infinity Tools: use <code className="bg-gray-100 px-1 rounded">http://apprise:8000</code> or <code className="bg-gray-100 px-1 rounded">http://infinity-apprise:8000</code>
                            </p>
                        </div>
                    )}

                    {/* Save button */}
                    <div className="flex justify-end pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saveApiMutation.isLoading}
                            className="btn-primary flex items-center space-x-1"
                        >
                            {saveApiMutation.isLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            <span>Save API Configuration</span>
                        </button>
                    </div>

                    {/* Status indicator */}
                    {apiEnabled && apiUrl && (
                        <div className={`p-3 rounded-lg ${appriseConfig?.data?.api?.enabled ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                            <p className={`text-sm ${appriseConfig?.data?.api?.enabled ? 'text-green-700' : 'text-yellow-700'}`}>
                                {appriseConfig?.data?.api?.enabled
                                    ? `✅ API mode enabled - notifications will be sent via ${appriseConfig?.data?.api?.url}`
                                    : '⚠️ Configuration changed - click Save to apply'}
                            </p>
                        </div>
                    )}

                    {/* Info when API mode is disabled */}
                    {!apiEnabled && (
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                            <p className="text-sm text-blue-700">
                                ℹ️ With API mode disabled, Apprise CLI must be installed on the server. 
                                Enable API mode to use an external Apprise server like infinity-apprise.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Modal for picking which clients receive forwarded notifications when the
// director is in "Only specific clients" mode. Designed to scale from a
// handful to many dozens of clients (search + select-all + scrollable list).
interface ClientPickerModalProps {
    clients: any[];
    initialSelected: string[];
    onClose: () => void;
    onSave: (ids: string[]) => void | Promise<void>;
}

function ClientPickerModal({ clients, initialSelected, onClose, onSave }: ClientPickerModalProps) {
    const [selected, setSelected] = useState<string[]>(initialSelected);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);

    const normalizedSearch = search.trim().toLowerCase();
    const visibleClients = normalizedSearch
        ? clients.filter((c: any) => {
            const haystack = `${c.client_name || ''} ${c.hostname || ''} ${c.client_id || ''}`.toLowerCase();
            return haystack.includes(normalizedSearch);
        })
        : clients;

    const visibleIds = visibleClients.map((c: any) => c.client_id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selected.includes(id));
    const someVisibleSelected = visibleIds.some((id: string) => selected.includes(id));

    const toggleClient = (id: string) => {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleAllVisible = () => {
        if (allVisibleSelected) {
            // Deselect every currently visible row, leave non-matching selections alone.
            setSelected(prev => prev.filter(id => !visibleIds.includes(id)));
        } else {
            // Select every currently visible row, deduped against existing selections.
            setSelected(prev => Array.from(new Set([...prev, ...visibleIds])));
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(selected);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                    <h3 className="text-base font-semibold text-gray-900 flex items-center">
                        <Users className="w-4 h-4 mr-2 text-blue-600" />
                        Select clients
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-5 py-3 border-b border-gray-100 space-y-2">
                    <div className="relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name, hostname, or ID…"
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            autoFocus
                        />
                    </div>
                    <label className="flex items-center justify-between text-xs text-gray-600 px-1">
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                                onChange={toggleAllVisible}
                                disabled={visibleIds.length === 0}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <span>
                                {normalizedSearch
                                    ? (allVisibleSelected ? 'Deselect all (filtered)' : 'Select all (filtered)')
                                    : (allVisibleSelected ? 'Deselect all' : 'Select all')}
                            </span>
                        </div>
                        <span className="text-gray-500">
                            {selected.length} selected · {visibleClients.length} shown
                        </span>
                    </label>
                </div>

                <div className="flex-1 overflow-y-auto px-2 py-2">
                    {visibleClients.length === 0 ? (
                        <p className="text-center text-sm text-gray-500 py-8">
                            {clients.length === 0 ? 'No clients have connected to this director yet.' : 'No clients match your search.'}
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {visibleClients.map((c: any) => {
                                const checked = selected.includes(c.client_id);
                                const label = c.client_name || c.hostname || c.client_id;
                                const sub = [c.hostname, c.client_id].filter(Boolean).join(' · ');
                                return (
                                    <li key={c.client_id}>
                                        <label className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors ${checked ? 'bg-blue-50 border border-blue-200' : 'border border-transparent hover:bg-gray-50'}`}>
                                            <div className="min-w-0 flex-1 mr-3">
                                                <div className="text-sm font-medium text-gray-900 truncate">{label}</div>
                                                {sub && (
                                                    <div className="text-xs text-gray-500 truncate" title={sub}>{sub}</div>
                                                )}
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleClient(c.client_id)}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded flex-shrink-0"
                                            />
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end space-x-2 bg-gray-50">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? <Loader className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

// Director Forwarding Configuration Component
function DirectorForwardingConfig() {
    const queryClient = useQueryClient();
    const [config, setConfig] = useState<any>(null);
    const [availableEvents, setAvailableEvents] = useState<any[]>([]);
    const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
    const [showClientPicker, setShowClientPicker] = useState(false);

    const { data: configData, isLoading } = useQuery({
        queryKey: ['director-notifications-config'],
        queryFn: () => directorNotificationsAPI.getConfig(),
    });

    const { data: eventsData } = useQuery({
        queryKey: ['director-notifications-events'],
        queryFn: () => directorNotificationsAPI.getAvailableEvents(),
    });

    const { data: clientsData } = useQuery({
        queryKey: ['director-clients'],
        queryFn: () => directorAPI.getClients(),
    });

    useEffect(() => {
        if (configData?.data) {
            setConfig(configData.data);
            const clientIds = configData.data?.client_filters?.client_ids || [];
            setSelectedClientIds(clientIds);
        }
    }, [configData]);

    useEffect(() => {
        if (eventsData?.data) {
            setAvailableEvents(eventsData.data);
        }
    }, [eventsData]);

    const saveMutation = useMutation({
        mutationFn: (newConfig: any) => directorNotificationsAPI.saveConfig(newConfig),
        onSuccess: () => {
            queryClient.invalidateQueries(['director-notifications-config']);
            toast.success('Director notification settings saved');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to save settings');
        },
    });

    const testMutation = useMutation({
        mutationFn: () => directorNotificationsAPI.test('backup_failed', 'Test Client'),
        onSuccess: (response) => {
            if (response.data?.success) {
                toast.success('Test notification sent!');
            } else {
                toast.error(response.data?.error || response.data?.reason || 'Test failed');
            }
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to send test');
        },
    });

    if (isLoading || !config) {
        return (
            <div className="card p-6">
                <Loader className="w-6 h-6 animate-spin mx-auto text-gray-400" />
            </div>
        );
    }

    const handleToggleForwarding = async () => {
        const newConfig = {
            ...config,
            forwarding: { ...config.forwarding, enabled: !config.forwarding?.enabled }
        };
        setConfig(newConfig);
        await saveMutation.mutateAsync(newConfig);
    };

    const handleProviderChange = async (provider: 'apprise' | 'ntfy') => {
        const newConfig = {
            ...config,
            forwarding: { ...config.forwarding, provider }
        };
        setConfig(newConfig);
        await saveMutation.mutateAsync(newConfig);
    };

    const handleEventToggle = async (eventId: string) => {
        const currentEvents = config.events || [];
        const newEvents = currentEvents.includes(eventId)
            ? currentEvents.filter((e: string) => e !== eventId)
            : [...currentEvents, eventId];

        const newConfig = { ...config, events: newEvents };
        setConfig(newConfig);
        await saveMutation.mutateAsync(newConfig);
    };

    const handleClientFilterModeChange = async (mode: 'all' | 'include') => {
        const newConfig = {
            ...config,
            client_filters: {
                ...config.client_filters,
                mode,
            },
        };
        setConfig(newConfig);
        await saveMutation.mutateAsync(newConfig);
    };

    // Persist a fresh selection in one shot — used by the picker modal so we
    // don't fire a save per checkbox click.
    const handleClientSelectionSave = async (clientIds: string[]) => {
        setSelectedClientIds(clientIds);
        const newConfig = {
            ...config,
            client_filters: {
                ...config.client_filters,
                mode: 'include',
                client_ids: clientIds,
            },
        };
        setConfig(newConfig);
        await saveMutation.mutateAsync(newConfig);
    };

    // Used by individual chip "X" buttons to remove a single client without
    // opening the picker.
    const handleRemoveSelectedClient = async (clientId: string) => {
        const newSelected = selectedClientIds.filter(id => id !== clientId);
        await handleClientSelectionSave(newSelected);
    };

    return (
        <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-medium text-gray-900">Notification Forwarding</h2>
                        <p className="mt-1 text-sm text-gray-500">
                            Forward notifications from clients to your notification service
                        </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.forwarding?.enabled || false}
                            onChange={handleToggleForwarding}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>
            </div>

            {config.forwarding?.enabled && (
                <div className="p-6 space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Forwarding Provider</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => handleProviderChange('ntfy')}
                                className={`p-3 rounded-lg border-2 text-left transition-all ${config.forwarding?.provider === 'ntfy'
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-200 hover:border-gray-300'
                                    }`}
                            >
                                <span className="font-medium">📱 ntfy</span>
                                <p className="text-xs text-gray-500 mt-1">Direct push notifications</p>
                            </button>
                            <button
                                onClick={() => handleProviderChange('apprise')}
                                className={`p-3 rounded-lg border-2 text-left transition-all ${config.forwarding?.provider === 'apprise'
                                    ? 'border-purple-500 bg-purple-50'
                                    : 'border-gray-200 hover:border-gray-300'
                                    }`}
                            >
                                <span className="font-medium">🔔 Apprise</span>
                                <p className="text-xs text-gray-500 mt-1">80+ notification services</p>
                            </button>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Forward These Events</h3>
                        <div className="space-y-2">
                            {availableEvents.map((event: any) => (
                                <label
                                    key={event.id}
                                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${event.alwaysOn ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                                        }`}
                                >
                                    <div className="flex items-center space-x-3">
                                        <div>
                                            <p className="font-medium text-gray-900 text-sm">{event.label}</p>
                                            <p className="text-xs text-gray-500">{event.description}</p>
                                        </div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={event.alwaysOn || (config.events || []).includes(event.id)}
                                        onChange={() => !event.alwaysOn && handleEventToggle(event.id)}
                                        disabled={event.alwaysOn}
                                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Client Filters</h3>
                        <div className="space-y-3">
                            {/* Backend shape: { success, data: { clients: [...], summary, categorized } }.
                                Tolerate a few legacy shapes too so we never crash the panel again. */}
                            {(() => {
                                const raw = clientsData?.data?.data;
                                const clientList: any[] = Array.isArray(raw)
                                    ? raw
                                    : Array.isArray(raw?.clients)
                                        ? raw.clients
                                        : Array.isArray(clientsData?.data)
                                            ? (clientsData!.data as any[])
                                            : [];
                                const clientById = new Map(clientList.map((c: any) => [c.client_id, c]));
                                const currentMode = config.client_filters?.mode || 'all';
                                const isLegacyExclude = currentMode === 'exclude';
                                const isInclude = currentMode === 'include';

                                return (
                                    <>
                                        <div className="flex items-center space-x-6">
                                            <label className="flex items-center space-x-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="clientFilterMode"
                                                    checked={currentMode === 'all'}
                                                    onChange={() => handleClientFilterModeChange('all')}
                                                />
                                                <span className="text-sm">All clients</span>
                                            </label>
                                            <label className="flex items-center space-x-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="clientFilterMode"
                                                    checked={isInclude}
                                                    onChange={() => handleClientFilterModeChange('include')}
                                                />
                                                <span className="text-sm">Only specific clients</span>
                                            </label>
                                        </div>

                                        {isLegacyExclude && (
                                            <div className="flex items-start space-x-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                                                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                <div className="text-xs">
                                                    This director is in legacy <strong>exclude</strong> mode (skipping {selectedClientIds.length} client{selectedClientIds.length === 1 ? '' : 's'}). Pick a new option above to migrate.
                                                </div>
                                            </div>
                                        )}

                                        {isInclude && (
                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {selectedClientIds.length === 0 ? (
                                                        <span className="text-sm text-gray-500 italic">No clients selected — notifications will be forwarded for none.</span>
                                                    ) : (
                                                        selectedClientIds.map((id) => {
                                                            const c = clientById.get(id) as any;
                                                            const label = c?.client_name || c?.hostname || id;
                                                            return (
                                                                <span
                                                                    key={id}
                                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
                                                                    title={c ? `${label} (${id})` : `Unknown client (${id})`}
                                                                >
                                                                    <span className="truncate max-w-[14rem]">{label}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveSelectedClient(id)}
                                                                        className="ml-0.5 text-blue-500 hover:text-blue-700"
                                                                        title="Remove from list"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                </span>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowClientPicker(true)}
                                                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                                                    >
                                                        <Users className="w-4 h-4 mr-1.5" />
                                                        Select clients
                                                        {clientList.length > 0 && (
                                                            <span className="ml-1.5 text-xs text-blue-600">
                                                                ({selectedClientIds.length} of {clientList.length} selected)
                                                            </span>
                                                        )}
                                                    </button>
                                                    {clientList.length === 0 && (
                                                        <p className="mt-1 text-xs text-gray-500">No clients have connected to this director yet.</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {showClientPicker && (
                                            <ClientPickerModal
                                                clients={clientList}
                                                initialSelected={selectedClientIds}
                                                onClose={() => setShowClientPicker(false)}
                                                onSave={async (ids) => {
                                                    setShowClientPicker(false);
                                                    await handleClientSelectionSave(ids);
                                                }}
                                            />
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="pt-4 border-t">
                        <button
                            onClick={() => testMutation.mutate()}
                            disabled={testMutation.isLoading}
                            className="btn-secondary flex items-center space-x-2"
                        >
                            {testMutation.isLoading ? (
                                <Loader className="w-4 h-4 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4" />
                            )}
                            <span>Send Test Notification</span>
                        </button>
                        <p className="text-xs text-gray-500 mt-2">
                            Sends a test "backup_failed" notification to verify your configuration
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Notifications() {
    const queryClient = useQueryClient();
    const { data: identityData } = useQuery({
        queryKey: ['identityStatus'],
        queryFn: () => identityAPI.getStatus(),
    });
    const mode = identityData?.data?.data?.mode || 'standalone';

    const [showAddWizard, setShowAddWizard] = useState(false);
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const [destinations, setDestinations] = useState<ConfiguredDestination[]>([]);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<'apprise' | 'ntfy'>('ntfy');
    const [routingMode, setRoutingMode] = useState<'director_only' | 'local_only' | 'both'>('both');
    const [editingDestination, setEditingDestination] = useState<ConfiguredDestination | null>(null);

    const { data: routingData, isLoading: routingLoading } = useQuery({
        queryKey: ['notification-routing'],
        queryFn: () => notificationRoutingAPI.getConfig(),
        enabled: mode !== 'director',
    });

    const { data: directorForwardingData, isLoading: directorForwardingLoading } = useQuery({
        queryKey: ['director-notifications-config'],
        queryFn: () => directorNotificationsAPI.getConfig(),
        enabled: mode === 'director',
    });

    const { data: appriseConfigData, isLoading: appriseLoading } = useQuery({
        queryKey: ['apprise-config'],
        queryFn: () => appriseAPI.getConfig(),
        enabled: selectedProvider === 'apprise',
    });

    const { data: ntfyConfigData, isLoading: ntfyLoading } = useQuery({
        queryKey: ['ntfy-config'],
        queryFn: () => ntfyAPI.getConfig(),
        enabled: selectedProvider === 'ntfy',
    });

    useEffect(() => {
        if (mode === 'director' && directorForwardingData?.data) {
            setSelectedProvider(directorForwardingData.data.forwarding?.provider || 'ntfy');
        } else if (routingData?.data) {
            const config = routingData.data as RoutingConfig;
            setSelectedProvider(config.provider || 'apprise');
            setRoutingMode(config.routing || 'both');
        }
    }, [routingData, directorForwardingData, mode]);

    useEffect(() => {
        if (appriseConfigData?.data && selectedProvider === 'apprise') {
            const config = appriseConfigData.data as NotificationConfig;
            const parsedDestinations: ConfiguredDestination[] = [];
            const allUrls = new Set<string>();
            Object.values(config.notifications || {}).forEach((notif: NotificationType) => {
                notif.urls?.forEach(url => allUrls.add(url));
            });
            allUrls.forEach(url => {
                const parsed = parseAppriseUrl(url);
                parsedDestinations.push({
                    id: btoa(url).replace(/=/g, ''),
                    service: parsed.service,
                    serviceName: parsed.serviceName,
                    url: url,
                    name: parsed.name,
                    createdAt: new Date().toISOString(),
                });
            });
            setDestinations(parsedDestinations);
        }
    }, [appriseConfigData, selectedProvider]);

    const setProviderMutation = useMutation({
        mutationFn: (provider: 'apprise' | 'ntfy') => notificationRoutingAPI.setProvider(provider),
        onSuccess: () => {
            queryClient.invalidateQueries(['notification-routing']);
            toast.success('Provider updated');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to update provider');
        },
    });

    const setRoutingMutation = useMutation({
        mutationFn: (routing: 'director_only' | 'local_only' | 'both') =>
            notificationRoutingAPI.setRouting(routing),
        onSuccess: () => {
            queryClient.invalidateQueries(['notification-routing']);
            toast.success('Routing updated');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to update routing');
        },
    });

    const saveAppriseMutation = useMutation({
        mutationFn: (config: NotificationConfig) => appriseAPI.saveConfig(config),
        onSuccess: () => {
            queryClient.invalidateQueries(['apprise-config']);
            toast.success('Notification settings saved');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to save settings');
        },
    });

    const saveNtfyMutation = useMutation({
        mutationFn: (config: any) => ntfyAPI.saveConfig(config),
        onSuccess: () => {
            queryClient.invalidateQueries(['ntfy-config']);
            toast.success('ntfy settings saved');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to save ntfy settings');
        },
    });

    const testAppriseMutation = useMutation({
        mutationFn: (url: string) => appriseAPI.testConnection(url),
        onSuccess: (response) => {
            if (response.data?.success) {
                toast.success('Test notification sent successfully!');
            } else {
                toast.error(response.data?.error || 'Test failed');
            }
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Failed to send test notification');
        },
    });

    // Helper function to test and return success status for the form
    const handleTestDestination = async (url: string): Promise<boolean> => {
        try {
            const response = await appriseAPI.testConnection(url);
            if (response.data?.success) {
                toast.success('Test notification sent successfully!');
                return true;
            } else {
                toast.error(response.data?.error || 'Test failed');
                return false;
            }
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Failed to send test notification');
            return false;
        }
    };

    // Handle editing a destination
    const handleEditDestination = (dest: ConfiguredDestination) => {
        setEditingDestination(dest);
        setSelectedService(dest.service);
        setShowAddWizard(true);
    };

    // Handle updating a destination (replace old with new)
    const handleUpdateDestination = async (newUrl: string, serviceName: string) => {
        if (!editingDestination) return;
        
        const config = appriseConfigData?.data as NotificationConfig;
        if (!config) return;
        
        // Remove old URL and add new one in all notification types
        ['success', 'failure', 'warning'].forEach(type => {
            const notif = config.notifications[type as keyof typeof config.notifications];
            notif.urls = notif.urls.filter(u => u !== editingDestination.url);
            if (!notif.urls.includes(newUrl)) {
                notif.urls.push(newUrl);
            }
        });
        
        await saveAppriseMutation.mutateAsync(config);
        toast.success('Destination updated');
        setShowAddWizard(false);
        setSelectedService(null);
        setEditingDestination(null);
    };

    const handleProviderChange = async (provider: 'apprise' | 'ntfy') => {
        setSelectedProvider(provider);
        try {
            await setProviderMutation.mutateAsync(provider);
        } catch {
            setSelectedProvider(selectedProvider);
        }
    };

    const handleRoutingChange = async (routing: 'director_only' | 'local_only' | 'both') => {
        setRoutingMode(routing);
        try {
            await setRoutingMutation.mutateAsync(routing);
        } catch {
            setRoutingMode(routingMode);
        }
    };

    const handleAddDestination = async (url: string, _serviceName?: string) => {
        const config = appriseConfigData?.data as NotificationConfig || {
            notifications: {
                success: { enabled: true, urls: [], title: 'Backup Success', body: 'Backup completed successfully' },
                failure: { enabled: true, urls: [], title: 'Backup Failed', body: 'Backup failed with error' },
                warning: { enabled: true, urls: [], title: 'Backup Warning', body: 'Backup completed with warnings' },
            },
            settings: { timeout: 30, retry_attempts: 3, retry_delay: 5 },
        };
        ['success', 'failure', 'warning'].forEach(type => {
            if (!config.notifications[type as keyof typeof config.notifications].urls.includes(url)) {
                config.notifications[type as keyof typeof config.notifications].urls.push(url);
            }
            config.notifications[type as keyof typeof config.notifications].enabled = true;
        });
        await saveAppriseMutation.mutateAsync(config);
        setShowAddWizard(false);
        setSelectedService(null);
    };

    const handleRemoveDestination = async (destinationId: string) => {
        const dest = destinations.find(d => d.id === destinationId);
        if (!dest) return;
        const config = appriseConfigData?.data as NotificationConfig;
        if (!config) return;
        ['success', 'failure', 'warning'].forEach(type => {
            const notif = config.notifications[type as keyof typeof config.notifications];
            notif.urls = notif.urls.filter(u => u !== dest.url);
        });
        await saveAppriseMutation.mutateAsync(config);
        toast.success('Destination removed');
    };

    const isLoading = routingLoading || (selectedProvider === 'apprise' ? appriseLoading : ntfyLoading);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader className="w-8 h-8 animate-spin text-primary-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                        <Bell className="w-8 h-8 mr-3 text-primary-600" />
                        Notifications
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">Configure where to send backup notifications</p>
                </div>
                <div className="flex items-center space-x-3">
                    <button onClick={() => setShowHelpModal(true)} className="btn-secondary flex items-center space-x-2">
                        <HelpCircle className="w-4 h-4" />
                        <span>How it works</span>
                    </button>
                    {selectedProvider === 'apprise' && (mode === 'standalone' || (mode === 'client' && routingMode !== 'director_only')) && (
                        <button onClick={() => setShowAddWizard(true)} className="btn-primary flex items-center space-x-2">
                            <Plus className="w-4 h-4" />
                            <span>Add Destination</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Client Mode Routing Options */}
            {mode === 'client' && (
                <div className="card">
                    <div className="px-4 py-3 border-b border-gray-200">
                        <h2 className="text-base font-medium text-gray-900 flex items-center">
                            <Radio className="w-4 h-4 mr-2 text-primary-600" />
                            Notification Routing
                        </h2>
                    </div>
                    <div className="p-4">
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => handleRoutingChange('director_only')}
                                title="Send all notifications to the Director server."
                                className={`p-3 rounded-lg border text-left transition-all ${routingMode === 'director_only' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <Server className={`w-5 h-5 mb-1 ${routingMode === 'director_only' ? 'text-primary-600' : 'text-gray-400'}`} />
                                <h3 className="font-medium text-gray-900 text-sm">Borgmatic UI Director only</h3>
                            </button>
                            <button
                                onClick={() => handleRoutingChange('local_only')}
                                title="Send notifications directly from this client."
                                className={`p-3 rounded-lg border text-left transition-all ${routingMode === 'local_only' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <Monitor className={`w-5 h-5 mb-1 ${routingMode === 'local_only' ? 'text-primary-600' : 'text-gray-400'}`} />
                                <h3 className="font-medium text-gray-900 text-sm">Local Only</h3>
                            </button>
                            <button
                                onClick={() => handleRoutingChange('both')}
                                title="Send to both Director and local destinations."
                                className={`p-3 rounded-lg border text-left transition-all ${routingMode === 'both' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <Zap className={`w-5 h-5 mb-1 ${routingMode === 'both' ? 'text-primary-600' : 'text-gray-400'}`} />
                                <h3 className="font-medium text-gray-900 text-sm">Both</h3>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Provider Selection */}
            {(mode === 'standalone' || (mode === 'client' && routingMode !== 'director_only')) && (
                <div className="card">
                    <div className="px-4 py-3 border-b border-gray-200">
                        <h2 className="text-base font-medium text-gray-900">Notification Provider</h2>
                    </div>
                    <div className="p-4">
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => handleProviderChange('ntfy')}
                                title="Direct push notifications. Simple setup, no dependencies."
                                className={`p-3 rounded-lg border text-left transition-all ${selectedProvider === 'ntfy' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <div className="flex items-center space-x-3">
                                    <span className="text-xl">📱</span>
                                    <h3 className="font-medium text-gray-900 text-sm">ntfy (Native)</h3>
                                </div>
                            </button>
                            <button
                                onClick={() => handleProviderChange('apprise')}
                                title="Slack, Discord, Email, Telegram, and many more (80+ services). Each Apprise URL embeds its own credentials — there is no global username/password."
                                className={`p-3 rounded-lg border text-left transition-all ${selectedProvider === 'apprise' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <div className="flex items-center space-x-3">
                                    <span className="text-xl">🔔</span>
                                    <h3 className="font-medium text-gray-900 text-sm">Apprise (80+ services)</h3>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Notification Events + Default Priority — applies to both providers */}
            {(mode === 'standalone' || (mode === 'client' && routingMode !== 'director_only')) && (
                <SharedNotificationSettings />
            )}

            {/* ntfy Configuration */}
            {selectedProvider === 'ntfy' && (mode === 'standalone' || (mode === 'client' && routingMode !== 'director_only')) && (
                <div className="card">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-medium text-gray-900 flex items-center">
                            <span className="text-xl mr-2">📱</span>ntfy Configuration
                        </h2>
                    </div>
                    <div className="p-6">
                        <NtfyConfigForm
                            config={ntfyConfigData?.data || null}
                            onSave={async (config) => { await saveNtfyMutation.mutateAsync(config); }}
                            isSaving={saveNtfyMutation.isLoading}
                        />
                    </div>
                </div>
            )}

            {/* Apprise Configuration */}
            {selectedProvider === 'apprise' && (mode === 'standalone' || (mode === 'client' && routingMode !== 'director_only')) && (
                <>
                    {/* Apprise API Server Configuration */}
                    <AppriseApiConfig />

                    {destinations.length === 0 && (
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
                            <div className="flex items-start space-x-4">
                                <div className="flex-shrink-0 text-4xl">📱</div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-gray-900">We recommend ntfy for push notifications</h3>
                                    <p className="mt-1 text-sm text-gray-600">
                                        ntfy is a simple push notification service. You can also use the native ntfy provider above.
                                    </p>
                                    <div className="mt-3 flex flex-wrap items-center gap-3">
                                        <button onClick={() => { setShowAddWizard(true); setSelectedService('ntfy'); }} className="btn-primary text-sm">
                                            Set up ntfy via Apprise
                                        </button>
                                        <button onClick={() => handleProviderChange('ntfy')} className="btn-secondary text-sm">
                                            Use native ntfy instead
                                        </button>
                                        <button
                                            onClick={() => {
                                                handleAddDestination('ntfy://ntfy/borgmatic');
                                                toast.success('Infinity Tools ntfy destination added');
                                            }}
                                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
                                        >
                                            <Sparkles className="w-4 h-4 mr-1.5" />
                                            Apply Infinity Tools Defaults
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {destinations.length > 0 && (
                        <div className="card">
                            <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
                                <div>
                                    <h2 className="text-lg font-medium text-gray-900">Notification Destinations</h2>
                                    <p className="mt-1 text-sm text-gray-500">Notifications will be sent to all configured destinations</p>
                                </div>
                                {!destinations.some(d => d.url.includes('ntfy://ntfy') || d.url.includes('ntfy://infinity-ntfy')) && (
                                    <button
                                        onClick={() => {
                                            handleAddDestination('ntfy://infinity-ntfy/borgmatic');
                                            toast.success('Infinity Tools ntfy destination added');
                                        }}
                                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
                                    >
                                        <Sparkles className="w-4 h-4 mr-1.5" />
                                        Add Infinity Tools ntfy
                                    </button>
                                )}
                            </div>
                            <div className="divide-y divide-gray-200">
                                {destinations.map((dest) => (
                                    <div key={dest.id} className="px-6 py-4 flex items-center justify-between">
                                        <div className="flex items-center space-x-4">
                                            <span className="text-2xl">{getServiceIcon(dest.service)}</span>
                                            <div>
                                                <p className="font-medium text-gray-900">{dest.serviceName}</p>
                                                <p className="text-sm text-gray-500">{dest.name}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={() => testAppriseMutation.mutate(dest.url)}
                                                disabled={testAppriseMutation.isLoading}
                                                className="btn-secondary text-sm flex items-center space-x-1"
                                            >
                                                {testAppriseMutation.isLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                                <span>Test</span>
                                            </button>
                                            <button
                                                onClick={() => handleEditDestination(dest)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit destination"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleRemoveDestination(dest.id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Delete destination"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {destinations.length === 0 && (
                        <div className="card">
                            <div className="p-12 text-center">
                                <Bell className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-4 text-lg font-medium text-gray-900">No notification destinations configured</h3>
                                <p className="mt-2 text-sm text-gray-500">Add a notification destination to receive alerts about your backups.</p>
                                <button onClick={() => setShowAddWizard(true)} className="mt-6 btn-primary">Add Your First Destination</button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Director Mode Info */}
            {mode === 'director' && (
                <div className="card">
                    <div className="p-6">
                        <div className="flex items-start space-x-4">
                            <Server className="w-8 h-8 text-primary-600 flex-shrink-0" />
                            <div>
                                <h3 className="text-lg font-medium text-gray-900">Director Mode Notifications</h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    In Director mode, notifications are received from connected clients and can be forwarded to your notification destinations.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'director' && <DirectorForwardingConfig />}

            {/* Add Wizard Modal */}
            {showAddWizard && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
                    <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                            <div className="flex items-center space-x-3">
                                {selectedService && (
                                    <button onClick={() => { setSelectedService(null); setEditingDestination(null); }} className="text-gray-400 hover:text-gray-600">
                                        <ChevronRight className="w-5 h-5 rotate-180" />
                                    </button>
                                )}
                                <h3 className="text-lg font-semibold text-gray-900">
                                    {selectedService 
                                        ? (editingDestination ? 'Edit Destination' : 'Configure Service') 
                                        : 'Add Notification Destination'}
                                </h3>
                            </div>
                            <button onClick={() => { setShowAddWizard(false); setSelectedService(null); setEditingDestination(null); }} className="text-gray-400 hover:text-gray-600">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            {!selectedService ? (
                                <NotificationServicePicker onSelect={(service) => setSelectedService(service)} />
                            ) : (
                                <NotificationServiceForm
                                    service={selectedService}
                                    onSubmit={editingDestination ? handleUpdateDestination : handleAddDestination}
                                    onCancel={() => { setSelectedService(null); setEditingDestination(null); }}
                                    onTest={handleTestDestination}
                                    isTesting={testAppriseMutation.isLoading}
                                    initialUrl={editingDestination?.url}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Help Modal */}
            {showHelpModal && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
                    <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full m-4 max-h-[90vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                            <div className="flex items-center space-x-3">
                                <HelpCircle className="w-6 h-6 text-blue-600" />
                                <h2 className="text-xl font-bold text-gray-900">How Notifications Work</h2>
                            </div>
                            <button onClick={() => setShowHelpModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">Two Ways to Send Notifications</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-blue-50 rounded-lg">
                                        <h4 className="font-medium text-blue-900">📱 ntfy (Native)</h4>
                                        <p className="text-sm text-blue-700 mt-1">Direct HTTP to ntfy server. Simple, fast, no dependencies.</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 rounded-lg">
                                        <h4 className="font-medium text-purple-900">🔔 Apprise</h4>
                                        <p className="text-sm text-purple-700 mt-1">80+ notification services including Slack, Discord, Email.</p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">Client Mode Routing</h3>
                                <ul className="space-y-2 text-sm text-gray-600">
                                    <li className="flex items-start"><Server className="w-4 h-4 mr-2 mt-0.5 text-gray-400" /><span><strong>Borgmatic UI Director only:</strong> All notifications go to the Director server</span></li>
                                    <li className="flex items-start"><Monitor className="w-4 h-4 mr-2 mt-0.5 text-gray-400" /><span><strong>Local Only:</strong> Notifications are sent directly from this client</span></li>
                                    <li className="flex items-start"><Zap className="w-4 h-4 mr-2 mt-0.5 text-gray-400" /><span><strong>Both:</strong> Redundant notifications to both destinations</span></li>
                                </ul>
                            </div>
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-sm text-blue-800">
                                    📚 <a href="https://ntfy.sh/docs/" target="_blank" rel="noopener noreferrer" className="underline">ntfy Documentation</a>
                                    {' | '}
                                    <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer" className="underline">Apprise Documentation</a>
                                </p>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end flex-shrink-0">
                            <button onClick={() => setShowHelpModal(false)} className="btn-primary">Got it</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
