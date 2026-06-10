import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Remote client selection state (for Director mode)
let selectedClientId: string | null = null

/**
 * Set the selected client ID for remote API calls
 * Called by DirectorContext when selectedClient changes
 */
export function setRemoteClientId(clientId: string | null) {
  selectedClientId = clientId
}

/**
 * Get the currently selected remote client ID
 */
export function getRemoteClientId(): string | null {
  return selectedClientId
}

/**
 * Paths that should never be proxied to remote clients
 * These always execute on the local Director, even in remote session mode
 */
const EXCLUDED_PATHS = [
  '/auth/',           // Authentication
  '/identity/',       // Identity/mode management  
  '/director/',       // Director operations
  '/system-config/',  // System configuration
  '/events/',         // SSE event stream
]

// Request interceptor to add auth token and remote client header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // Add X-Remote-Client-ID header if a client is selected (Director mode)
  // BUT exclude paths that should always execute locally
  if (selectedClientId && config.url) {
    const shouldExclude = EXCLUDED_PATHS.some(path => config.url?.includes(path))
    if (!shouldExclude) {
      config.headers['X-Remote-Client-ID'] = selectedClientId
      console.log(`🔀 Proxying to remote client: ${config.method?.toUpperCase()} ${config.url}`)
    } else {
      console.log(`⏭️  Local request (excluded from proxy): ${config.method?.toUpperCase()} ${config.url}`)
    }
  }

  return config
})

// Heartbeat interval to keep session alive (every 5 minutes)
let heartbeatInterval: ReturnType<typeof setInterval> | null = null

/**
 * Start the heartbeat to keep the session alive
 * Called after successful login
 */
export function startHeartbeat() {
  stopHeartbeat() // Clear any existing interval

  // Heartbeat every 5 minutes to refresh the token
  heartbeatInterval = setInterval(async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      stopHeartbeat()
      return
    }

    try {
      const response = await api.post('/auth/heartbeat')
      if (response.data?.access_token) {
        // Update stored token with the refreshed one
        localStorage.setItem('access_token', response.data.access_token)
        console.log('🔄 Token refreshed via heartbeat')
      }
    } catch (error) {
      console.warn('⚠️ Heartbeat failed:', error)
      // Don't stop heartbeat on failure - will retry
    }
  }, 5 * 60 * 1000) // 5 minutes

  console.log('💓 Session heartbeat started')
}

/**
 * Stop the heartbeat interval
 * Called on logout
 */
export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
    console.log('💔 Session heartbeat stopped')
  }
}

// Track last network error toast to avoid spam
let lastNetworkErrorToast: number = 0
const NETWORK_ERROR_TOAST_COOLDOWN = 10000 // 10 seconds between toasts

// Function to show network error toast (imported lazily to avoid circular deps)
const showNetworkErrorToast = () => {
  const now = Date.now()
  if (now - lastNetworkErrorToast < NETWORK_ERROR_TOAST_COOLDOWN) {
    return // Don't show toast if we showed one recently
  }
  lastNetworkErrorToast = now

  // Use a custom event to trigger toast from App component
  // This avoids importing toast here which could cause circular dependencies
  window.dispatchEvent(new CustomEvent('network-error', {
    detail: { message: 'Server is unreachable. Please check if the backend is running.' }
  }))
}

// Response interceptor to handle auth errors and network errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle network errors (server unreachable)
    if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
      console.error('🔴 Network Error: Server is unreachable')
      showNetworkErrorToast()
      return Promise.reject(error)
    }

    if (error.response?.status === 401) {
      const url = error.config?.url || ''
      console.error(`❌ 401 Unauthorized: ${error.config?.method?.toUpperCase()} ${url}`)

      // Don't redirect for login endpoint errors - let the login component handle them
      if (url.includes('/auth/login')) {
        return Promise.reject(error)
      }

      // Check if this is actually an authentication error (token invalid/expired)
      // vs. a 401 for other reasons (like trying to access another user's resource)
      const errorDetail = error.response?.data?.detail || error.response?.data?.error || ''
      const isAuthError =
        errorDetail.toLowerCase().includes('token') ||
        errorDetail.toLowerCase().includes('credential') ||
        errorDetail.toLowerCase().includes('authentication') ||
        errorDetail.toLowerCase().includes('expired') ||
        errorDetail === 'No token provided'

      if (isAuthError) {
        console.log('🚪 Token invalid/expired - removing token and redirecting to login')
        stopHeartbeat()
        localStorage.removeItem('access_token')
        // Only redirect if not already on login page
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      } else {
        console.warn('⚠️ 401 but not a token error, not redirecting:', errorDetail)
      }
    }
    return Promise.reject(error)
  }
)

export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),

  getSetupStatus: () => api.get('/auth/setup-status'),

  setupAdmin: (password: string, confirm_password: string) =>
    api.post('/auth/setup-admin', { password, confirm_password }),

  logout: () => api.post('/auth/logout'),

  refresh: () => api.post('/auth/refresh'),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),

  getProfile: () => api.get('/auth/me'),
}

export const dashboardAPI = {
  getStatus: () => api.get('/dashboard/status'),
  getMetrics: () => api.get('/dashboard/metrics'),
  getSchedule: () => api.get('/dashboard/schedule'),
  // Deprecated: prefer downloadVaultMasterKey() instead of fetching the key into the UI.
  getSecretKey: () => api.get('/dashboard/secret-key'),
  downloadVaultMasterKey: () =>
    api.get('/dashboard/vault-master-key', {
      params: { confirm: 'DOWNLOAD_MASTER_KEY' },
      responseType: 'blob',
    }),
  getToolsHealth: () => api.get('/dashboard/tools-health'),
  getVaultHealth: () => api.get('/dashboard/vault-health'),
  getHealth: () => api.get('/health'),
  resetVault: () => api.post('/dashboard/vault-reset', { confirm: 'RESET_VAULT' }),
  downloadConfigZip: () => api.get('/dashboard/download-config-zip', { responseType: 'blob' }),
  importConfigZip: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/dashboard/import-config-zip', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
}

export const identityAPI = {
  getMode: () => api.get('/identity/mode'), // Public - for login page
  getStatus: () => api.get('/identity/status'),
  setMode: (mode: string) => api.post('/identity/set-mode', { mode }),
  switchMode: (newMode: string, confirmation: string) => api.post('/identity/switch-mode', { new_mode: newMode, confirmation }),
  toggleStandalone: () => api.post('/identity/toggle-standalone'),
  updateDirectorPort: (port: number) => api.put('/identity/director-port', { port }),
  updateDirectorToken: (connection_token: string) => api.put('/identity/director-token', { connection_token }),
  updateClientConfig: (config: any) => api.put('/identity/client-config', config),
  updateDisplayName: (body: { client_name: string }) => api.put('/identity/display-name', body),
  regenerateKeys: () => api.post('/identity/regenerate-keys'),
  testConnection: (config?: { director_url?: string; connection_token?: string }) =>
    api.post('/identity/test-connection', config || {}),
  connect: () => api.post('/identity/connect'),
  disconnect: () => api.post('/identity/disconnect'),
  factoryReset: (confirmation: string, regenerateSecretKey: boolean = false) =>
    api.post('/identity/factory-reset', { confirmation, regenerate_secret_key: regenerateSecretKey }),
}

export const notificationsAPI = {
  getAll: (filters?: any) => api.get('/notifications', { params: filters }),
  getByClient: (limit?: number) => api.get('/notifications/by-client', { params: { limit } }),
  getClientNotifications: (clientId: string, limit?: number) => api.get(`/notifications/client/${clientId}`, { params: { limit } }),
  markAsRead: (notificationId: string) => api.post(`/notifications/${notificationId}/read`),
  markClientAsRead: (clientId: string) => api.post(`/notifications/client/${clientId}/read-all`),
  getStats: () => api.get('/notifications/stats'),
  cleanup: () => api.post('/notifications/cleanup'),
}

// Apprise notification service configuration
export const appriseAPI = {
  getConfig: () => api.get('/apprise/config'),
  saveConfig: (config: any) => api.post('/apprise/config', config),
  testConnection: (url: string) => api.post('/apprise/test', { url }),
  sendTest: (type: string, title?: string, body?: string) =>
    api.post('/apprise/send-test', { type, title, body }),
  addUrl: (type: string, url: string) => api.post('/apprise/urls', { type, url }),
  removeUrl: (type: string, url: string) => api.delete('/apprise/urls', { data: { type, url } }),
  setEnabled: (type: string, enabled: boolean) =>
    api.put('/apprise/enabled', { type, enabled }),
  updateSettings: (type: string, settings: any) =>
    api.put('/apprise/settings', { type, settings }),
  getServices: () => api.get('/apprise/services'),
  getHooks: () => api.get('/apprise/hooks'),
  getStatus: () => api.get('/apprise/status'),
  // API server configuration (for Apprise API mode)
  updateApiConfig: (config: { enabled: boolean; url: string; key?: string }) =>
    api.put('/apprise/api-config', config),
  testApiConnection: (url: string) => api.post('/apprise/test-api', { url }),
}

// ntfy native notification service configuration
export const ntfyAPI = {
  getConfig: () => api.get('/ntfy/config'),
  saveConfig: (config: any) => api.post('/ntfy/config', config),
  testConnection: (config?: any) => api.post('/ntfy/test', config || {}),
  sendTest: (type: string, title?: string, message?: string) =>
    api.post('/ntfy/send-test', { type, title, message }),
  send: (title: string, message: string, priority?: string, tags?: string[]) =>
    api.post('/ntfy/send', { title, message, priority, tags }),
  getStatus: () => api.get('/ntfy/status'),
  setEnabled: (type: string, enabled: boolean) =>
    api.put('/ntfy/enabled', { type, enabled }),
  updateSettings: (type: string, settings: any) =>
    api.put('/ntfy/settings', { type, settings }),
  getPriorities: () => api.get('/ntfy/priorities'),
}

// Notification routing configuration (for client mode routing decisions)
export const notificationRoutingAPI = {
  getConfig: () => api.get('/notification-routing/config'),
  saveConfig: (config: any) => api.post('/notification-routing/config', config),
  getStatus: () => api.get('/notification-routing/status'),
  test: (eventType: string, title?: string, message?: string) =>
    api.post('/notification-routing/test', { event_type: eventType, title, message }),
  setProvider: (provider: 'apprise' | 'ntfy') =>
    api.put('/notification-routing/provider', { provider }),
  setRouting: (routing: 'director_only' | 'local_only' | 'both') =>
    api.put('/notification-routing/routing', { routing }),
  setLocalEvents: (events: string[]) =>
    api.put('/notification-routing/local-events', { events }),
  setDirectorEvents: (events: string[]) =>
    api.put('/notification-routing/director-events', { events }),
  getEventTypes: () => api.get('/notification-routing/event-types'),
}

// Director notification forwarding configuration
export const directorNotificationsAPI = {
  getConfig: () => api.get('/director-notifications/config'),
  saveConfig: (config: any) => api.post('/director-notifications/config', config),
  getStatus: () => api.get('/director-notifications/status'),
  setForwarding: (enabled: boolean) =>
    api.put('/director-notifications/forwarding', { enabled }),
  setProvider: (provider: 'apprise' | 'ntfy') =>
    api.put('/director-notifications/provider', { provider }),
  setEvents: (events: string[]) =>
    api.put('/director-notifications/events', { events }),
  setClientFilters: (mode: 'all' | 'include' | 'exclude', clientIds?: string[]) =>
    api.put('/director-notifications/client-filters', { mode, client_ids: clientIds }),
  getAvailableEvents: () => api.get('/director-notifications/available-events'),
  test: (eventType?: string, clientName?: string) =>
    api.post('/director-notifications/test', { event_type: eventType, client_name: clientName }),
}

export const vaultAPI = {
  getStatus: () => api.get('/vault/status'),
  initialize: (masterPassword: string, confirmPassword: string) =>
    api.post('/vault/initialize', { master_password: masterPassword, confirm_password: confirmPassword }),
  verify: (masterPassword: string) => api.post('/vault/verify', { master_password: masterPassword }),
  storePassphrase: (data: any) => api.post('/vault/store', data),
  getPassphrase: (clientId: string, repoId: string, masterPassword: string) =>
    api.post('/vault/get', { client_id: clientId, repo_id: repoId, master_password: masterPassword }),
  getClientPassphrases: (clientId: string, masterPassword: string) =>
    api.post(`/vault/client/${clientId}`, { master_password: masterPassword }),
  getClients: () => api.get('/vault/clients'),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    api.post('/vault/change-password', { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }),
  deletePassphrase: (clientId: string, repoId: string) => api.delete(`/vault/client/${clientId}/repo/${repoId}`),
  deleteClient: (clientId: string) => api.delete(`/vault/client/${clientId}`),
}

export const directorAPI = {
  getClients: () => api.get('/director/clients'),
  getClient: (clientId: string) => api.get(`/director/clients/${clientId}`),
  approveClient: (clientId: string, ipLocked: boolean) =>
    api.post(`/director/clients/${clientId}/approve`, { ip_locked: ipLocked }),
  rejectClient: (clientId: string) => api.delete(`/director/clients/${clientId}`),
  updateClient: (clientId: string, data: any) => api.put(`/director/clients/${clientId}`, data),
  getStats: () => api.get('/director/stats'),
  // New: fleet health overview (last 24h-by-default of client-pushed events).
  getFleetHealth: (hours = 24) => api.get(`/director/fleet-health?hours=${hours}`),
  // New: per-client backup-event log (drives Clients-page detail panel).
  getClientEvents: (clientId: string, limit = 25) =>
    api.get(`/director/clients/${clientId}/events?limit=${limit}`),
  // New: rotate this single client's per-client connection token (locks it out until
  // the new token is pasted on its side).
  rotateClientToken: (clientId: string) =>
    api.post(`/director/clients/${clientId}/rotate-token`),
}

export const templatesAPI = {
  // Generic template methods
  getAll: () => api.get('/templates'),
  getByType: (type: string) => api.get(`/templates/${type}`),
  getTemplate: (type: string, templateId: string) => api.get(`/templates/${type}/${templateId}`),
  create: (type: string, data: any) => api.post(`/templates/${type}`, data),
  update: (type: string, templateId: string, data: any) => api.put(`/templates/${type}/${templateId}`, data),
  delete: (type: string, templateId: string) => api.delete(`/templates/${type}/${templateId}`),
  clone: (type: string, data: any) => api.post(`/templates/${type}/clone`, data),

  // Convenience methods for backup templates (most common use case)
  getTemplates: () => api.get('/templates'),
  createTemplate: (data: any) => api.post('/templates/backup', data),
  updateTemplate: (templateId: string, data: any) => api.put(`/templates/backup/${templateId}`, data),
  deleteTemplate: (templateId: string) => api.delete(`/templates/backup/${templateId}`),

  // Infinity Tools template activation
  getInfinityToolsStatus: () => api.get('/templates/infinity-tools/status'),
  activateInfinityTools: (data?: any) => api.post('/templates/infinity-tools/activate', data),
  deactivateInfinityTools: () => api.delete('/templates/infinity-tools'),

  // Canary file (ransomware protection)
  getCanaryStatus: () => api.get('/templates/canary-status'),
  resetCanary: () => api.post('/templates/canary-reset'),

  // Import template from file
  importTemplate: (formData: FormData) => api.post('/templates/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
}

export const deploymentsAPI = {
  getAll: (params?: any) => api.get('/deployments', { params }),
  getDeployment: (deploymentId: string) => api.get(`/deployments/${deploymentId}`),
  deploy: (data: any) => api.post('/deployments/deploy', data),
  delete: (deploymentId: string) => api.delete(`/deployments/${deploymentId}`),
  getStats: () => api.get('/deployments/stats/summary'),
  getByClient: (clientId: string) => api.get(`/deployments?client_id=${clientId}`),
  getByTemplate: (templateId: string) => api.get(`/deployments?template_id=${templateId}`),
}

export const systemConfigAPI = {
  getConfig: () => api.get('/system-config'),
  updateConfig: (updates: any) => api.put('/system-config', { updates }),
  configureDomain: (domain: string, additionalDomains?: string[]) =>
    api.post('/system-config/domain', { domain, additional_domains: additionalDomains }),
  getCertificate: () => api.get('/system-config/certificate'),
  regenerateCertificate: () => api.post('/system-config/certificate/regenerate'),
  getSshfsStatus: (refresh = false) =>
    api.get('/system-config/sshfs-status', refresh ? { params: { refresh: 1 } } : undefined),
}

export const configAPI = {
  getConfig: () => api.get('/config/current'),
  updateConfig: (config: string) => api.put('/config/update', { content: config }),
  validateConfig: (config: string) => api.post('/config/validate', { content: config }),
  getBackups: () => api.get('/config/backups'),
  restoreBackup: (backupName: string) => api.post('/config/restore', { backupName }),
}

export const backupAPI = {
  startBackup: (repository?: string) => api.post('/backup/start', { repository }),
  getStatus: (jobId: string) => api.get(`/backup/status/${jobId}`),
  getAllJobs: () => api.get('/backup/jobs'),
  cancelJob: (jobId: string) => api.post(`/backup/cancel/${jobId}`),
  getLogs: (jobId: string) => api.get(`/backup/logs/${jobId}`),
}

export const archivesAPI = {
  listArchives: (repository: string) => {
    const encodedRepo = encodeURIComponent(repository);
    const url = `/archives/${encodedRepo}`;
    console.log(`🌐 [API] listArchives called with: "${repository}"`);
    console.log(`🌐 [API] Encoded to: "${encodedRepo}"`);
    console.log(`🌐 [API] Final URL: "${url}"`);
    return api.get(url);
  },
  getArchiveInfo: (repository: string, archive: string) =>
    api.get(`/archives/${encodeURIComponent(repository)}/${encodeURIComponent(archive)}/info`, {
      params: { _t: Date.now() }  // Cache bust to prevent 304 responses from mixing data
    }),
  listContents: (repository: string, archive: string, path?: string) =>
    api.get(`/archives/${encodeURIComponent(repository)}/${encodeURIComponent(archive)}/contents`, { params: { path } }),
  getArchiveFiles: (repository: string, archive: string) =>
    api.get(`/archives/${encodeURIComponent(repository)}/${encodeURIComponent(archive)}/files`),
  // Enhanced browsing: get contents at a specific path with optional search
  // Uses query params for repository to avoid URL encoding issues with paths containing /
  browseArchive: (repository: string, archive: string, path: string = '/', search?: string) =>
    api.get(`/archives/browse`, {
      params: { repository, archive, path, search }
    }),
  // Preview text file content
  previewFile: (repository: string, archive: string, filePath: string) =>
    api.get(`/archives/${encodeURIComponent(repository)}/${encodeURIComponent(archive)}/preview`, {
      params: { path: filePath }
    }),
  deleteArchive: (repository: string, archive: string) =>
    api.delete(`/archives/${encodeURIComponent(repository)}/${encodeURIComponent(archive)}`),
}

export const restoreAPI = {
  previewRestore: (repository: string, archive: string, paths: string[]) =>
    api.post('/restore/preview', { repository, archive, paths }),
  startRestore: (repository: string, archive: string, paths: string[], destination: string) =>
    api.post('/restore/start', { repository, archive, paths, destination }),
  downloadFile: (repository: string, archive: string, filePath: string) => {
    console.log('🌐 [API] downloadFile called with:', { repository, archive, filePath });
    return api.post('/restore/download', { repository, archive, filePath }, { responseType: 'blob' })
      .then(response => {
        console.log('🌐 [API] downloadFile response:', response);
        return response;
      })
      .catch(error => {
        console.error('🌐 [API] downloadFile error:', error);
        throw error;
      });
  },
  // Restore to specific path (Borg 2.0)
  restoreToPath: (
    repository: string,
    archive: string,
    sourcePaths: string[],
    destinationPath: string,
    preserveStructure: boolean = true
  ) => api.post('/restore/to-path', {
    repository,
    archive,
    sourcePaths,
    destinationPath,
    preserveStructure
  }),
  // Browse filesystem for destination selection
  browseFilesystem: (path: string) => api.get('/restore/browse-filesystem', { params: { path } }),
  // Create directory for restore destination
  createDirectory: (path: string, name: string) => api.post('/restore/create-directory', { path, name }),
  // Read file content from filesystem
  readFile: (path: string) => api.get('/restore/read-file', { params: { path } }),

  // Restore history
  getHistory: (repository?: string) => api.get('/restore/history', { params: repository ? { repository } : {} }),
  getArchiveHistory: (archiveName: string) => api.get(`/restore/history/${encodeURIComponent(archiveName)}`),
  recordHistory: (data: {
    archiveName: string;
    repoPath: string;
    destination: string;
    destinationType: 'local' | 'download' | 'original';
    paths?: string[];
  }) => api.post('/restore/history', data),
}



export const logsAPI = {
  getLogs: (params: {
    log_type?: string;
    lines?: number;
    search?: string;
    level?: string;
    start_time?: string;
    end_time?: string;
  }) => api.get('/logs', { params }),
  getLogTypes: () => api.get('/logs/types'),
  getLogStats: (params: { log_type?: string; hours?: number }) => api.get('/logs/stats', { params }),
  getSettings: () => api.get('/logs/settings'),
  clearLogs: (params: { log_type: string }) => api.delete('/logs/clear', { params }),
}

export const settingsAPI = {
  // System settings
  getSystemSettings: () => api.get('/settings/system'),
  updateSystemSettings: (settings: any) => api.put('/settings/system', settings),

  // User management
  getUsers: () => api.get('/settings/users'),
  createUser: (userData: any) => api.post('/settings/users', userData),
  updateUser: (userId: number, userData: any) => api.put(`/settings/users/${userId}`, userData),
  deleteUser: (userId: number) => api.delete(`/settings/users/${userId}`),
  resetUserPassword: (userId: number, newPassword: string) =>
    api.post(`/settings/users/${userId}/reset-password`, { new_password: newPassword }),

  // Profile management
  getProfile: () => api.get('/settings/profile'),
  updateProfile: (profileData: any) => api.put('/settings/profile', profileData),
  changePassword: (passwordData: any) => api.post('/settings/change-password', passwordData),

  // System maintenance
  cleanupSystem: () => api.post('/settings/system/cleanup'),
  testDumpDir: (dir: string) => api.post('/settings/system/test-dump-dir', { dir }),

  // Archive cache (Redis)
  getCacheStatus: () => api.get('/settings/cache'),
  flushCache: () => api.post('/settings/cache/flush'),
}


// Events API (Server-Sent Events)
export const eventsAPI = {
  streamEvents: () => {
    const token = localStorage.getItem('access_token');

    // In development, try to use Vite proxy first
    // If that fails, the error handler will try direct connection
    const isDev = import.meta.env.DEV;
    const url = isDev
      ? `/api/events/stream?token=${token}`  // Vite proxy
      : `${api.defaults.baseURL}/events/stream?token=${token}`; // Direct in production

    console.log('🔌 Creating SSE connection to:', url);
    return new EventSource(url);
  },
  getConnectionCount: () => api.get('/events/connections'),
  sendBackupProgress: (data: any) => api.post('/events/backup-progress', data),
  sendSystemStatus: (data: any) => api.post('/events/system-status', data),
  sendLogUpdate: (data: any) => api.post('/events/log-update', data),
}

// Repositories API
export const repositoriesAPI = {
  getRepositories: () => api.get('/repositories'),
  getRepositoriesFast: () => api.get('/repositories/list'), // Lightweight - no borg info
  createRepository: (data: any) => api.post('/repositories', data),
  getRepository: (id: number) => api.get(`/repositories/${id}`),
  updateRepository: (id: number, data: any) => api.put(`/repositories/${id}`, data),
  updateRepositoryByPath: (path: string, data: any) => api.put(`/repositories/by-path/${encodeURIComponent(path)}`, data),
  deleteRepository: (id: number) => api.delete(`/repositories/${id}`),
  deleteRepositoryByPath: (path: string, deleteOnDisk: boolean = false) =>
    api.delete(`/repositories/by-path/${encodeURIComponent(path)}${deleteOnDisk ? '?deleteOnDisk=true' : ''}`),
  toggleRepository: (id: number, is_active: boolean) => api.patch(`/repositories/${id}/toggle`, { is_active }),
  checkRepository: (id: number) => api.post(`/repositories/${id}/check`),
  compactRepository: (id: number) => api.post(`/repositories/${id}/compact`),
  pruneRepository: (path: string, options?: {
    keep_daily?: number;
    keep_weekly?: number;
    keep_monthly?: number;
    keep_yearly?: number;
    dry_run?: boolean;
  }) => api.post('/borgmatic/archive/prune', { repositoryPath: path, options }),
  getRepositoryStats: (id: number | string) => api.get(`/repositories/${id}/stats`),
  tryMount: (data: { rclone_remote: string; rclone_path?: string; mount_path: string }) =>
    api.post('/repositories/try-mount', data),
  createPersistentMount: (data: { rclone_remote: string; rclone_path?: string; mount_path: string; repository_id?: string }) =>
    api.post('/repositories/create-persistent-mount', data),
  // Remove mount by mount path (mount happens on host via RCD)
  removePersistentMount: (mountPath: string) =>
    api.delete(`/repositories/remove-persistent-mount/${encodeURIComponent(mountPath)}`),
  s3Browse: (data: { s3_endpoint?: string; s3_region?: string; s3_access_key: string; s3_secret_key: string; bucket?: string; path?: string }) =>
    api.post('/repositories/s3-browse', data),
  sshBrowse: (data: { host: string; port?: number; username: string; ssh_key_id?: number; ssh_auth_method?: string; ssh_password?: string; remote_path?: string; use_sftp?: boolean }) =>
    api.post('/repositories/ssh-browse', data),
  sshCreateFolder: (data: { host: string; port?: number; username: string; ssh_key_id?: number; ssh_auth_method?: string; ssh_password?: string; remote_path: string; use_sftp?: boolean }) =>
    api.post('/repositories/ssh-create-folder', data),

  // Passphrase management
  updatePassphrase: (repoId: string, passphrase: string, verify: boolean = true) =>
    api.post(`/repositories/${repoId}/passphrase`, { passphrase, verify }),
  getPassphraseStatus: (repoId: string) =>
    api.get(`/repositories/${repoId}/passphrase/status`),
  verifyPassphrase: (repoId: string) =>
    api.get(`/repositories/${repoId}/passphrase/verify`),

  // Break repository lock
  breakLock: (repositoryPath: string) =>
    api.post('/borgmatic/break-lock', { repositoryPath }),

  // Rclone CLI (no RCD required)
  rcloneCheck: () => api.get('/repositories/rclone-check'),
  rcloneListRemotes: () => api.get('/repositories/rclone-remotes'),
  rcloneList: (remote: string, path?: string, dirsOnly?: boolean) =>
    api.post('/repositories/rclone-list', { remote, path, dirsOnly }),
  rcloneTest: (remote: string, path?: string) =>
    api.post('/repositories/rclone-test', { remote, path }),
  rcloneMkdir: (remote: string, path: string) =>
    api.post('/repositories/rclone-mkdir', { remote, path }),
}

// SSH Keys API
export const sshKeysAPI = {
  getSSHKeys: () => api.get('/ssh-keys'),
  createSSHKey: (data: any) => api.post('/ssh-keys', data),
  generateSSHKey: (data: any) => api.post('/ssh-keys/generate', data),
  getSSHKey: (id: string | number) => api.get(`/ssh-keys/${id}`),
  updateSSHKey: (id: string | number, data: any) => api.put(`/ssh-keys/${id}`, data),
  deleteSSHKey: (id: string | number) => api.delete(`/ssh-keys/${id}`),
  testSSHConnection: (data: any) => api.post(`/ssh-keys/${data.key_id}/test-connection`, data),
}

// Schedule API
export const scheduleAPI = {
  getSchedules: () => api.get('/schedule'),
  getSchedule: (id: string) => api.get(`/schedule/${id}`),
  createSchedule: (data: any) => api.post('/schedule', data),
  updateSchedule: (id: string, data: any) => api.put(`/schedule/${id}`, data),
  deleteSchedule: (id: string) => api.delete(`/schedule/${id}`),
}

// Config Parser API
export const configParserAPI = {
  parseConfigs: () => api.get('/config-parser/parse'),
  refreshConfigs: () => api.get('/config-parser/refresh'),
  getState: () => api.get('/config-parser/state'),
  getRepositories: () => api.get('/config-parser/repositories'),
  getBackupsForRepo: (repoPath: string) => api.get(`/config-parser/backups/${encodeURIComponent(repoPath)}`),
}

// Backups API
export const backupsAPI = {
  getBackups: () => api.get('/backups'),
  getBackup: (id: string) => api.get(`/backups/${id}`),
  createBackup: (data: any) => api.post('/backups', data),
  updateBackup: (id: string, data: any) => api.put(`/backups/${id}`, data),
  deleteBackup: (id: string, filename?: string) => api.delete(`/backups/${id}${filename ? `?filename=${encodeURIComponent(filename)}` : ''}`),
  toggleBackup: (id: string, is_active: boolean) => api.patch(`/backups/${id}/toggle`, { is_active }),
  getCredentials: (id: string) => api.get(`/backups/${id}/credentials`),

  // Backup execution
  runBackup: (id: string) => api.post(`/backups/${id}/run`),
  stopBackup: (id: string) => api.post(`/backups/${id}/stop`),
  getBackupStatus: (id: string) => api.get(`/backups/${id}/status`),
  getRunningBackups: () => api.get('/backups/running'),

  // Retention profiles
  getRetentionProfiles: () => api.get('/backups/retention/profiles'),
  createRetentionProfile: (data: any) => api.post('/backups/retention/profiles', data),
  deleteRetentionProfile: (id: string) => api.delete(`/backups/retention/profiles/${id}`),

  // Export as template
  exportAsTemplate: (id: string) => api.get(`/backups/${id}/export-template`),

  // Duplicate backup
  duplicateBackup: (id: string) => api.post(`/backups/${id}/duplicate`),

  // Get YAML content for a backup
  getYamlContent: (id: string) => api.get(`/backups/${id}/yaml`),

  // Canary file (ransomware detection)
  createCanaryFile: (filePath: string) => api.post('/backups/canary-file/create', { file_path: filePath }),
  initCanaryHash: (filePath: string) => api.post('/backups/canary-file/init-hash', { file_path: filePath }),
}

// YAML Editor API
export const yamlEditorAPI = {
  getFiles: () => api.get('/yaml-editor/files'),
  getFile: (filename: string) => api.get(`/yaml-editor/file/${filename}`),
  saveFile: (filename: string, content: string) => api.post(`/yaml-editor/file/${filename}`, { content }),
  validateContent: (content: string, filename?: string) => api.post('/yaml-editor/validate', { content, filename }),
  getFileBackups: (filename: string) => api.get(`/yaml-editor/file/${filename}/backups`),
  restoreFromBackup: (filename: string, backupName: string) => api.post(`/yaml-editor/file/${filename}/restore`, { backupName }),
}

// Database Discovery API
export const databaseDiscoveryAPI = {
  scan: (options?: { networks?: string[]; network?: string; includeHost?: boolean; includeStopped?: boolean; forceRefresh?: boolean }) =>
    api.get('/database-discovery/scan', { params: options }),

  getResults: () => api.get('/database-discovery/results'),

  getCount: (options?: { network?: string; includeStopped?: boolean }) =>
    api.get('/database-discovery/count', { params: options }),

  validate: (database: any) => api.post('/database-discovery/validate', { database }),

  refresh: () => api.post('/database-discovery/refresh'),

  generateConfig: (databases: any[]) =>
    api.post('/database-discovery/generate-config', { databases }),

  // Get available Docker networks
  getNetworks: () => api.get('/database-discovery/networks'),

  // List databases within a database server
  listDatabases: (params: {
    type: string;
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    container?: string;
    instance?: string;
    encrypt?: 'true' | 'false' | 'strict';
    trustServerCert?: boolean;
    auth_method?: 'sql' | 'ad_password' | 'service_principal';
    client_id?: string;
    tenant_id?: string;
  }) => api.post('/database-discovery/list-databases', params),

  testConnection: (params: {
    type: string;
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    container?: string;
    instance?: string;
    encrypt?: 'true' | 'false' | 'strict';
    trustServerCert?: boolean;
    auth_method?: 'sql' | 'ad_password' | 'service_principal';
    client_id?: string;
    tenant_id?: string;
  }) => api.post('/database-discovery/test-connection', params),

  checkTools: (dbType: string) => api.get(`/database-discovery/tool-check/${dbType}`),
}

// Git Repos API
export const gitReposAPI = {
  discoverRepos: (params: {
    platform: string;
    organization?: string;
    user?: string;
    group?: string;
    workspace?: string;
    project?: string;
    host?: string;
    pat?: string;
    bb_username?: string;
    bb_app_password?: string;
    include_private?: boolean;
    include_forks?: boolean;
    include_archived?: boolean;
    include_subgroups?: boolean;
    repo_type?: string;
  }) => api.post('/git-repos/discover-repos', params),

  testConnection: (params: {
    platform: string;
    organization?: string;
    user?: string;
    group?: string;
    workspace?: string;
    project?: string;
    host?: string;
    pat?: string;
    bb_username?: string;
    bb_app_password?: string;
    repo_name?: string;
    include_private?: boolean;
    include_forks?: boolean;
    include_archived?: boolean;
    include_subgroups?: boolean;
    repo_type?: string;
  }) => api.post('/git-repos/test-connection', params),
}

// Git Restore API
export const gitRestoreAPI = {
  scan: (params: { repository: string; archive: string; basePath?: string }) =>
    api.get('/restore/git/scan', { params }),
  testConnection: (params: any) =>
    api.post('/restore/git/test', params),
  execute: (params: any) =>
    api.post('/restore/git/execute', params),
  getStatus: (jobId: string) =>
    api.get(`/restore/git/status/${jobId}`),
}

// Filesystem API
export const filesystemAPI = {
  // `detectBorg` opts into per-entry Borg-repository detection. It's off by
  // default because the probe is expensive on FUSE/cloud mounts; only the
  // repository picker needs it.
  browse: (
    targetPath: string,
    mode: 'directories' | 'files' | 'both' = 'directories',
    detectBorg = false
  ) =>
    api.get('/filesystem/browse', {
      params: { path: targetPath, mode, detect_borg: detectBorg ? 'true' : undefined },
    }),

  validatePath: (targetPath: string) =>
    api.post('/filesystem/validate-path', { path: targetPath }),

  createDirectory: (targetPath: string) =>
    api.post('/filesystem/create-directory', { path: targetPath }),
}

// Scripts API
export const scriptsAPI = {
  // Get all scripts (templates + custom)
  getAll: (params?: { hook_type?: string; category?: string }) =>
    api.get('/scripts', { params }),

  // Get script categories
  getCategories: () => api.get('/scripts/categories'),

  // Get only templates
  getTemplates: () => api.get('/scripts/templates'),

  // Get a specific script
  getScript: (id: string) => api.get(`/scripts/${id}`),

  // Create a new script
  create: (script: {
    name: string;
    description?: string;
    category?: string;
    icon?: string;
    hook_type: 'before_backup' | 'after_backup' | 'on_error';
    script: string;
    timeout?: number;
    run_condition?: 'always' | 'on_success' | 'on_error';
  }) => api.post('/scripts', script),

  // Copy a template
  copyTemplate: (templateId: string, customizations?: any) =>
    api.post(`/scripts/copy-template/${templateId}`, customizations || {}),

  // Update a script
  update: (id: string, updates: any) => api.put(`/scripts/${id}`, updates),

  // Delete a script
  delete: (id: string) => api.delete(`/scripts/${id}`),

  // Test a script by ID
  test: (id: string) => api.post(`/scripts/${id}/test`),

  // Test script content directly
  testContent: (script: string, timeout?: number) =>
    api.post('/scripts/test-content', { script, timeout }),

  // Generate hooks config for backup
  generateHooks: (scripts: {
    before_backup?: string[];
    after_backup?: string[];
    on_error?: string[];
  }) => api.post('/scripts/generate-hooks', scripts),
}

// Configuration Export/Import API
export const configExportAPI = {
  // Get export preview (what will be exported)
  getExportPreview: () => api.get('/config-export/preview'),

  // Check password strength
  checkPassword: (password: string) =>
    api.post('/config-export/check-password', { password }),

  // Export configuration
  export: (options: {
    encrypted?: boolean;
    masterPassword?: string;
    includeSecrets?: boolean;
    includeSchedules?: boolean;
    includeScripts?: boolean;
    includeNotifications?: boolean;
  }) => api.post('/config-export/export', options, { responseType: 'blob' }),

  // Preview import file
  previewImport: (formData: FormData) =>
    api.post('/config-export/import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Decrypt an encrypted import file
  decryptImport: (formData: FormData) =>
    api.post('/config-export/decrypt', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Decrypt and view full content (emergency viewer)
  viewDecrypted: (formData: FormData) =>
    api.post('/config-export/view-decrypted', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Import configuration
  import: (formData: FormData) =>
    api.post('/config-export/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
}

export default api 