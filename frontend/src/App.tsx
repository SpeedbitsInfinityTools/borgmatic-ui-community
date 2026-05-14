import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { useAuth } from './hooks/useAuth.tsx'
import { useSessionManager } from './hooks/useSessionManager'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Config from './pages/Config'
import Backup from './pages/Backup'
import Backups from './pages/Backups'
import Archives from './pages/Archives'
import Schedules from './pages/Schedules'
import Repositories from './pages/Repositories'
import SSHKeys from './pages/SSHKeys'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Templates from './pages/Templates'
import Deployments from './pages/Deployments'
import Notifications from './pages/Notifications'
import LogsOverview from './pages/LogsOverview'
import Scripts from './pages/Scripts'
import Clients from './pages/Clients'
import { SSEProvider } from './contexts/SSEContext'
import { DirectorProvider } from './contexts/DirectorContext'
import InitialSetupModal from './components/InitialSetupModal'
import { identityAPI } from './services/api'

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth()
  const [showInitialSetup, setShowInitialSetup] = useState(false)
  const [checkingMode, setCheckingMode] = useState(true)
  const location = useLocation()

  // Initialize session manager for authenticated users
  useSessionManager()

  // Listen for network errors from API interceptor
  useEffect(() => {
    const handleNetworkError = (event: CustomEvent<{ message: string }>) => {
      toast.error(event.detail.message, {
        id: 'network-error', // Use fixed ID to prevent duplicates
        duration: 8000,
        icon: '🔴',
      })
    }

    window.addEventListener('network-error', handleNetworkError as EventListener)
    return () => {
      window.removeEventListener('network-error', handleNetworkError as EventListener)
    }
  }, [])

  // Check if mode is configured
  useEffect(() => {
    const checkMode = async () => {
      if (!isAuthenticated) {
        setCheckingMode(false)
        return
      }

      try {
        const response = await identityAPI.getStatus()
        const status = response.data.data

        // Check for edition query parameter (for testing/preview)
        const urlParams = new URLSearchParams(location.search)
        const editionParam = urlParams.get('edition')

        // Show initial setup if mode is not configured OR if accessing secret setup route
        // OR if edition query parameter is present (for preview/testing)
        if (!status.mode || status.mode === 'not_configured' || location.pathname === '/setup-debug' || editionParam) {
          setShowInitialSetup(true)
        }
      } catch (error) {
        console.error('Failed to check mode:', error)
      } finally {
        setCheckingMode(false)
      }
    }

    checkMode()
  }, [isAuthenticated, location])

  if (isLoading || checkingMode) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Get edition query parameter for preview/testing
  const urlParams = new URLSearchParams(location.search)
  const editionPreview = urlParams.get('edition')

  return (
    <>
      {showInitialSetup && (
        <InitialSetupModal
          onComplete={() => setShowInitialSetup(false)}
          editionPreview={editionPreview || undefined}
        />
      )}

      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/config" element={<Config />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/archives" element={<Archives />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/repositories" element={<Repositories />} />
          <Route path="/ssh-keys" element={<SSHKeys />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/logs-overview" element={<LogsOverview />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/scripts" element={<Scripts />} />
          <Route path="/settings" element={<Settings />} />
          {/* Secret debug route to revisit setup */}
          <Route path="/setup-debug" element={<div />} />
        </Routes>
      </Layout>
    </>
  )
}

function App() {
  return (
    <DirectorProvider>
      <SSEProvider>
        <AppContent />
      </SSEProvider>
    </DirectorProvider>
  )
}

export default App 