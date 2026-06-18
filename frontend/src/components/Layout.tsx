import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.tsx'
import { useMutation, useQuery, useQueryClient } from 'react-query'
import { authAPI, identityAPI, logsAPI, dashboardAPI } from '../services/api'
import { toast } from 'react-hot-toast'
import { useDirector } from '../contexts/DirectorContext'
import { useSSEContext } from '../contexts/SSEContext'
import ClientSelector from './ClientSelector'
import logo from '../assets/img/brand/speedbits-logo.svg'
import {
  Home,
  Settings,
  FileText,
  Archive,
  Clock,
  Activity,
  Menu,
  Layout as LayoutIcon,
  Send,
  X,
  LogOut,
  User,
  Database,
  Key,
  Eye,
  EyeOff,
  FileCode,
  Bell,
  Server,
  HelpCircle,
  Code,
  AlertCircle,
  Pencil,
  Wifi,
  WifiOff,
  Loader2,
  XCircle,
  Users,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home, modes: ['standalone', 'client', 'director'] },
  { name: 'Backup Jobs', href: '/backups', icon: FileText, modes: ['standalone', 'client'] },
  { name: 'View/Restore', href: '/archives', icon: Archive, modes: ['standalone', 'client'] },
  { name: 'Repositories', href: '/repositories', icon: Database, modes: ['standalone', 'client'] },
  { name: 'Schedules', href: '/schedules', icon: Clock, modes: ['standalone', 'client'] },
  { name: 'SSH Keys', href: '/ssh-keys', icon: Key, modes: ['standalone', 'client', 'director'] },
  { name: 'Templates', href: '/templates', icon: LayoutIcon, modes: ['standalone', 'client', 'director'] },
  { name: 'Clients', href: '/clients', icon: Users, modes: ['director'] },
  { name: 'Deployments', href: '/deployments', icon: Send, modes: ['director'] },
  { name: 'Logs', href: '/logs', icon: Activity, modes: ['standalone', 'client', 'director'] },
  { name: 'Logs Overview', href: '/logs-overview', icon: Activity, modes: ['director'] }, // Director-only: aggregated client logs
  { name: 'Notifications', href: '/notifications', icon: Bell, modes: ['standalone', 'client', 'director'] }, // Configure notification destinations
  { name: 'Scripts', href: '/scripts', icon: Code, modes: ['standalone', 'client'] }, // Pre/post backup scripts
  { name: 'YAML Editor', href: '/config', icon: FileCode, modes: ['standalone', 'client'] },
  { name: 'Help', href: 'https://docs.speedbits.io/books/borgmatic-director-ui', icon: HelpCircle, modes: ['standalone', 'client', 'director'], external: true },
  { name: 'Settings', href: '/settings', icon: Settings, modes: ['standalone', 'client', 'director'] },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showInstanceNameModal, setShowInstanceNameModal] = useState(false)
  const [instanceNameInput, setInstanceNameInput] = useState('')

  const location = useLocation()
  const { user, logout } = useAuth()
  const { isRemoteSession, selectedClient, selectedConnectionQuality, disconnectFromRemote } = useDirector()
  const queryClient = useQueryClient()

  // Fetch current mode for visual indicator
  const { data: statusData } = useQuery(
    'identityStatus',
    () => identityAPI.getStatus(),
    {
      refetchInterval: 30000, // Background refresh every 30 seconds
      staleTime: 10000,       // Consider data fresh for 10 seconds
    }
  )

  // Fetch app version from health endpoint
  const { data: healthData } = useQuery(
    'appHealth',
    () => dashboardAPI.getHealth(),
    {
      staleTime: 60000, // Version doesn't change often
      retry: false,
    }
  )
  const appVersion = healthData?.data?.version || ''
  const appEdition = statusData?.data?.data?.edition || ''

  // Refresh key data when user navigates to a new page
  // This ensures the user always sees fresh data immediately on navigation
  useEffect(() => {
    // Invalidate queries that might have changed while on another page
    queryClient.invalidateQueries('identityStatus');
    queryClient.invalidateQueries('repositories');
    queryClient.invalidateQueries('config-parser-repositories');
    queryClient.invalidateQueries('backups');
    queryClient.invalidateQueries('schedules');
  }, [location.pathname, queryClient]);

  // Fetch error count for badge
  const { data: errorLogsData } = useQuery(
    'error-count',
    () => logsAPI.getLogs({
      log_type: 'borgmatic',
      lines: 100,
      level: 'error',
    }).then(res => res.data),
    {
      refetchInterval: 60000, // Refresh every minute
      staleTime: 30000,
    }
  )

  const errorCount = errorLogsData?.logs?.length || 0

  // Listen to SSE events for critical notifications
  const { lastEvent } = useSSEContext()

  useEffect(() => {
    if (!lastEvent) return

    // Show toast notifications for critical events
    switch (lastEvent.type) {
      case 'backup_failed':
        toast.error(
          `Backup "${lastEvent.data.backup_name || lastEvent.data.backup_id}" failed`,
          {
            duration: 10000,
            icon: '❌',
          }
        )
        queryClient.invalidateQueries('error-count')
        break

      case 'backup_stopped':
        toast(
          `Backup "${lastEvent.data.backup_name || lastEvent.data.backup_id}" was cancelled`,
          {
            duration: 5000,
            icon: '🛑',
          }
        )
        break

      case 'backup_completed': {
        const bName = lastEvent.data.backup_name || lastEvent.data.backup_id
        if (lastEvent.data.status === 'warning') {
          toast(
            `Backup "${bName}" completed with warnings`,
            {
              duration: 8000,
              icon: '⚠️',
            }
          )
          queryClient.invalidateQueries('error-count')
        } else {
          toast.success(
            `Backup "${bName}" completed successfully`,
            {
              duration: 5000,
              icon: '✅',
            }
          )
        }
        break
      }

      case 'error':
        toast.error(
          lastEvent.data.message || 'An error occurred',
          {
            duration: 10000,
            icon: '⚠️',
          }
        )
        break

      case 'connection_lost':
        if (lastEvent.data.client_name) {
          toast.error(
            `Connection lost to client: ${lastEvent.data.client_name}`,
            {
              duration: 8000,
              icon: '🔌',
            }
          )
        }
        break

      case 'connection_restored':
        if (lastEvent.data.client_name) {
          toast.success(
            `Connection restored to client: ${lastEvent.data.client_name}`,
            {
              duration: 5000,
              icon: '✅',
            }
          )
        }
        break
    }
  }, [lastEvent, queryClient])

  const mode = statusData?.data?.data?.mode || 'standalone'
  const identity = statusData?.data?.data?.identity
  const isDirectorMode = mode === 'director'
  const isClientMode = mode === 'client'
  const isStandaloneMode = mode === 'standalone'
  const hasClientConfig = isClientMode && identity?.director_url // Client configuration exists

  // Use live connection status instead of cached last_connected timestamp
  const connectionStatus = identity?.connection_status
  const isClientConnected = hasClientConfig && connectionStatus?.is_connected && connectionStatus?.is_authenticated
  const isClientDisconnected = hasClientConfig && (!connectionStatus?.is_connected || !connectionStatus?.is_authenticated)

  // When viewing a remote client, use 'client' mode for navigation
  // This shows client-appropriate menu items (Backup Jobs, Schedules, etc.)
  const effectiveMode = isRemoteSession ? 'client' : mode

  // Filter navigation items based on effective mode
  const filteredNavigation = navigation.filter(item => item.modes.includes(effectiveMode))

  const changePasswordMutation = useMutation({
    mutationFn: ({ current_password, new_password }: { current_password: string; new_password: string }) =>
      authAPI.changePassword(current_password, new_password),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setShowPasswordModal(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to change password');
    },
  });

  const updateDisplayNameMutation = useMutation({
    mutationFn: (client_name: string) =>
      identityAPI.updateDisplayName({ client_name }),
    onSuccess: () => {
      const trimmed = instanceNameInput.trim();
      toast.success(
        trimmed
          ? 'Instance name saved'
          : (systemHostname ? `Instance name reset to hostname (${systemHostname})` : 'Instance name cleared')
      );
      setShowInstanceNameModal(false);
      queryClient.invalidateQueries('identityStatus');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to save instance name');
    },
  });

  const openInstanceNameModal = () => {
    setInstanceNameInput((identity?.client_name || '').toString());
    setShowInstanceNameModal(true);
  };

  const handleInstanceNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateDisplayNameMutation.mutate(instanceNameInput.trim().slice(0, 80));
  };

  const systemHostname = (statusData?.data?.data?.system_hostname || '').toString().trim();
  const storedInstanceName = (identity?.client_name || '').toString().trim();
  // Default to the OS hostname when the user hasn't set a custom instance name.
  // This way the chip is meaningful out of the box on every install.
  const instanceName = storedInstanceName || systemHostname;

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    changePasswordMutation.mutate({
      current_password: passwordForm.currentPassword,
      new_password: passwordForm.newPassword
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Header Bar - Full Width */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Left side: Logo and App Name */}
          <div className="flex items-center">
            <button
              type="button"
              className="mr-4 -m-2.5 p-2.5 text-gray-700 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
            <img src={logo} alt="Speedbits Logo" className="h-12 w-auto" />
            <span className="text-base font-bold text-black" style={{ marginTop: '-5px', marginLeft: '-10px' }}>Borgmatic UI</span>
          </div>

          {/* Center: Remote Session Indicator */}
          <div className="flex-1 flex justify-center px-4">
            {isRemoteSession && selectedClient && (() => {
              // Quality-aware styling: stays calm when healthy, draws the eye when not.
              const q = selectedConnectionQuality
              const isReconnecting = q === 'reconnecting'
              const isLost = q === 'lost'

              const containerCls = isLost
                ? 'border-2 border-red-600 bg-gradient-to-r from-red-100 to-rose-100'
                : isReconnecting
                  ? 'border-2 border-amber-500 bg-gradient-to-r from-amber-100 to-yellow-100'
                  : 'border-2 border-blue-600 bg-gradient-to-r from-blue-100 to-indigo-100'
              const textCls = isLost ? 'text-red-900' : isReconnecting ? 'text-amber-900' : 'text-blue-900'
              const subTextCls = isLost ? 'text-red-700 bg-red-50' : isReconnecting ? 'text-amber-800 bg-amber-50' : 'text-blue-700 bg-blue-50'

              const statusIcon = isLost
                ? <WifiOff className="h-4 w-4 text-red-700" aria-label="Connection lost" />
                : isReconnecting
                  ? <Loader2 className="h-4 w-4 text-amber-700 animate-spin" aria-label="Reconnecting" />
                  : <Wifi className="h-4 w-4 text-blue-700" aria-label="Connected" />

              const statusLabel = isLost ? 'Connection lost' : isReconnecting ? 'Reconnecting…' : 'Live'

              const disconnectBtnCls = isLost
                ? 'text-red-700 hover:text-red-900 hover:bg-red-200'
                : isReconnecting
                  ? 'text-amber-700 hover:text-amber-900 hover:bg-amber-200'
                  : 'text-blue-700 hover:text-blue-900 hover:bg-blue-200'

              return (
                <div className={`flex items-center gap-3 pl-3 pr-1 py-1.5 rounded-lg shadow-md ${containerCls}`}>
                  <div className="flex items-center gap-2">
                    {statusIcon}
                    <span className={`text-sm font-bold ${textCls}`}>
                      Remote Session: {selectedClient.client_name}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${subTextCls}`}>
                      {statusLabel}
                    </span>
                    {selectedClient.ip_address && (
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${subTextCls}`}>
                        {selectedClient.ip_address}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={disconnectFromRemote}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-colors ${disconnectBtnCls}`}
                    title="Leave remote session and return to director"
                    aria-label="Disconnect from remote client"
                  >
                    <XCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">Disconnect</span>
                  </button>
                </div>
              )
            })()}
          </div>

          {/* Right side: Report Error Button + Client Selector */}
          <div className="flex items-center space-x-4">
            <a
              href="https://speedbits.io/contact/?type=Borgmatic%20Director%20UI"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-red-500 rounded-md transition-colors"
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
              Report an error
            </a>
            <ClientSelector />
          </div>
        </div>
      </header>

      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 flex w-64 flex-col bg-white">
          <div className="flex h-16 items-center justify-between px-4 border-b border-gray-200">
            <div className="flex items-center">
              <img src={logo} alt="Speedbits Logo" className="h-10 w-auto" />
              <span className="text-sm font-bold text-black" style={{ marginTop: '-5px', marginLeft: '-10px' }}>Borgmatic UI</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          {/* Instance Name Chip (shown when client_name or hostname is available) */}
          {instanceName && (
            <div className="mx-4 mt-3 mb-1">
              <div
                className="w-full pl-3 pr-2 py-2 bg-white border border-gray-200 border-l-4 border-l-blue-500 rounded-lg shadow-sm flex items-center justify-between gap-2"
                title={instanceName}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 leading-tight">Instance:</span>
                  <span className="text-sm font-bold text-gray-900 whitespace-normal break-words line-clamp-2 leading-snug">{instanceName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setSidebarOpen(false); openInstanceNameModal(); }}
                  className="flex-shrink-0 p-1.5 -mr-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title={`Edit instance name (${instanceName})`}
                  aria-label="Edit instance name"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
          {/* Mode Indicator Badge */}
          {isRemoteSession && selectedClient ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-3'} mb-2`}>
              <div className="flex flex-col items-center px-3 py-2 bg-blue-100 border-2 border-blue-500 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4 text-blue-700" />
                  <span className="text-xs font-semibold text-blue-900">Client Mode</span>
                </div>
                <span className="text-xs text-blue-700 font-medium mt-1">
                  Viewing: {selectedClient.client_name}
                </span>
              </div>
            </div>
          ) : isDirectorMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-3'} mb-2`}>
              <div className="flex items-center space-x-2 px-3 py-2 bg-purple-100 border border-purple-300 rounded-lg">
                <Server className="h-4 w-4 text-purple-700" />
                <span className="text-xs font-semibold text-purple-900">Director Mode</span>
              </div>
            </div>
          ) : isStandaloneMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-3'} mb-2`}>
              <div className="flex items-center space-x-2 px-3 py-2 bg-green-50 border border-green-300 rounded-lg">
                <Server className="h-4 w-4 text-green-700" />
                <span className="text-xs font-semibold text-green-900">Standalone Mode</span>
              </div>
            </div>
          ) : isClientMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-3'} mb-2`}>
              <div className="flex flex-col items-center px-3 py-2 bg-blue-50 border border-blue-300 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4 text-blue-700" />
                  <span className="text-xs font-semibold text-blue-900">Client Mode</span>
                </div>
                {isClientConnected && (
                  <span className="text-xs text-green-700 font-medium mt-1">Connected to Director</span>
                )}
                {isClientDisconnected && (
                  <span className="text-xs text-red-600 font-medium mt-1">Disconnected from Director</span>
                )}
              </div>
            </div>
          ) : null}
          <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
            {filteredNavigation.map((item) => {
              const isActive = location.pathname === item.href
              const showErrorBadge = item.name === 'Logs' && errorCount > 0
              const isExternal = (item as any).external
              return isExternal ? (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="flex items-center">
                    <item.icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </div>
                  {showErrorBadge && (
                    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {errorCount}
                    </span>
                  )}
                </a>
              ) : (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`group flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md ${isActive
                    ? 'bg-primary-100 text-primary-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="flex items-center">
                    <item.icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </div>
                  {showErrorBadge && (
                    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {errorCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
          <div className="border-t border-gray-200 p-4">
            {appVersion && (
              <div className="mb-3 px-2 text-xs text-gray-400">
                <span>v{appVersion}</span>
                {appEdition && <span className="ml-1.5">· {appEdition === 'commercial' ? 'Commercial' : 'Community'}</span>}
              </div>
            )}
            <button
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center w-full hover:bg-gray-50 p-2 rounded-md transition-colors"
              title="Click to change password"
            >
              <User className="h-5 w-5 text-gray-400" />
              <div className="ml-3 text-left">
                <p className="text-sm font-medium text-gray-700">{user?.username}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
            </button>
            <button
              onClick={logout}
              className="mt-3 flex w-full items-center px-2 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-md"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Desktop sidebar - Below header */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:top-16 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-grow bg-white border-r border-gray-200">
          {/* Instance Name Chip (shown when client_name or hostname is available) */}
          {instanceName && (
            <div className="mx-4 mt-4 mb-1">
              <div
                className="w-full pl-3 pr-2 py-2 bg-white border border-gray-200 border-l-4 border-l-blue-500 rounded-lg shadow-sm flex items-center justify-between gap-2"
                title={instanceName}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 leading-tight">Instance:</span>
                  <span className="text-sm font-bold text-gray-900 whitespace-normal break-words line-clamp-2 leading-snug">{instanceName}</span>
                </div>
                <button
                  type="button"
                  onClick={openInstanceNameModal}
                  className="flex-shrink-0 p-1.5 -mr-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title={`Edit instance name (${instanceName})`}
                  aria-label="Edit instance name"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
          {/* Mode Indicator Badge */}
          {isRemoteSession && selectedClient ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-4'} mb-2`}>
              <div className="flex flex-col items-center px-3 py-2 bg-blue-100 border-2 border-blue-500 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4 text-blue-700" />
                  <span className="text-xs font-semibold text-blue-900">Client Mode</span>
                </div>
                <span className="text-xs text-blue-700 font-medium mt-1">
                  Viewing: {selectedClient.client_name}
                </span>
              </div>
            </div>
          ) : isDirectorMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-4'} mb-2`}>
              <div className="flex items-center space-x-2 px-3 py-2 bg-purple-100 border border-purple-300 rounded-lg">
                <Server className="h-4 w-4 text-purple-700" />
                <span className="text-xs font-semibold text-purple-900">Director Mode</span>
              </div>
            </div>
          ) : isStandaloneMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-4'} mb-2`}>
              <div className="flex items-center space-x-2 px-3 py-2 bg-green-50 border border-green-300 rounded-lg">
                <Server className="h-4 w-4 text-green-700" />
                <span className="text-xs font-semibold text-green-900">Standalone Mode</span>
              </div>
            </div>
          ) : isClientMode ? (
            <div className={`mx-4 ${instanceName ? 'mt-1' : 'mt-4'} mb-2`}>
              <div className="flex flex-col items-center px-3 py-2 bg-blue-50 border border-blue-300 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4 text-blue-700" />
                  <span className="text-xs font-semibold text-blue-900">Client Mode</span>
                </div>
                {isClientConnected && (
                  <span className="text-xs text-green-700 font-medium mt-1">Connected to Director</span>
                )}
                {isClientDisconnected && (
                  <span className="text-xs text-red-600 font-medium mt-1">Disconnected from Director</span>
                )}
              </div>
            </div>
          ) : null}
          <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
            {filteredNavigation.map((item) => {
              const isActive = location.pathname === item.href
              const showErrorBadge = item.name === 'Logs' && errorCount > 0
              const isExternal = (item as any).external
              return isExternal ? (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900`}
                >
                  <div className="flex items-center">
                    <item.icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </div>
                  {showErrorBadge && (
                    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {errorCount}
                    </span>
                  )}
                </a>
              ) : (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`group flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md ${isActive
                    ? 'bg-primary-100 text-primary-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                >
                  <div className="flex items-center">
                    <item.icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </div>
                  {showErrorBadge && (
                    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {errorCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
          <div className="border-t border-gray-200 p-4">
            {appVersion && (
              <div className="mb-3 px-2 text-xs text-gray-400">
                <span>v{appVersion}</span>
                {appEdition && <span className="ml-1.5">· {appEdition === 'commercial' ? 'Commercial' : 'Community'}</span>}
              </div>
            )}
            <button
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center w-full hover:bg-gray-50 p-2 rounded-md transition-colors"
              title="Click to change password"
            >
              <User className="h-5 w-5 text-gray-400" />
              <div className="ml-3 text-left">
                <p className="text-sm font-medium text-gray-700">{user?.username}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
            </button>
            <button
              onClick={logout}
              className="mt-3 flex w-full items-center px-2 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-md"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content - With top and left padding */}
      <div className="pt-16 lg:pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-auto">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                © <a href="https://speedbits.io" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline">Speedbits</a> / Smart In Venture 2025. Borgmatic Director UI is included in the <a href="https://speedbits.io/infinity-tools/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline">Infinity Tools</a> Commercial
              </p>
              {appVersion && (
                <span className="text-xs text-gray-400">v{appVersion}</span>
              )}
            </div>
          </div>
        </footer>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Change Password</h3>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Minimum 8 characters</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                    </button>
                  </div>
                  {passwordForm.newPassword && passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                    <p className="mt-1 text-sm text-red-600">Passwords do not match</p>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordModal(false);
                      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changePasswordMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {changePasswordMutation.isLoading ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Instance Name Edit Modal */}
      {showInstanceNameModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-1">Set Instance Name</h3>
              <p className="text-xs text-gray-500 mb-4">
                A short label to distinguish this Borgmatic UI installation from others. Shown in the left sidebar.
                {systemHostname
                  ? ` Leave empty to use the system hostname (${systemHostname}) as the default.`
                  : ' Leave empty to clear.'}
              </p>
              <form onSubmit={handleInstanceNameSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instance name</label>
                  <input
                    type="text"
                    value={instanceNameInput}
                    onChange={(e) => setInstanceNameInput(e.target.value)}
                    maxLength={80}
                    placeholder={systemHostname || 'e.g. WSL Laptop, Production Server, Backup Box A'}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    {instanceNameInput.length}/80 characters
                    {systemHostname && !instanceNameInput.trim() && (
                      <span className="ml-2 text-gray-500">
                        — defaulting to <span className="font-medium">{systemHostname}</span>
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowInstanceNameModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateDisplayNameMutation.isLoading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateDisplayNameMutation.isLoading ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
