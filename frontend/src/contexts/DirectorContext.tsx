import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react'
import { useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { directorAPI, identityAPI, setRemoteClientId } from '../services/api'

interface Client {
  client_id: string
  client_name: string
  status: 'pending' | 'approved' | 'connected' | 'disconnected'
  is_connected: boolean // Real-time connection status from server
  ip_address?: string
  ip_locked: boolean
  last_seen?: string
  last_connected?: string
}

interface DirectorContextType {
  // Current selected client (null = Director local operations)
  selectedClient: Client | null
  setSelectedClient: (client: Client | null) => void
  
  // Select client and trigger dropdown pulse
  selectClientWithPulse: (client: Client) => void
  selectorPulse: boolean

  // Available clients
  clients: Client[]
  loadClients: () => Promise<void>

  // Mode detection
  isDirectorMode: boolean
  isRemoteSession: boolean // true when viewing a remote client's data
  isLoading: boolean
  
  // Re-check mode (call after login)
  recheckMode: () => Promise<void>
}

const DirectorContext = createContext<DirectorContextType | undefined>(undefined)

const SELECTED_CLIENT_KEY = 'borgmatic_selected_client'

// Load selected client from localStorage
function loadStoredClient(): Client | null {
  try {
    const stored = localStorage.getItem(SELECTED_CLIENT_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn('Failed to load stored client:', e)
  }
  return null
}

// Save selected client to localStorage
function saveStoredClient(client: Client | null) {
  try {
    if (client) {
      localStorage.setItem(SELECTED_CLIENT_KEY, JSON.stringify(client))
    } else {
      localStorage.removeItem(SELECTED_CLIENT_KEY)
    }
  } catch (e) {
    console.warn('Failed to save stored client:', e)
  }
}

export function DirectorProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedClient, setSelectedClientState] = useState<Client | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [isDirectorMode, setIsDirectorMode] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [selectorPulse, setSelectorPulse] = useState(false)
  const previousClientId = useRef<string | null>(null)
  const isInitialLoad = useRef(true) // Track if this is initial page load

  // Wrapper to persist selected client and invalidate queries
  const setSelectedClient = (client: Client | null) => {
    const newClientId = client?.client_id || null
    const oldClientId = previousClientId.current

    // Only invalidate if client actually changed
    if (newClientId !== oldClientId) {
      console.log(`🔄 Client changed: ${oldClientId || 'Director'} → ${newClientId || 'Director'}`)
      
      // Update state and storage
      setSelectedClientState(client)
      saveStoredClient(client)
      previousClientId.current = newClientId

      // Invalidate all client-specific queries so they refetch with new client context
      // This ensures fresh data when switching between clients or Director
      queryClient.invalidateQueries({ queryKey: ['repositories-list'] })
      queryClient.invalidateQueries({ queryKey: ['archives'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['logs'] })

      // Navigate to Dashboard when switching contexts (but not on initial page load/restore)
      if (!isInitialLoad.current) {
        console.log('🏠 Navigating to Dashboard after context switch')
        navigate('/')
      }
    } else {
      // Same client, just update state
      setSelectedClientState(client)
      saveStoredClient(client)
    }
  }

  // Select a client and pulse the dropdown to draw attention
  const selectClientWithPulse = (client: Client) => {
    setSelectedClient(client)
    setSelectorPulse(true)
    setTimeout(() => setSelectorPulse(false), 2000) // Pulse for 2 seconds
  }

  // Check if we're in Director mode
  useEffect(() => {
    checkMode()
  }, [])

  // Load clients when in Director mode
  useEffect(() => {
    if (isDirectorMode) {
      loadClients()

      // Refresh clients periodically
      const interval = setInterval(loadClients, 30000) // Every 30 seconds
      return () => clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirectorMode])

  // Update API interceptor when selected client changes
  useEffect(() => {
    setRemoteClientId(selectedClient?.client_id || null)
  }, [selectedClient])

  const checkMode = async () => {
    try {
      const response = await identityAPI.getStatus()
      const mode = response.data.data.mode
      setIsDirectorMode(mode === 'director')
      
      // If we just detected director mode, load clients immediately
      if (mode === 'director') {
        loadClients()
      }
    } catch (error) {
      console.error('Failed to check mode:', error)
      setIsDirectorMode(false)
    } finally {
      setIsLoading(false)
    }
  }
  
  // Expose recheckMode for calling after login
  const recheckMode = async () => {
    setIsLoading(true)
    await checkMode()
  }

  const loadClients = async () => {
    try {
      const response = await directorAPI.getClients()
      const allClients = response.data.data.clients || []

      // Filter to only show actually connected clients (real-time status)
      const availableClients = allClients.filter((client: Client) =>
        client.is_connected === true
      )

      setClients(availableClients)

      // Try to restore selected client from localStorage (e.g., after page refresh)
      const storedClient = loadStoredClient()
      if (storedClient && !selectedClient && isInitialLoad.current) {
        // Check if stored client is still available and connected
        const restoredClient = availableClients.find((c: Client) => c.client_id === storedClient.client_id)
        if (restoredClient) {
          console.log('🔄 Restoring selected client from localStorage:', restoredClient.client_name)
          setSelectedClientState(restoredClient) // Don't re-save, just restore state
          previousClientId.current = restoredClient.client_id // Track for change detection
          
          // Invalidate queries to fetch data for the restored client
          queryClient.invalidateQueries({ queryKey: ['repositories-list'] })
          queryClient.invalidateQueries({ queryKey: ['archives'] })
          queryClient.invalidateQueries({ queryKey: ['backups'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          queryClient.invalidateQueries({ queryKey: ['systemSettings'] })
          queryClient.invalidateQueries({ queryKey: ['schedule'] })
          queryClient.invalidateQueries({ queryKey: ['logs'] })
        } else {
          // Client is no longer connected, clear storage
          console.log('⚠️ Stored client is no longer connected, clearing')
          saveStoredClient(null)
        }
      }

      // Mark initial load as complete - subsequent client switches will navigate to Dashboard
      if (isInitialLoad.current) {
        isInitialLoad.current = false
        console.log('✅ Initial client load complete')
      }

      // If selected client is no longer available, deselect
      if (selectedClient && !availableClients.find((c: Client) => c.client_id === selectedClient.client_id)) {
        setSelectedClient(null)
      }
    } catch (error) {
      console.error('Failed to load clients:', error)
      setClients([])
    }
  }

  const value: DirectorContextType = {
    selectedClient,
    setSelectedClient,
    selectClientWithPulse,
    selectorPulse,
    clients,
    loadClients,
    isDirectorMode,
    isRemoteSession: isDirectorMode && selectedClient !== null,
    isLoading,
    recheckMode,
  }

  return (
    <DirectorContext.Provider value={value}>
      {children}
    </DirectorContext.Provider>
  )
}

export function useDirector() {
  const context = useContext(DirectorContext)
  if (context === undefined) {
    throw new Error('useDirector must be used within a DirectorProvider')
  }
  return context
}

