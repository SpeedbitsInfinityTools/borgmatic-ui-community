import React from 'react';
import { Star, ExternalLink, HelpCircle } from 'lucide-react';

interface NotificationService {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'generic' | 'push' | 'chat' | 'email' | 'webhook' | 'other';
  recommended?: boolean;
  isGeneric?: boolean;
  docsUrl?: string;
}

const NOTIFICATION_SERVICES: NotificationService[] = [
  // Generic fallback - FIRST
  {
    id: 'generic',
    name: 'Other Service (Not Listed)',
    description: 'Use any of the 100+ Apprise-supported services by entering the URL directly.',
    icon: '🔧',
    category: 'generic',
    isGeneric: true,
    docsUrl: 'https://github.com/caronc/apprise/wiki/',
  },

  // Push Notifications (recommended first)
  {
    id: 'ntfy',
    name: 'ntfy',
    description: 'Simple, self-hosted push notifications. Included in Infinity Tools.',
    icon: '📱',
    category: 'push',
    recommended: true,
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_ntfy',
  },
  {
    id: 'pushover',
    name: 'Pushover',
    description: 'Reliable push notifications for mobile devices.',
    icon: '📲',
    category: 'push',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_pushover',
  },
  {
    id: 'gotify',
    name: 'Gotify',
    description: 'Self-hosted push notification server.',
    icon: '🔔',
    category: 'push',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_gotify',
  },
  {
    id: 'pushbullet',
    name: 'Pushbullet',
    description: 'Connect your devices for push notifications.',
    icon: '🔫',
    category: 'push',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_pushbullet',
  },

  // Chat Apps
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send notifications to Slack channels.',
    icon: '💬',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_slack',
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send notifications to Discord channels.',
    icon: '🎮',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_discord',
  },
  {
    id: 'msteams',
    name: 'Microsoft Teams',
    description: 'Send notifications to Teams channels.',
    icon: '👔',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_msteams',
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    description: 'Self-hosted Slack alternative.',
    icon: '💭',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_mattermost',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Send notifications via Telegram bot.',
    icon: '✈️',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_telegram',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Open, federated chat network.',
    icon: '🔷',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_matrix',
  },
  {
    id: 'rocketchat',
    name: 'Rocket.Chat',
    description: 'Open source team chat.',
    icon: '🚀',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_rocketchat',
  },
  {
    id: 'zulip',
    name: 'Zulip',
    description: 'Threaded group chat for teams.',
    icon: '💧',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_zulip',
  },
  {
    id: 'googlechat',
    name: 'Google Chat',
    description: 'Send notifications to Google Chat spaces.',
    icon: '💚',
    category: 'chat',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_googlechat',
  },

  // Email
  {
    id: 'email',
    name: 'Email (SMTP)',
    description: 'Send notifications via email. Works with Gmail, Outlook, etc.',
    icon: '📧',
    category: 'email',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_email',
  },

  // Webhooks
  {
    id: 'webhook',
    name: 'Webhook (JSON)',
    description: 'Send JSON payloads to any HTTP endpoint.',
    icon: '🔗',
    category: 'webhook',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_Custom_JSON',
  },
  {
    id: 'form',
    name: 'Webhook (Form)',
    description: 'Send form data to any HTTP endpoint.',
    icon: '📝',
    category: 'webhook',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_Custom_Form',
  },

  // Other Services
  {
    id: 'signal',
    name: 'Signal',
    description: 'Secure messaging via Signal-CLI API.',
    icon: '📶',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_signal',
  },
  {
    id: 'opsgenie',
    name: 'OpsGenie',
    description: 'Incident management and alerting.',
    icon: '🔧',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_opsgenie',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    description: 'Incident response platform.',
    icon: '🚨',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_pagerduty',
  },
  {
    id: 'ifttt',
    name: 'IFTTT',
    description: 'Connect to thousands of services.',
    icon: '⚡',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_ifttt',
  },
  {
    id: 'join',
    name: 'Join',
    description: 'Push notifications from joaoapps.',
    icon: '🔀',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_join',
  },
  {
    id: 'simplepush',
    name: 'SimplePush',
    description: 'Simple encrypted push notifications.',
    icon: '📨',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_simplepush',
  },
  {
    id: 'prowl',
    name: 'Prowl',
    description: 'Push notifications for iOS.',
    icon: '🦁',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_prowl',
  },
  {
    id: 'twilio',
    name: 'Twilio SMS',
    description: 'Send SMS text messages.',
    icon: '📱',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_twilio',
  },
  {
    id: 'clicksend',
    name: 'ClickSend',
    description: 'SMS, email, and more.',
    icon: '📤',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_clicksend',
  },
  {
    id: 'kavenegar',
    name: 'Kavenegar',
    description: 'SMS gateway for Iran.',
    icon: '🇮🇷',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_kavenegar',
  },
  {
    id: 'messagebird',
    name: 'MessageBird',
    description: 'SMS and messaging API.',
    icon: '🐦',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_messagebird',
  },
  {
    id: 'syslog',
    name: 'Syslog',
    description: 'Send to syslog server.',
    icon: '📋',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_syslog',
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    description: 'Home automation notifications.',
    icon: '🏠',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_homeassistant',
  },
  {
    id: 'notica',
    name: 'Notica',
    description: 'Simple browser notifications.',
    icon: '🔔',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_notica',
  },
  {
    id: 'dbus',
    name: 'D-Bus / Desktop',
    description: 'Linux desktop notifications.',
    icon: '🖥️',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_dbus',
  },
  {
    id: 'windows',
    name: 'Windows',
    description: 'Windows toast notifications.',
    icon: '🪟',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_windows',
  },
  {
    id: 'macosx',
    name: 'macOS',
    description: 'macOS notifications.',
    icon: '🍎',
    category: 'other',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_macosx',
  },
];

const CATEGORIES = [
  { id: 'push', name: '📱 Push Notifications', description: 'Mobile and desktop push' },
  { id: 'chat', name: '💬 Chat Apps', description: 'Team communication' },
  { id: 'email', name: '📧 Email', description: 'Traditional email' },
  { id: 'webhook', name: '🔗 Webhooks', description: 'Custom integrations' },
  { id: 'other', name: '📦 Other Services', description: 'SMS, desktop, and more' },
];

interface NotificationServicePickerProps {
  onSelect: (serviceId: string) => void;
}

const NotificationServicePicker: React.FC<NotificationServicePickerProps> = ({ onSelect }) => {
  const genericService = NOTIFICATION_SERVICES.find(s => s.isGeneric);

  return (
    <div className="space-y-6">
      {/* Generic / Not Listed Option - Show First */}
      {genericService && (
        <div>
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center">
            <HelpCircle className="w-4 h-4 mr-1 text-gray-500" />
            Service Not Listed?
          </h4>
          <button
            onClick={() => onSelect(genericService.id)}
            className="w-full flex items-center p-4 bg-gradient-to-r from-gray-50 to-slate-50 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:bg-gray-100 transition-all text-left"
          >
            <span className="text-3xl mr-4">{genericService.icon}</span>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{genericService.name}</p>
              <p className="text-sm text-gray-600 mt-0.5">{genericService.description}</p>
            </div>
            <a
              href={genericService.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-2 px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center"
              title="View all supported services"
            >
              View All 100+ Services <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </button>
        </div>
      )}

      {/* Recommended Service */}
      <div>
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center">
          <Star className="w-4 h-4 mr-1 text-yellow-500" />
          Recommended
        </h4>
        <div className="grid grid-cols-1 gap-3">
          {NOTIFICATION_SERVICES.filter(s => s.recommended).map(service => (
            <button
              key={service.id}
              onClick={() => onSelect(service.id)}
              className="flex items-center p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all text-left"
            >
              <span className="text-3xl mr-4">{service.icon}</span>
              <div className="flex-1">
                <div className="flex items-center">
                  <p className="font-semibold text-gray-900">{service.name}</p>
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                    Recommended
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{service.description}</p>
              </div>
              {service.docsUrl && (
                <a
                  href={service.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-2 p-1 text-gray-400 hover:text-blue-600"
                  title="View documentation"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* All Categories */}
      {CATEGORIES.map(category => {
        const categoryServices = NOTIFICATION_SERVICES.filter(
          s => s.category === category.id && !s.recommended && !s.isGeneric
        );
        
        if (categoryServices.length === 0) return null;

        return (
          <div key={category.id}>
            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {category.name}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {categoryServices.map(service => (
                <button
                  key={service.id}
                  onClick={() => onSelect(service.id)}
                  className="flex items-center p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all text-left group"
                >
                  <span className="text-2xl mr-3">{service.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 group-hover:text-blue-600">
                      {service.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{service.description}</p>
                  </div>
                  {service.docsUrl && (
                    <a
                      href={service.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-1 p-1 text-gray-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="View documentation"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Help Text */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-sm text-blue-800">
          <strong>💡 Tip:</strong> All notifications are powered by{' '}
          <a
            href="https://github.com/caronc/apprise/wiki/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline font-medium"
          >
            Apprise
          </a>
          , which supports <strong>100+ notification services</strong>. 
          Can't find your service? Use "Other Service (Not Listed)" above and enter the Apprise URL directly.
        </p>
      </div>
    </div>
  );
};

export default NotificationServicePicker;

