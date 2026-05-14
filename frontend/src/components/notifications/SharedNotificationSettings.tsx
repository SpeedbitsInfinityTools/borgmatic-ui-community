import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { toast } from 'react-hot-toast';
import { Loader } from 'lucide-react';
import { appriseAPI, ntfyAPI } from '../../services/api';

type EventKey = 'success' | 'failure' | 'warning' | 'security_alert';
type Priority = 'min' | 'low' | 'default' | 'high' | 'urgent';

interface EventDef {
  key: EventKey;
  emoji: string;
  label: string;
  description: string;
  borderClass: string;
  bgClass: string;
  checkboxClass: string;
}

const EVENT_DEFS: EventDef[] = [
  {
    key: 'success',
    emoji: '✅',
    label: 'Backup Success',
    description: 'Notify when backup completes successfully',
    borderClass: 'border-green-500',
    bgClass: 'bg-green-50',
    checkboxClass: 'text-green-600 focus:ring-green-500',
  },
  {
    key: 'failure',
    emoji: '❌',
    label: 'Backup Failed',
    description: 'Notify when backup fails (recommended)',
    borderClass: 'border-red-500',
    bgClass: 'bg-red-50',
    checkboxClass: 'text-red-600 focus:ring-red-500',
  },
  {
    key: 'warning',
    emoji: '⚠️',
    label: 'Backup Warning',
    description: 'Notify when backup completes with warnings',
    borderClass: 'border-yellow-500',
    bgClass: 'bg-yellow-50',
    checkboxClass: 'text-yellow-600 focus:ring-yellow-500',
  },
  {
    key: 'security_alert',
    emoji: '🚨',
    label: 'Security Alert',
    description: 'Ransomware/canary file detection (critical)',
    borderClass: 'border-purple-500',
    bgClass: 'bg-purple-50',
    checkboxClass: 'text-purple-600 focus:ring-purple-500',
  },
];

const PRIORITY_OPTIONS: Array<{
  value: Priority;
  label: string;
  description: string;
  subtext: string;
}> = [
  { value: 'min', label: 'Min', description: 'No sound, lowest priority', subtext: 'Silent' },
  { value: 'low', label: 'Low', description: 'Low priority', subtext: 'Quiet' },
  { value: 'default', label: 'Default', description: 'Standard notification', subtext: 'Normal' },
  { value: 'high', label: 'High', description: 'High priority, more prominent', subtext: 'Prominent' },
  { value: 'urgent', label: 'Urgent', description: 'Bypasses DND, highest priority', subtext: 'Bypasses DND' },
];

const DEFAULT_NOTIFICATION_TITLES: Record<EventKey, { title: string; body: string }> = {
  success: { title: 'Backup Success', body: 'Backup completed successfully' },
  failure: { title: 'Backup Failed', body: 'Backup failed with error' },
  warning: { title: 'Backup Warning', body: 'Backup completed with warnings' },
  security_alert: { title: '🚨 Security Alert', body: 'Critical security event detected' },
};

const DEFAULT_NTFY_TAGS: Record<EventKey, string[]> = {
  success: ['white_check_mark', 'borgmatic'],
  failure: ['x', 'borgmatic'],
  warning: ['warning', 'borgmatic'],
  security_alert: ['rotating_light', 'borgmatic'],
};

const isPriority = (v: unknown): v is Priority =>
  typeof v === 'string' && ['min', 'low', 'default', 'high', 'urgent'].includes(v);

interface SharedNotificationSettingsProps {
  // Optional: hide the priority selector. Reserved for future use; defaults to true.
  showPriority?: boolean;
}

/**
 * Shared notification events + default priority that lives above the provider-specific
 * configuration. Toggling any setting here writes to BOTH ntfy.yaml and apprise.yaml
 * in parallel, so the two providers stay in sync regardless of which one is currently
 * selected. Hydration prefers ntfy values, falling back to apprise values, falling
 * back to sensible defaults.
 */
export default function SharedNotificationSettings({
  showPriority = true,
}: SharedNotificationSettingsProps) {
  const queryClient = useQueryClient();

  const { data: ntfyData, isLoading: ntfyLoading } = useQuery({
    queryKey: ['ntfy-config'],
    queryFn: () => ntfyAPI.getConfig(),
  });

  const { data: appriseData, isLoading: appriseLoading } = useQuery({
    queryKey: ['apprise-config'],
    queryFn: () => appriseAPI.getConfig(),
  });

  const [events, setEvents] = useState<Record<EventKey, boolean>>({
    success: false,
    failure: true,
    warning: true,
    security_alert: true,
  });
  const [priority, setPriority] = useState<Priority>('default');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (ntfyLoading || appriseLoading) return;

    const ntfy: any = ntfyData?.data || null;
    const apprise: any = appriseData?.data || null;

    const pickEvent = (k: EventKey, fallback: boolean): boolean => {
      const fromNtfy = ntfy?.notifications?.[k]?.enabled;
      const fromApprise = apprise?.notifications?.[k]?.enabled;
      if (typeof fromNtfy === 'boolean') return fromNtfy;
      if (typeof fromApprise === 'boolean') return fromApprise;
      return fallback;
    };

    setEvents({
      success: pickEvent('success', false),
      failure: pickEvent('failure', true),
      warning: pickEvent('warning', true),
      security_alert: pickEvent('security_alert', true),
    });

    const ntfyPriority = ntfy?.defaults?.priority;
    const apprisePriority = apprise?.settings?.priority;
    const normalizedNtfyPriority = ntfyPriority === 'max' ? 'urgent' : ntfyPriority;
    const normalizedApprisePriority = apprisePriority === 'max' ? 'urgent' : apprisePriority;
    if (isPriority(normalizedNtfyPriority)) {
      setPriority(normalizedNtfyPriority);
    } else if (isPriority(normalizedApprisePriority)) {
      setPriority(normalizedApprisePriority);
    }

    setHydrated(true);
  }, [ntfyData, appriseData, ntfyLoading, appriseLoading, hydrated]);

  const persistMutation = useMutation({
    mutationFn: async ({
      newEvents,
      newPriority,
    }: {
      newEvents: Record<EventKey, boolean>;
      newPriority: Priority;
    }) => {
      const tasks: Array<{ name: 'ntfy' | 'apprise'; promise: Promise<unknown> }> = [];

      const ntfyConfig: any = ntfyData?.data ? { ...ntfyData.data } : null;
      if (ntfyConfig) {
        const updated = {
          ...ntfyConfig,
          defaults: { ...(ntfyConfig.defaults || {}), priority: newPriority },
          notifications: { ...(ntfyConfig.notifications || {}) },
        };
        // Preserve masked secrets — backend understands "********" as "keep existing".
        if (updated.auth) {
          updated.auth = {
            ...updated.auth,
            password: updated.auth.password ?? '',
            token: updated.auth.token ?? '',
          };
          if (updated.auth.password === '') delete updated.auth.password;
          if (updated.auth.token === '') delete updated.auth.token;
        }
        (Object.keys(newEvents) as EventKey[]).forEach((k) => {
          const existing = updated.notifications[k] || {
            enabled: false,
            title: DEFAULT_NOTIFICATION_TITLES[k].title,
            message: DEFAULT_NOTIFICATION_TITLES[k].body,
            priority: 'default',
            tags: DEFAULT_NTFY_TAGS[k],
          };
          updated.notifications[k] = { ...existing, enabled: newEvents[k] };
        });
        tasks.push({ name: 'ntfy', promise: ntfyAPI.saveConfig(updated) });
      }

      const appriseConfig: any = appriseData?.data ? { ...appriseData.data } : null;
      if (appriseConfig) {
        const updated = {
          ...appriseConfig,
          settings: { ...(appriseConfig.settings || {}), priority: newPriority },
          notifications: { ...(appriseConfig.notifications || {}) },
        };
        (Object.keys(newEvents) as EventKey[]).forEach((k) => {
          const existing = updated.notifications[k] || {
            enabled: false,
            urls: [],
            title: DEFAULT_NOTIFICATION_TITLES[k].title,
            body: DEFAULT_NOTIFICATION_TITLES[k].body,
          };
          updated.notifications[k] = { ...existing, enabled: newEvents[k] };
        });
        tasks.push({ name: 'apprise', promise: appriseAPI.saveConfig(updated) });
      }

      const results = await Promise.allSettled(tasks.map((t) => t.promise));
      const failures = results
        .map((r, i) => ({ result: r, name: tasks[i].name }))
        .filter((x) => x.result.status === 'rejected');
      return { failures, total: results.length };
    },
    onSuccess: ({ failures, total }) => {
      if (total === 0) return;
      if (failures.length === total) {
        toast.error('Failed to save notification settings');
      } else if (failures.length > 0) {
        toast.error(
          `Saved with errors — ${failures.map((f) => f.name).join(', ')} failed to update`
        );
      } else {
        toast.success('Notification settings saved');
      }
      queryClient.invalidateQueries(['ntfy-config']);
      queryClient.invalidateQueries(['apprise-config']);
    },
    onError: () => {
      toast.error('Failed to save notification settings');
    },
  });

  const handleToggleEvent = (k: EventKey) => {
    const next = { ...events, [k]: !events[k] };
    setEvents(next);
    persistMutation.mutate({ newEvents: next, newPriority: priority });
  };

  const handlePriorityChange = (p: Priority) => {
    setPriority(p);
    persistMutation.mutate({ newEvents: events, newPriority: p });
  };

  const isLoading = ntfyLoading || appriseLoading;

  if (isLoading) {
    return (
      <div className="card">
        <div className="p-6 flex items-center justify-center">
          <Loader className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-gray-900">Notification Events</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Applies to both ntfy and Apprise — settings stay in sync across providers.
          </p>
        </div>
        {persistMutation.isLoading && (
          <Loader className="w-4 h-4 animate-spin text-gray-400" />
        )}
      </div>
      <div className="p-4 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EVENT_DEFS.map((def) => {
            const enabled = events[def.key];
            return (
              <label
                key={def.key}
                className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  enabled
                    ? `${def.borderClass} ${def.bgClass}`
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-lg">{def.emoji}</span>
                  <div>
                    <span className="font-medium text-gray-900">{def.label}</span>
                    <p className="text-xs text-gray-500">{def.description}</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => handleToggleEvent(def.key)}
                  className={`w-5 h-5 rounded ${def.checkboxClass}`}
                />
              </label>
            );
          })}
        </div>

        {showPriority && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Default Settings</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Priority
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Controls how notifications appear on your device. Higher priorities are more
              intrusive. ntfy honors all five levels; Apprise destinations honor whatever
              the underlying service supports.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handlePriorityChange(option.value)}
                  className={`p-2 text-center rounded-lg border-2 transition-colors ${
                    priority === option.value
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
              {PRIORITY_OPTIONS.map((o) => (
                <span key={o.value}>{o.subtext}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
