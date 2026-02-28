import React, { useState } from 'react';
import {
  CheckCircle,
  AlertCircle,
  Clock,
  Calendar,
  Info,
  Loader,
  Settings,
  Activity,
} from 'lucide-react';

interface HealthSettings {
  check_enabled: boolean;
  check_frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'never';
  check_day: number; // 0-6 for day of week, 1-28 for day of month
  check_time: string; // HH:MM format
  check_type: 'repository' | 'archives' | 'full';
  max_duration_hours: number;
  last_check_date?: string;
  last_check_status?: 'success' | 'failed' | 'running';
  last_check_message?: string;
  next_scheduled_check?: string;
}

interface RepositoryHealthSettingsProps {
  repositoryPath: string;
  initialSettings?: Partial<HealthSettings>;
  onChange: (settings: HealthSettings) => void;
  onRunCheck?: () => void;
  isCheckRunning?: boolean;
}

const DEFAULT_SETTINGS: HealthSettings = {
  check_enabled: false,
  check_frequency: 'monthly',
  check_day: 1,
  check_time: '03:00',
  check_type: 'repository',
  max_duration_hours: 4,
};

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly', description: 'Every week on the selected day' },
  { value: 'biweekly', label: 'Every 2 Weeks', description: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly', description: 'Once a month on the selected day' },
  { value: 'quarterly', label: 'Quarterly', description: 'Every 3 months' },
  { value: 'never', label: 'Never (Manual Only)', description: 'Only run checks manually' },
];

const CHECK_TYPE_OPTIONS = [
  { 
    value: 'repository', 
    label: 'Repository Only', 
    description: 'Check repository structure (fast)',
    duration: '~5 minutes'
  },
  { 
    value: 'archives', 
    label: 'Archives Metadata', 
    description: 'Verify archive metadata integrity',
    duration: '~15 minutes'
  },
  { 
    value: 'full', 
    label: 'Full Verification', 
    description: 'Verify all file contents (slow but thorough)',
    duration: '~1-4 hours'
  },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const RepositoryHealthSettings: React.FC<RepositoryHealthSettingsProps> = ({
  initialSettings,
  onChange,
  onRunCheck,
  isCheckRunning = false,
}) => {
  const [settings, setSettings] = useState<HealthSettings>({
    ...DEFAULT_SETTINGS,
    ...initialSettings,
  });

  const updateSettings = (updates: Partial<HealthSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    onChange(newSettings);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusBadge = () => {
    if (!settings.last_check_status) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <Clock className="w-3 h-3 mr-1" />
          Never checked
        </span>
      );
    }

    switch (settings.last_check_status) {
      case 'success':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Healthy
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            Issues Found
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Loader className="w-3 h-3 mr-1 animate-spin" />
            Checking...
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium text-gray-900">Health Checks</h3>
        </div>
        {getStatusBadge()}
      </div>

      {/* Last Check Info */}
      {settings.last_check_date && (
        <div className={`p-4 rounded-lg ${
          settings.last_check_status === 'success' ? 'bg-green-50 border border-green-200' :
          settings.last_check_status === 'failed' ? 'bg-red-50 border border-red-200' :
          'bg-gray-50 border border-gray-200'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Last Check</p>
              <p className="text-sm text-gray-600">{formatDate(settings.last_check_date)}</p>
              {settings.last_check_message && (
                <p className="text-xs text-gray-500 mt-1">{settings.last_check_message}</p>
              )}
            </div>
            {onRunCheck && (
              <button
                onClick={onRunCheck}
                disabled={isCheckRunning}
                className="btn-secondary flex items-center space-x-2 text-sm disabled:opacity-50"
              >
                {isCheckRunning ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>{isCheckRunning ? 'Checking...' : 'Run Now'}</span>
              </button>
            )}
          </div>
          {settings.next_scheduled_check && settings.check_enabled && (
            <p className="text-xs text-gray-500 mt-2">
              Next scheduled: {formatDate(settings.next_scheduled_check)}
            </p>
          )}
        </div>
      )}

      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="text-sm font-medium text-gray-900">Scheduled Health Checks</p>
          <p className="text-xs text-gray-500">Automatically verify repository integrity</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.check_enabled}
            onChange={(e) => updateSettings({ check_enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Schedule Configuration */}
      {settings.check_enabled && (
        <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
          {/* Frequency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Check Frequency
            </label>
            <select
              value={settings.check_frequency}
              onChange={(e) => updateSettings({ check_frequency: e.target.value as any })}
              className="input w-full"
            >
              {FREQUENCY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {FREQUENCY_OPTIONS.find(o => o.value === settings.check_frequency)?.description}
            </p>
          </div>

          {/* Day Selection */}
          {settings.check_frequency !== 'never' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {settings.check_frequency === 'weekly' || settings.check_frequency === 'biweekly' 
                    ? 'Day of Week' 
                    : 'Day of Month'}
                </label>
                {settings.check_frequency === 'weekly' || settings.check_frequency === 'biweekly' ? (
                  <select
                    value={settings.check_day}
                    onChange={(e) => updateSettings({ check_day: parseInt(e.target.value) })}
                    className="input w-full"
                  >
                    {DAYS_OF_WEEK.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={settings.check_day}
                    onChange={(e) => updateSettings({ check_day: parseInt(e.target.value) })}
                    className="input w-full"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Time
                </label>
                <input
                  type="time"
                  value={settings.check_time}
                  onChange={(e) => updateSettings({ check_time: e.target.value })}
                  className="input w-full"
                />
              </div>
            </div>
          )}

          {/* Check Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Check Type
            </label>
            <div className="space-y-2">
              {CHECK_TYPE_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                    settings.check_type === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="check_type"
                    value={option.value}
                    checked={settings.check_type === option.value}
                    onChange={(e) => updateSettings({ check_type: e.target.value as any })}
                    className="mt-1"
                  />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900">{option.label}</p>
                    <p className="text-xs text-gray-500">{option.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Duration: {option.duration}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Max Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Maximum Duration (hours)
            </label>
            <input
              type="number"
              min={1}
              max={24}
              value={settings.max_duration_hours}
              onChange={(e) => updateSettings({ max_duration_hours: parseInt(e.target.value) || 4 })}
              className="input w-32"
            />
            <p className="text-xs text-gray-500 mt-1">
              Check will be cancelled if it exceeds this duration
            </p>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start space-x-2">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">About Health Checks</p>
            <p className="mt-1 text-xs">
              Regular health checks verify your backup repository's integrity. They detect 
              corruption, ensure data consistency, and help catch problems before you need 
              to restore. We recommend monthly checks for most repositories.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RepositoryHealthSettings;

