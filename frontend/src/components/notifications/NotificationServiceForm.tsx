import React, { useState, useEffect } from 'react';
import {
  Send,
  Check,
  Loader,
  Info,
  ExternalLink,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';

interface NotificationServiceFormProps {
  service: string;
  onSubmit: (url: string, serviceName: string) => void;
  onCancel: () => void;
  onTest: (url: string) => Promise<boolean>;  // Returns true if test succeeded
  isTesting: boolean;
  initialUrl?: string;  // For editing existing destinations
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
}

interface ServiceConfig {
  name: string;
  icon: string;
  description: string;
  docsUrl?: string;
  fields: FormField[];
  buildUrl: (values: Record<string, any>) => string;
  parseUrl?: (url: string) => Record<string, any>;  // Parse URL back to field values
  helpSteps?: string[];
}

const SERVICE_CONFIGS: Record<string, ServiceConfig> = {
  ntfy: {
    name: 'ntfy',
    icon: '📱',
    description: 'Simple push notifications to your phone or desktop.',
    docsUrl: 'https://ntfy.sh/docs/',
    fields: [
      {
        name: 'topic',
        label: 'Topic',
        type: 'text',
        placeholder: 'borgmatic-alerts',
        required: true,
        helpText: 'The topic name (like a channel). Choose something unique.',
      },
      {
        name: 'server',
        label: 'Server URL',
        type: 'text',
        placeholder: 'ntfy.sh',
        helpText: 'Leave as ntfy.sh for the public server, or enter your self-hosted server.',
        defaultValue: 'ntfy.sh',
      },
      {
        name: 'useHttps',
        label: 'Use HTTPS',
        type: 'checkbox',
        defaultValue: true,
        helpText: 'Use secure connection (recommended).',
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { value: '', label: 'Default' },
          { value: 'max', label: 'Max (urgent)' },
          { value: 'high', label: 'High' },
          { value: 'default', label: 'Normal' },
          { value: 'low', label: 'Low' },
          { value: 'min', label: 'Min (silent)' },
        ],
      },
      {
        name: 'username',
        label: 'Username',
        type: 'text',
        placeholder: 'Optional',
        helpText: 'Only if your ntfy server requires authentication.',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        placeholder: 'Optional',
        helpText: 'Only if your ntfy server requires authentication.',
      },
    ],
    buildUrl: (values) => {
      const protocol = values.useHttps ? 'ntfys' : 'ntfy';
      const server = values.server || 'ntfy.sh';
      const topic = values.topic;
      
      let url = `${protocol}://`;
      
      if (values.username && values.password) {
        url += `${encodeURIComponent(values.username)}:${encodeURIComponent(values.password)}@`;
      }
      
      url += `${server}/${topic}`;
      
      const params = [];
      if (values.priority) params.push(`priority=${values.priority}`);
      
      if (params.length > 0) {
        url += `?${params.join('&')}`;
      }
      
      return url;
    },
    parseUrl: (url) => {
      // ntfy://server/topic or ntfys://user:pass@server/topic
      const match = url.match(/^(ntfys?):\/\/(?:([^:@]+):([^@]+)@)?([^/?]+)\/([^?]+)(?:\?.*)?$/);
      if (match) {
        return {
          useHttps: match[1] === 'ntfys',
          username: match[2] ? decodeURIComponent(match[2]) : '',
          password: match[3] ? decodeURIComponent(match[3]) : '',
          server: match[4],
          topic: match[5],
        };
      }
      return {};
    },
    helpSteps: [
      'Install the ntfy app on your phone (Android/iOS) or use the web app',
      'Subscribe to your chosen topic (e.g., "borgmatic-alerts")',
      'You\'ll receive notifications when backups complete or fail',
    ],
  },

  slack: {
    name: 'Slack',
    icon: '💬',
    description: 'Send notifications to a Slack channel via webhook.',
    docsUrl: 'https://api.slack.com/messaging/webhooks',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://hooks.slack.com/services/T.../B.../...',
        required: true,
        helpText: 'The incoming webhook URL from Slack.',
      },
      {
        name: 'channel',
        label: 'Channel Override',
        type: 'text',
        placeholder: '#backups (optional)',
        helpText: 'Override the default channel. Include the # prefix.',
      },
      {
        name: 'botName',
        label: 'Bot Name',
        type: 'text',
        placeholder: 'Borgmatic',
        helpText: 'The name shown for the bot.',
        defaultValue: 'Borgmatic',
      },
    ],
    buildUrl: (values) => {
      // Extract webhook parts from URL
      const match = values.webhookUrl.match(/hooks\.slack\.com\/services\/([^/]+)\/([^/]+)\/(.+)/);
      if (match) {
        let url = `slack://${match[1]}/${match[2]}/${match[3]}`;
        const params = [];
        if (values.channel) params.push(`channel=${encodeURIComponent(values.channel)}`);
        if (values.botName) params.push(`user=${encodeURIComponent(values.botName)}`);
        if (params.length > 0) url += `?${params.join('&')}`;
        return url;
      }
      // Fallback: just use the full webhook URL
      return values.webhookUrl;
    },
    parseUrl: (url) => {
      // slack://tokenA/tokenB/tokenC?channel=x&user=y
      const match = url.match(/^slack:\/\/([^/]+)\/([^/]+)\/([^?]+)(?:\?(.*))?$/);
      if (match) {
        const params = match[4] ? new URLSearchParams(match[4]) : new URLSearchParams();
        return {
          webhookUrl: `https://hooks.slack.com/services/${match[1]}/${match[2]}/${match[3]}`,
          channel: params.get('channel') ? decodeURIComponent(params.get('channel')!) : '',
          botName: params.get('user') ? decodeURIComponent(params.get('user')!) : 'Borgmatic',
        };
      }
      return {};
    },
    helpSteps: [
      'Go to api.slack.com/apps and create a new app',
      'Enable Incoming Webhooks and add a new webhook',
      'Select the channel to post to',
      'Copy the webhook URL and paste it above',
    ],
  },

  discord: {
    name: 'Discord',
    icon: '🎮',
    description: 'Send notifications to a Discord channel via webhook.',
    docsUrl: 'https://discord.com/developers/docs/resources/webhook',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://discord.com/api/webhooks/...',
        required: true,
        helpText: 'The webhook URL from Discord channel settings.',
      },
      {
        name: 'botName',
        label: 'Bot Name',
        type: 'text',
        placeholder: 'Borgmatic',
        helpText: 'Override the webhook bot name.',
        defaultValue: 'Borgmatic',
      },
      {
        name: 'tts',
        label: 'Text-to-Speech',
        type: 'checkbox',
        defaultValue: false,
        helpText: 'Read messages aloud in the channel.',
      },
    ],
    buildUrl: (values) => {
      // Extract webhook ID and token from URL
      const match = values.webhookUrl.match(/discord\.com\/api\/webhooks\/(\d+)\/(.+)/);
      if (match) {
        let url = `discord://${match[1]}/${match[2]}`;
        const params = [];
        if (values.botName) params.push(`user=${encodeURIComponent(values.botName)}`);
        if (values.tts) params.push('tts=yes');
        if (params.length > 0) url += `?${params.join('&')}`;
        return url;
      }
      return values.webhookUrl;
    },
    parseUrl: (url) => {
      // discord://webhookId/token?user=x&tts=yes
      const match = url.match(/^discord:\/\/(\d+)\/([^?]+)(?:\?(.*))?$/);
      if (match) {
        const params = match[3] ? new URLSearchParams(match[3]) : new URLSearchParams();
        return {
          webhookUrl: `https://discord.com/api/webhooks/${match[1]}/${match[2]}`,
          botName: params.get('user') ? decodeURIComponent(params.get('user')!) : 'Borgmatic',
          tts: params.get('tts') === 'yes',
        };
      }
      return {};
    },
    helpSteps: [
      'Open Discord and go to the channel where you want notifications',
      'Click the gear icon (Edit Channel) → Integrations → Webhooks',
      'Create a new webhook and copy the URL',
      'Paste the webhook URL above',
    ],
  },

  msteams: {
    name: 'Microsoft Teams',
    icon: '👔',
    description: 'Send notifications to a Microsoft Teams channel.',
    docsUrl: 'https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://outlook.office.com/webhook/...',
        required: true,
        helpText: 'The incoming webhook URL from Teams.',
      },
    ],
    buildUrl: (values) => {
      // Teams URLs can be used directly as JSON webhooks
      return `jsons://${values.webhookUrl.replace(/^https?:\/\//, '')}`;
    },
    helpSteps: [
      'In Teams, go to the channel where you want notifications',
      'Click the ... menu → Connectors',
      'Find "Incoming Webhook" and click Configure',
      'Give it a name, upload an icon if desired, and click Create',
      'Copy the webhook URL and paste it above',
    ],
  },

  email: {
    name: 'Email (SMTP)',
    icon: '📧',
    description: 'Send notifications via email using SMTP.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_email',
    fields: [
      {
        name: 'preset',
        label: 'Email Provider',
        type: 'select',
        options: [
          { value: 'custom', label: 'Custom SMTP' },
          { value: 'gmail', label: 'Gmail' },
          { value: 'outlook', label: 'Outlook / Office 365' },
          { value: 'yahoo', label: 'Yahoo Mail' },
        ],
        defaultValue: 'custom',
      },
      {
        name: 'smtpServer',
        label: 'SMTP Server',
        type: 'text',
        placeholder: 'smtp.gmail.com',
        required: true,
        helpText: 'Your email provider\'s SMTP server.',
      },
      {
        name: 'smtpPort',
        label: 'SMTP Port',
        type: 'select',
        options: [
          { value: '587', label: '587 (STARTTLS - recommended)' },
          { value: '465', label: '465 (SSL/TLS)' },
          { value: '25', label: '25 (Unencrypted - not recommended)' },
        ],
        defaultValue: '587',
      },
      {
        name: 'username',
        label: 'Username / Email',
        type: 'text',
        placeholder: 'you@gmail.com',
        required: true,
        helpText: 'Your email address or username.',
      },
      {
        name: 'password',
        label: 'Password / App Password',
        type: 'password',
        required: true,
        helpText: 'For Gmail, use an App Password (not your regular password).',
      },
      {
        name: 'fromAddress',
        label: 'From Address',
        type: 'text',
        placeholder: 'borgmatic@yourdomain.com',
        helpText: 'The sender address. Defaults to your username.',
      },
      {
        name: 'toAddress',
        label: 'To Address',
        type: 'text',
        placeholder: 'admin@company.com',
        required: true,
        helpText: 'The recipient email address.',
      },
    ],
    buildUrl: (values) => {
      const protocol = values.smtpPort === '465' ? 'mailtos' : 'mailto';
      const from = values.fromAddress || values.username;
      
      let url = `${protocol}://${encodeURIComponent(values.username)}:${encodeURIComponent(values.password)}@${values.smtpServer}:${values.smtpPort}`;
      url += `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(values.toAddress)}`;
      
      return url;
    },
    parseUrl: (url) => {
      // mailto://user:pass@server:port?from=x&to=y or mailtos://...
      const match = url.match(/^(mailtos?):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\?(.*)$/);
      if (match) {
        const params = new URLSearchParams(match[6]);
        return {
          username: decodeURIComponent(match[2]),
          password: decodeURIComponent(match[3]),
          smtpServer: match[4],
          smtpPort: match[5],
          fromAddress: params.get('from') ? decodeURIComponent(params.get('from')!) : '',
          toAddress: params.get('to') ? decodeURIComponent(params.get('to')!) : '',
          preset: 'custom',
        };
      }
      return {};
    },
    helpSteps: [
      'For Gmail: Enable 2FA and create an App Password at myaccount.google.com',
      'For Outlook: Use smtp.office365.com with your email and password',
      'Use port 587 with STARTTLS for most providers',
    ],
  },

  telegram: {
    name: 'Telegram',
    icon: '✈️',
    description: 'Send notifications via a Telegram bot.',
    docsUrl: 'https://core.telegram.org/bots#6-botfather',
    fields: [
      {
        name: 'botToken',
        label: 'Bot Token',
        type: 'password',
        placeholder: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
        required: true,
        helpText: 'Get this from @BotFather when you create your bot.',
      },
      {
        name: 'chatId',
        label: 'Chat ID',
        type: 'text',
        placeholder: '12345678 or @channelname',
        required: true,
        helpText: 'Your personal chat ID or a channel/group ID.',
      },
    ],
    buildUrl: (values) => {
      return `tgram://${values.botToken}/${values.chatId}`;
    },
    parseUrl: (url) => {
      // tgram://botToken/chatId
      const match = url.match(/^tgram:\/\/([^/]+)\/(.+)$/);
      if (match) {
        return {
          botToken: match[1],
          chatId: match[2],
        };
      }
      return {};
    },
    helpSteps: [
      'Open Telegram and search for @BotFather',
      'Send /newbot and follow the prompts to create a bot',
      'Copy the bot token provided',
      'To get your chat ID, message @userinfobot or your bot',
    ],
  },

  gotify: {
    name: 'Gotify',
    icon: '🔔',
    description: 'Self-hosted push notification server.',
    docsUrl: 'https://gotify.net/docs/',
    fields: [
      {
        name: 'host',
        label: 'Server URL',
        type: 'text',
        placeholder: 'gotify.yourdomain.com',
        required: true,
        helpText: 'Your Gotify server hostname.',
      },
      {
        name: 'token',
        label: 'Application Token',
        type: 'password',
        required: true,
        helpText: 'Create an application in Gotify and copy its token.',
      },
      {
        name: 'useHttps',
        label: 'Use HTTPS',
        type: 'checkbox',
        defaultValue: true,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'number',
        placeholder: '5',
        defaultValue: 5,
        helpText: 'Priority level (0-10, higher = more important).',
      },
    ],
    buildUrl: (values) => {
      const protocol = values.useHttps ? 'gotifys' : 'gotify';
      let url = `${protocol}://${values.host}/${values.token}`;
      if (values.priority) url += `?priority=${values.priority}`;
      return url;
    },
  },

  pushover: {
    name: 'Pushover',
    icon: '📲',
    description: 'Push notifications for Android and iOS.',
    docsUrl: 'https://pushover.net/api',
    fields: [
      {
        name: 'userKey',
        label: 'User Key',
        type: 'password',
        required: true,
        helpText: 'Your Pushover user key (from the dashboard).',
      },
      {
        name: 'apiToken',
        label: 'API Token',
        type: 'password',
        required: true,
        helpText: 'Create an application at pushover.net to get this.',
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { value: '', label: 'Normal' },
          { value: '-2', label: 'Lowest (no notification)' },
          { value: '-1', label: 'Low (quiet)' },
          { value: '1', label: 'High' },
          { value: '2', label: 'Emergency (requires acknowledgment)' },
        ],
      },
      {
        name: 'sound',
        label: 'Sound',
        type: 'select',
        options: [
          { value: '', label: 'Default' },
          { value: 'pushover', label: 'Pushover' },
          { value: 'bike', label: 'Bike' },
          { value: 'bugle', label: 'Bugle' },
          { value: 'cashregister', label: 'Cash Register' },
          { value: 'classical', label: 'Classical' },
          { value: 'cosmic', label: 'Cosmic' },
          { value: 'falling', label: 'Falling' },
          { value: 'gamelan', label: 'Gamelan' },
          { value: 'incoming', label: 'Incoming' },
          { value: 'intermission', label: 'Intermission' },
          { value: 'magic', label: 'Magic' },
          { value: 'mechanical', label: 'Mechanical' },
          { value: 'pianobar', label: 'Piano Bar' },
          { value: 'siren', label: 'Siren' },
          { value: 'spacealarm', label: 'Space Alarm' },
          { value: 'tugboat', label: 'Tugboat' },
          { value: 'alien', label: 'Alien' },
          { value: 'climb', label: 'Climb' },
          { value: 'persistent', label: 'Persistent' },
          { value: 'echo', label: 'Echo' },
          { value: 'updown', label: 'Up Down' },
          { value: 'vibrate', label: 'Vibrate' },
          { value: 'none', label: 'None (silent)' },
        ],
      },
    ],
    buildUrl: (values) => {
      let url = `pover://${values.userKey}@${values.apiToken}`;
      const params = [];
      if (values.priority) params.push(`priority=${values.priority}`);
      if (values.sound) params.push(`sound=${values.sound}`);
      if (params.length > 0) url += `?${params.join('&')}`;
      return url;
    },
  },

  webhook: {
    name: 'Webhook (JSON)',
    icon: '🔗',
    description: 'Send JSON payloads to any HTTP endpoint.',
    fields: [
      {
        name: 'url',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://example.com/webhook',
        required: true,
        helpText: 'The URL to POST notifications to.',
      },
      {
        name: 'method',
        label: 'HTTP Method',
        type: 'select',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'GET', label: 'GET' },
          { value: 'PUT', label: 'PUT' },
        ],
        defaultValue: 'POST',
      },
    ],
    buildUrl: (values) => {
      const prefix = values.url.startsWith('https') ? 'jsons://' : 'json://';
      return values.url.replace(/^https?:\/\//, prefix);
    },
  },

  pushbullet: {
    name: 'Pushbullet',
    icon: '🔫',
    description: 'Push notifications across all your devices.',
    docsUrl: 'https://www.pushbullet.com/#settings/account',
    fields: [
      {
        name: 'accessToken',
        label: 'Access Token',
        type: 'password',
        required: true,
        helpText: 'Get this from Settings → Account in Pushbullet.',
      },
      {
        name: 'device',
        label: 'Device (optional)',
        type: 'text',
        placeholder: 'device_iden',
        helpText: 'Target a specific device. Leave empty for all devices.',
      },
    ],
    buildUrl: (values) => {
      let url = `pbul://${values.accessToken}`;
      if (values.device) url += `/${values.device}`;
      return url;
    },
  },

  mattermost: {
    name: 'Mattermost',
    icon: '💭',
    description: 'Self-hosted team communication.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_mattermost',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://mattermost.company.com/hooks/xxx...',
        required: true,
        helpText: 'Create an incoming webhook in Mattermost integrations.',
      },
      {
        name: 'channel',
        label: 'Channel',
        type: 'text',
        placeholder: 'town-square',
        helpText: 'Channel to post to (without #).',
      },
      {
        name: 'username',
        label: 'Bot Username',
        type: 'text',
        placeholder: 'Borgmatic',
        defaultValue: 'Borgmatic',
      },
    ],
    buildUrl: (values) => {
      // Extract host and key from URL
      const match = values.webhookUrl.match(/https?:\/\/([^/]+)\/hooks\/(.+)/);
      if (match) {
        let url = `mmost://${match[1]}/${match[2]}`;
        const params = [];
        if (values.channel) params.push(`channel=${encodeURIComponent(values.channel)}`);
        if (values.username) params.push(`user=${encodeURIComponent(values.username)}`);
        if (params.length > 0) url += `?${params.join('&')}`;
        return url;
      }
      return values.webhookUrl;
    },
    helpSteps: [
      'Go to Main Menu → Integrations → Incoming Webhooks',
      'Click Add Incoming Webhook',
      'Select a channel and give it a name',
      'Copy the webhook URL',
    ],
  },

  matrix: {
    name: 'Matrix',
    icon: '🔷',
    description: 'Open, federated chat network.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_matrix',
    fields: [
      {
        name: 'homeserver',
        label: 'Homeserver',
        type: 'text',
        placeholder: 'matrix.org',
        required: true,
        helpText: 'Your Matrix homeserver.',
      },
      {
        name: 'user',
        label: 'User ID',
        type: 'text',
        placeholder: '@user:matrix.org',
        required: true,
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        required: true,
      },
      {
        name: 'room',
        label: 'Room ID',
        type: 'text',
        placeholder: '!roomid:matrix.org or #room:matrix.org',
        required: true,
        helpText: 'Room ID or alias to send messages to.',
      },
    ],
    buildUrl: (values) => {
      const userParts = values.user.replace('@', '').split(':');
      return `matrix://${encodeURIComponent(userParts[0])}:${encodeURIComponent(values.password)}@${values.homeserver}/${encodeURIComponent(values.room)}`;
    },
  },

  rocketchat: {
    name: 'Rocket.Chat',
    icon: '🚀',
    description: 'Open source team chat.',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://chat.company.com/hooks/...',
        required: true,
      },
      {
        name: 'channel',
        label: 'Channel',
        type: 'text',
        placeholder: '#general',
      },
    ],
    buildUrl: (values) => {
      const match = values.webhookUrl.match(/https?:\/\/([^/]+)\/hooks\/(.+)/);
      if (match) {
        let url = `rocket://${match[1]}/${match[2]}`;
        if (values.channel) url += `?channel=${encodeURIComponent(values.channel)}`;
        return url;
      }
      return values.webhookUrl;
    },
  },

  zulip: {
    name: 'Zulip',
    icon: '💧',
    description: 'Threaded group chat for teams.',
    fields: [
      {
        name: 'domain',
        label: 'Domain',
        type: 'text',
        placeholder: 'yourorg.zulipchat.com',
        required: true,
      },
      {
        name: 'botEmail',
        label: 'Bot Email',
        type: 'text',
        placeholder: 'bot@yourorg.zulipchat.com',
        required: true,
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
      },
      {
        name: 'stream',
        label: 'Stream',
        type: 'text',
        placeholder: 'general',
        required: true,
      },
      {
        name: 'topic',
        label: 'Topic',
        type: 'text',
        placeholder: 'backups',
        defaultValue: 'backups',
      },
    ],
    buildUrl: (values) => {
      return `zulip://${encodeURIComponent(values.botEmail)}/${values.apiKey}@${values.domain}/${encodeURIComponent(values.stream)}/${encodeURIComponent(values.topic || 'notification')}`;
    },
  },
  // Generic / Other Service
  generic: {
    name: 'Other Service (Apprise URL)',
    icon: '🔧',
    description: 'Enter any Apprise URL directly for services not listed.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/',
    fields: [
      {
        name: 'url',
        label: 'Apprise URL',
        type: 'text',
        placeholder: 'service://credentials@host/target',
        required: true,
        helpText: 'Enter the full Apprise URL. See documentation for format.',
      },
    ],
    buildUrl: (values) => values.url,
    helpSteps: [
      'Find your service in the Apprise Wiki (link above)',
      'Copy the URL format example',
      'Replace the placeholders with your credentials',
      'Paste the complete URL above',
    ],
  },

  // Signal (via signal-cli REST API)
  signal: {
    name: 'Signal',
    icon: '📶',
    description: 'Secure messaging via Signal-CLI REST API.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_signal',
    fields: [
      {
        name: 'host',
        label: 'Signal-CLI API Host',
        type: 'text',
        placeholder: 'localhost:8080',
        required: true,
        helpText: 'Host and port where signal-cli-rest-api is running.',
      },
      {
        name: 'fromNumber',
        label: 'From Number',
        type: 'text',
        placeholder: '+11234567890',
        required: true,
        helpText: 'Your registered Signal phone number.',
      },
      {
        name: 'toNumber',
        label: 'To Number(s)',
        type: 'text',
        placeholder: '+19876543210',
        required: true,
        helpText: 'Recipient phone number(s). Separate multiple with commas.',
      },
      {
        name: 'useHttps',
        label: 'Use HTTPS',
        type: 'checkbox',
        defaultValue: false,
      },
    ],
    buildUrl: (values) => {
      const protocol = values.useHttps ? 'signals' : 'signal';
      const to = values.toNumber.replace(/\s/g, '').split(',').join('/');
      return `${protocol}://${values.host}/${values.fromNumber}/${to}`;
    },
    helpSteps: [
      'Install and configure signal-cli-rest-api',
      'Register your phone number with Signal',
      'Enter the API host (e.g., localhost:8080)',
      'Example URL: signal://localhost:8080/+1234567890/+0987654321',
    ],
  },

  // Google Chat
  googlechat: {
    name: 'Google Chat',
    icon: '💚',
    description: 'Send notifications to Google Chat spaces.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_googlechat',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://chat.googleapis.com/v1/spaces/SPACE/messages?key=KEY&token=TOKEN',
        required: true,
        helpText: 'The webhook URL from Google Chat space settings.',
      },
    ],
    buildUrl: (values) => {
      // Extract parts from the Google Chat webhook URL
      const match = values.webhookUrl.match(/spaces\/([^/]+)\/messages\?key=([^&]+)&token=(.+)/);
      if (match) {
        return `gchat://${match[1]}/${match[2]}/${match[3]}`;
      }
      return values.webhookUrl;
    },
    helpSteps: [
      'Open Google Chat and go to the space where you want notifications',
      'Click the space name → Manage webhooks',
      'Create a new webhook and copy the URL',
      'Example URL: gchat://SPACE_ID/KEY/TOKEN',
    ],
  },

  // Form webhook
  form: {
    name: 'Webhook (Form Data)',
    icon: '📝',
    description: 'Send form-encoded data to any HTTP endpoint.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_Custom_Form',
    fields: [
      {
        name: 'url',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://example.com/webhook',
        required: true,
      },
      {
        name: 'method',
        label: 'HTTP Method',
        type: 'select',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'GET', label: 'GET' },
          { value: 'PUT', label: 'PUT' },
        ],
        defaultValue: 'POST',
      },
    ],
    buildUrl: (values) => {
      const prefix = values.url.startsWith('https') ? 'forms://' : 'form://';
      return values.url.replace(/^https?:\/\//, prefix);
    },
  },

  // Home Assistant
  homeassistant: {
    name: 'Home Assistant',
    icon: '🏠',
    description: 'Send notifications to Home Assistant.',
    docsUrl: 'https://github.com/caronc/apprise/wiki/Notify_homeassistant',
    fields: [
      {
        name: 'host',
        label: 'Home Assistant Host',
        type: 'text',
        placeholder: 'homeassistant.local:8123',
        required: true,
      },
      {
        name: 'accessToken',
        label: 'Long-Lived Access Token',
        type: 'password',
        required: true,
        helpText: 'Create in User Profile → Long-Lived Access Tokens.',
      },
      {
        name: 'useHttps',
        label: 'Use HTTPS',
        type: 'checkbox',
        defaultValue: false,
      },
    ],
    buildUrl: (values) => {
      const protocol = values.useHttps ? 'hassios' : 'hassio';
      return `${protocol}://${values.accessToken}@${values.host}`;
    },
  },
};

// Example URLs for services with simple fallback forms
const SERVICE_EXAMPLES: Record<string, { example: string; format: string }> = {
  ifttt: { 
    example: 'ifttt://WebHookID@EventToTrigger', 
    format: 'ifttt://WEBHOOK_ID@EVENT_NAME' 
  },
  join: { 
    example: 'join://apikey/device', 
    format: 'join://API_KEY/DEVICE_ID' 
  },
  simplepush: { 
    example: 'spush://apikey', 
    format: 'spush://API_KEY' 
  },
  prowl: { 
    example: 'prowl://apikey', 
    format: 'prowl://API_KEY' 
  },
  twilio: { 
    example: 'twilio://AccountSid:AuthToken@FromPhoneNo/ToPhoneNo', 
    format: 'twilio://SID:TOKEN@+FROM/+TO' 
  },
  clicksend: { 
    example: 'clicksend://user:password@ToPhoneNo', 
    format: 'clicksend://USER:PASS@+PHONE' 
  },
  kavenegar: { 
    example: 'kavenegar://ApiKey/ToPhoneNo', 
    format: 'kavenegar://API_KEY/+PHONE' 
  },
  messagebird: { 
    example: 'msgbird://ApiKey/FromPhoneNo/ToPhoneNo', 
    format: 'msgbird://API_KEY/+FROM/+TO' 
  },
  syslog: { 
    example: 'syslog://hostname', 
    format: 'syslog://HOST or rsyslog://HOST:PORT' 
  },
  notica: { 
    example: 'notica://token', 
    format: 'notica://TOKEN' 
  },
  dbus: { 
    example: 'dbus://', 
    format: 'dbus:// (no configuration needed)' 
  },
  windows: { 
    example: 'windows://', 
    format: 'windows:// (no configuration needed)' 
  },
  macosx: { 
    example: 'macosx://', 
    format: 'macosx:// (no configuration needed)' 
  },
  opsgenie: { 
    example: 'opsgenie://APIKey', 
    format: 'opsgenie://API_KEY' 
  },
  pagerduty: { 
    example: 'pagerduty://IntegrationKey@ApiKey', 
    format: 'pagerduty://INTEGRATION_KEY@API_KEY' 
  },
};

// Add fallback for unimplemented services
const getServiceConfig = (serviceId: string): ServiceConfig => {
  if (SERVICE_CONFIGS[serviceId]) {
    return SERVICE_CONFIGS[serviceId];
  }
  
  const example = SERVICE_EXAMPLES[serviceId];
  const serviceName = serviceId.charAt(0).toUpperCase() + serviceId.slice(1);
  
  // Fallback for services not yet fully implemented
  return {
    name: serviceName,
    icon: '🔔',
    description: `Configure ${serviceName} notifications.`,
    docsUrl: `https://github.com/caronc/apprise/wiki/Notify_${serviceId}`,
    fields: [
      {
        name: 'url',
        label: 'Apprise URL',
        type: 'text',
        placeholder: example?.example || `${serviceId}://...`,
        required: true,
        helpText: example 
          ? `Format: ${example.format}` 
          : 'Enter the full Apprise URL for this service.',
      },
    ],
    buildUrl: (values) => values.url,
    helpSteps: example ? [
      `URL Format: ${example.format}`,
      `Example: ${example.example}`,
      'See Apprise documentation for full details',
    ] : undefined,
  };
};

const NotificationServiceForm: React.FC<NotificationServiceFormProps> = ({
  service,
  onSubmit,
  onCancel,
  onTest,
  isTesting,
  initialUrl,
}) => {
  const config = getServiceConfig(service);
  const [values, setValues] = useState<Record<string, any>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string>('');

  // Track if we're editing
  const isEditing = !!initialUrl;

  // Initialize form with default values or parsed values from initialUrl
  useEffect(() => {
    const defaults: Record<string, any> = {};
    config.fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    });
    
    // If editing and we have a parseUrl function, try to extract values from the URL
    if (initialUrl && config.parseUrl) {
      const parsed = config.parseUrl(initialUrl);
      setValues({ ...defaults, ...parsed });
    } else {
      setValues(defaults);
    }
    setTestResult(null);
  }, [service, initialUrl]);

  // Update preset values for email
  useEffect(() => {
    if (service === 'email' && values.preset) {
      const presets: Record<string, { smtpServer: string; smtpPort: string }> = {
        gmail: { smtpServer: 'smtp.gmail.com', smtpPort: '587' },
        outlook: { smtpServer: 'smtp.office365.com', smtpPort: '587' },
        yahoo: { smtpServer: 'smtp.mail.yahoo.com', smtpPort: '587' },
      };
      if (presets[values.preset]) {
        setValues(prev => ({
          ...prev,
          ...presets[values.preset],
        }));
      }
    }
  }, [values.preset, service]);

  // Generate URL whenever values change
  useEffect(() => {
    try {
      const url = config.buildUrl(values);
      setGeneratedUrl(url);
    } catch (e) {
      setGeneratedUrl('');
    }
  }, [values, config]);

  const handleChange = (name: string, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!generatedUrl) return;
    
    try {
      const success = await onTest(generatedUrl);
      setTestResult(success ? 'success' : 'error');
    } catch {
      setTestResult('error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (generatedUrl) {
      onSubmit(generatedUrl, config.name);
    }
  };

  const isValid = () => {
    return config.fields
      .filter(f => f.required)
      .every(f => values[f.name] && String(values[f.name]).trim() !== '');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Service Header */}
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-200">
        <span className="text-4xl">{config.icon}</span>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{config.name}</h3>
          <p className="text-sm text-gray-600">{config.description}</p>
          {config.docsUrl && (
            <a
              href={config.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center mt-1"
            >
              View documentation <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          )}
        </div>
      </div>

      {/* Editing indicator */}
      {isEditing && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">
            <span className="font-medium">Editing existing destination.</span> Fill in the new configuration below. The old destination will be replaced.
          </p>
          <p className="text-xs text-amber-600 mt-1 font-mono break-all">{initialUrl}</p>
        </div>
      )}

      {/* Help Steps */}
      {config.helpSteps && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900 text-sm">Setup Steps:</p>
              <ol className="mt-2 text-sm text-blue-800 space-y-1">
                {config.helpSteps.map((step, i) => (
                  <li key={i}>{i + 1}. {step}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-4">
        {config.fields.map(field => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {field.type === 'select' ? (
              <select
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={values[field.name] || false}
                  onChange={(e) => handleChange(field.name, e.target.checked)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-600">{field.helpText}</span>
              </label>
            ) : field.type === 'password' ? (
              <div className="relative">
                <input
                  type={showPasswords[field.name] ? 'text' : 'password'}
                  value={values[field.name] || ''}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, [field.name]: !prev[field.name] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPasswords[field.name] ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            ) : (
              <input
                type={field.type}
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            )}

            {field.helpText && field.type !== 'checkbox' && (
              <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
          </div>
        ))}
      </div>

      {/* Generated URL Preview (collapsible) */}
      {generatedUrl && (
        <details className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <summary className="text-sm font-medium text-gray-700 cursor-pointer">
            Generated Apprise URL (advanced)
          </summary>
          <code className="mt-2 block text-xs text-gray-600 break-all bg-gray-100 p-2 rounded">
            {generatedUrl}
          </code>
        </details>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`p-3 rounded-lg flex items-center space-x-2 ${
          testResult === 'success' 
            ? 'bg-green-50 border border-green-200' 
            : 'bg-red-50 border border-red-200'
        }`}>
          {testResult === 'success' ? (
            <>
              <Check className="w-5 h-5 text-green-600" />
              <span className="text-sm text-green-800">Test notification sent successfully!</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="text-sm text-red-800">Failed to send test notification. Check your settings.</span>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={handleTest}
          disabled={!isValid() || isTesting}
          className="btn-secondary flex items-center space-x-2"
        >
          {isTesting ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>{isTesting ? 'Sending...' : 'Send Test'}</span>
        </button>

        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid()}
            className="btn-primary flex items-center space-x-2"
          >
            <Check className="w-4 h-4" />
            <span>{isEditing ? 'Update Destination' : 'Save Destination'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};

export default NotificationServiceForm;

