import { useState, useEffect } from 'react';
import { useMutation } from 'react-query';
import { ntfyAPI } from '../../services/api';
import { toast } from 'react-hot-toast';
import {
  Send,
  Loader,
  Check,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
  Bell,
  BellOff,
} from 'lucide-react';

interface NtfyConfig {
  enabled: boolean;
  server: string;
  topic: string;
  auth: {
    type: 'none' | 'basic' | 'token';
    username: string;
    password: string;
    token: string;
  };
  defaults: {
    priority: string;
    tags: string[];
  };
  notifications: {
    [key: string]: {
      enabled: boolean;
      title: string;
      message: string;
      priority: string;
      tags: string[];
    };
  };
}

interface NtfyConfigFormProps {
  config: NtfyConfig | null;
  onSave: (config: NtfyConfig) => Promise<void>;
  onTest?: () => void;
  isSaving?: boolean;
}

export default function NtfyConfigForm({ config, onSave, onTest, isSaving }: NtfyConfigFormProps) {
  const [formData, setFormData] = useState<NtfyConfig>({
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    auth: {
      type: 'none',
      username: '',
      password: '',
      token: '',
    },
    defaults: {
      priority: 'default',
      tags: ['borgmatic'],
    },
    notifications: {
      success: { enabled: false, title: 'Backup Success', message: 'Backup completed successfully', priority: 'default', tags: ['white_check_mark', 'borgmatic'] },
      failure: { enabled: true, title: 'Backup Failed', message: 'Backup failed with error', priority: 'high', tags: ['x', 'borgmatic'] },
      warning: { enabled: true, title: 'Backup Warning', message: 'Backup completed with warnings', priority: 'default', tags: ['warning', 'borgmatic'] },
      security_alert: { enabled: true, title: '🚨 Security Alert', message: 'Critical security event detected', priority: 'urgent', tags: ['rotating_light', 'borgmatic'] },
    },
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);
  
  // Track if password/token are masked (came from backend as ********)
  const [passwordMasked, setPasswordMasked] = useState(false);
  const [tokenMasked, setTokenMasked] = useState(false);

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: () => {
      // Use masked values for test if user hasn't changed them
      const testData = {
        ...formData,
        auth: {
          ...formData.auth,
          password: passwordMasked ? '********' : formData.auth.password,
          token: tokenMasked ? '********' : formData.auth.token,
        }
      };
      return ntfyAPI.testConnection(testData);
    },
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

  // Update form when config changes
  useEffect(() => {
    if (config) {
      // Detect masked values from backend
      const isMaskedPassword = config.auth?.password === '********';
      const isMaskedToken = config.auth?.token === '********';
      
      setPasswordMasked(isMaskedPassword);
      setTokenMasked(isMaskedToken);
      
      setFormData(prev => ({
        ...prev,
        ...config,
        auth: {
          ...prev.auth,
          ...config.auth,
          // Clear masked values - we'll show placeholder instead
          password: isMaskedPassword ? '' : (config.auth?.password || ''),
          token: isMaskedToken ? '' : (config.auth?.token || ''),
        },
        defaults: {
          ...prev.defaults,
          ...config.defaults,
        },
        notifications: {
          ...prev.notifications,
          ...config.notifications,
        },
      }));
    }
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.topic) {
      toast.error('Please enter a topic name');
      return;
    }

    // Prepare data for save - restore masked values if user didn't change them
    const dataToSave = {
      ...formData,
      auth: {
        ...formData.auth,
        // If still masked (user didn't type anything), send ******** so backend preserves existing value
        password: passwordMasked ? '********' : formData.auth.password,
        token: tokenMasked ? '********' : formData.auth.token,
      }
    };

    await onSave(dataToSave);
  };

  const priorityOptions = [
    { value: 'min', label: 'Min', description: 'No sound, lowest priority' },
    { value: 'low', label: 'Low', description: 'Low priority' },
    { value: 'default', label: 'Default', description: 'Standard notification' },
    { value: 'high', label: 'High', description: 'High priority, more prominent' },
    { value: 'urgent', label: 'Urgent', description: 'Bypasses DND, highest priority' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Enable/Disable - PROMINENT */}
      <div className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
        formData.enabled 
          ? 'bg-green-50 border-green-500' 
          : 'bg-amber-50 border-amber-400'
      }`}>
        <div className="flex items-center space-x-3">
          {formData.enabled ? (
            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
              <Bell className="w-5 h-5 text-white" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center">
              <BellOff className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <h3 className={`font-semibold ${formData.enabled ? 'text-green-800' : 'text-amber-800'}`}>
              {formData.enabled ? 'ntfy Notifications Enabled' : 'ntfy Notifications Disabled'}
            </h3>
            <p className={`text-sm ${formData.enabled ? 'text-green-600' : 'text-amber-600'}`}>
              {formData.enabled 
                ? 'You will receive push notifications on your device' 
                : 'Enable to receive push notifications on your phone/device'}
            </p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={formData.enabled}
            onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className={`w-14 h-7 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all ${
            formData.enabled 
              ? 'bg-green-500 peer-focus:ring-4 peer-focus:ring-green-300' 
              : 'bg-gray-300 peer-focus:ring-4 peer-focus:ring-amber-300'
          }`}></div>
        </label>
      </div>

      {/* Warning when disabled */}
      {!formData.enabled && (
        <div className="flex items-center space-x-2 p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-800">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">
            Notifications are disabled. You won't receive any alerts until you enable this and save.
          </span>
        </div>
      )}

      {/* Server Configuration */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            Server Configuration
            <a
              href="https://ntfy.sh/docs/"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </h3>
          <button
            type="button"
            onClick={() => {
              setFormData({
                ...formData,
                server: 'http://ntfy',
                topic: 'borgmatic',
                auth: {
                  ...formData.auth,
                  type: 'none',
                },
              });
              toast.success('Infinity Tools defaults applied');
            }}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            Apply Infinity Tools Defaults
          </button>
        </div>

        {/* Server URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Server URL
          </label>
          <input
            type="url"
            value={formData.server}
            onChange={(e) => setFormData({ ...formData, server: e.target.value })}
            placeholder="http://ntfy"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            For Infinity Tools: use <code className="bg-gray-100 px-1 rounded">http://ntfy</code> or <code className="bg-gray-100 px-1 rounded">http://infinity-ntfy</code>, or <code className="bg-gray-100 px-1 rounded">https://ntfy.sh</code> for the public server
          </p>
        </div>

        {/* Topic */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Topic <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.topic}
            onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
            placeholder="borgmatic-alerts"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            Choose a unique topic name. Subscribe to this in your ntfy app.
          </p>
        </div>
      </div>

      {/* Authentication */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Authentication</h3>

        {/* Auth Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Authentication Type
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="authType"
                value="none"
                checked={formData.auth.type === 'none'}
                onChange={() => setFormData({
                  ...formData,
                  auth: { ...formData.auth, type: 'none' }
                })}
                className="mr-2"
              />
              <span className="text-sm">None (not supported by Infinity Tools ntfy server)</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="authType"
                value="basic"
                checked={formData.auth.type === 'basic'}
                onChange={() => setFormData({
                  ...formData,
                  auth: { ...formData.auth, type: 'basic' }
                })}
                className="mr-2"
              />
              <span className="text-sm">Username & Password</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="authType"
                value="token"
                checked={formData.auth.type === 'token'}
                onChange={() => setFormData({
                  ...formData,
                  auth: { ...formData.auth, type: 'token' }
                })}
                className="mr-2"
              />
              <span className="text-sm">Access Token</span>
            </label>
          </div>
        </div>

        {/* Basic Auth Fields */}
        {formData.auth.type === 'basic' && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={formData.auth.username}
                onChange={(e) => setFormData({
                  ...formData,
                  auth: { ...formData.auth, username: e.target.value }
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
                {passwordMasked && (
                  <span className="ml-2 text-xs text-green-600 font-normal">(saved securely)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.auth.password}
                  onChange={(e) => {
                    setPasswordMasked(false); // User is typing, clear masked state
                    setFormData({
                      ...formData,
                      auth: { ...formData.auth, password: e.target.value }
                    });
                  }}
                  placeholder={passwordMasked ? '••••••••  (enter new to change)' : 'Enter password'}
                  autoComplete="new-password"
                  className={`w-full px-3 py-2 pr-10 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    passwordMasked ? 'border-green-300 bg-green-50' : 'border-gray-300'
                  }`}
                />
                {!passwordMasked && formData.auth.password && (
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Token Auth Field */}
        {formData.auth.type === 'token' && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Access Token
              {tokenMasked && (
                <span className="ml-2 text-xs text-green-600 font-normal">(saved securely)</span>
              )}
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={formData.auth.token}
                onChange={(e) => {
                  setTokenMasked(false); // User is typing, clear masked state
                  setFormData({
                    ...formData,
                    auth: { ...formData.auth, token: e.target.value }
                  });
                }}
                placeholder={tokenMasked ? '••••••••  (enter new to change)' : 'tk_...'}
                autoComplete="new-password"
                className={`w-full px-3 py-2 pr-10 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  tokenMasked ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
              />
              {!tokenMasked && formData.auth.token && (
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Generate an access token in your ntfy server settings
            </p>
          </div>
        )}
      </div>

      {/* Notification Events */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Notification Events</h3>
        <p className="text-sm text-gray-500">Choose which events trigger a notification to your phone/device.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Success */}
          <label className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
            formData.notifications.success.enabled 
              ? 'border-green-500 bg-green-50' 
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-center space-x-3">
              <span className="text-lg">✅</span>
              <div>
                <span className="font-medium text-gray-900">Backup Success</span>
                <p className="text-xs text-gray-500">Notify when backup completes successfully</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={formData.notifications.success.enabled}
              onChange={(e) => setFormData({
                ...formData,
                notifications: {
                  ...formData.notifications,
                  success: { ...formData.notifications.success, enabled: e.target.checked }
                }
              })}
              className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
            />
          </label>

          {/* Failure */}
          <label className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
            formData.notifications.failure.enabled 
              ? 'border-red-500 bg-red-50' 
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-center space-x-3">
              <span className="text-lg">❌</span>
              <div>
                <span className="font-medium text-gray-900">Backup Failed</span>
                <p className="text-xs text-gray-500">Notify when backup fails (recommended)</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={formData.notifications.failure.enabled}
              onChange={(e) => setFormData({
                ...formData,
                notifications: {
                  ...formData.notifications,
                  failure: { ...formData.notifications.failure, enabled: e.target.checked }
                }
              })}
              className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
            />
          </label>

          {/* Warning */}
          <label className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
            formData.notifications.warning.enabled 
              ? 'border-yellow-500 bg-yellow-50' 
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-center space-x-3">
              <span className="text-lg">⚠️</span>
              <div>
                <span className="font-medium text-gray-900">Backup Warning</span>
                <p className="text-xs text-gray-500">Notify when backup completes with warnings</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={formData.notifications.warning.enabled}
              onChange={(e) => setFormData({
                ...formData,
                notifications: {
                  ...formData.notifications,
                  warning: { ...formData.notifications.warning, enabled: e.target.checked }
                }
              })}
              className="w-5 h-5 text-yellow-600 rounded focus:ring-yellow-500"
            />
          </label>

          {/* Security Alert */}
          <label className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
            formData.notifications.security_alert.enabled 
              ? 'border-purple-500 bg-purple-50' 
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-center space-x-3">
              <span className="text-lg">🚨</span>
              <div>
                <span className="font-medium text-gray-900">Security Alert</span>
                <p className="text-xs text-gray-500">Ransomware/canary file detection (critical)</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={formData.notifications.security_alert.enabled}
              onChange={(e) => setFormData({
                ...formData,
                notifications: {
                  ...formData.notifications,
                  security_alert: { ...formData.notifications.security_alert, enabled: e.target.checked }
                }
              })}
              className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
            />
          </label>
        </div>
      </div>

      {/* Default Priority */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Default Settings</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default Priority
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Controls how notifications appear on your device. Higher priorities are more intrusive.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {priorityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  defaults: { ...formData.defaults, priority: option.value }
                })}
                className={`p-2 text-center rounded-lg border-2 transition-colors ${formData.defaults.priority === option.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
                  }`}
                title={option.description}
              >
                <span className="text-sm font-medium">{option.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500 grid grid-cols-5 gap-2 text-center">
            <span>Silent</span>
            <span>Quiet</span>
            <span>Normal</span>
            <span>Prominent</span>
            <span>Bypasses DND</span>
          </div>
        </div>
      </div>

      {/* Test & Save Buttons */}
      <div className="flex items-center justify-between pt-4 border-t">
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isLoading || !formData.topic}
          className="btn-secondary flex items-center space-x-2"
        >
          {testMutation.isLoading ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>Send Test</span>
        </button>

        <button
          type="submit"
          disabled={isSaving || !formData.topic}
          className="btn-primary flex items-center space-x-2"
        >
          {isSaving ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>Save Configuration</span>
        </button>
      </div>

      {/* Help Info */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start space-x-3">
          <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">How to receive notifications:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>Install the ntfy app on your phone (Android/iOS) or desktop</li>
              <li>Subscribe to your topic: <code className="bg-blue-100 px-1 rounded">{formData.topic || 'your-topic'}</code></li>
              <li>Click "Send Test" to verify it works</li>
            </ol>

            <p className="font-medium mt-3 mb-1">When to use authentication:</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li><strong>None:</strong> Only if your ntfy server allows unauthenticated access</li>
              <li><strong>Username/Password or Token:</strong> Required for Infinity Tools ntfy (default), public ntfy.sh, or any secured server</li>
            </ul>
            <p className="mt-2 text-blue-600 text-xs">
              <strong>Note:</strong> The standard Infinity Tools ntfy installation requires authentication by default.
            </p>

            <a
              href="https://ntfy.sh/docs/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center mt-2 text-blue-600 hover:text-blue-800"
            >
              Learn more about ntfy <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </div>
        </div>
      </div>
    </form>
  );
}
