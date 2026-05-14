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

// Live connection quality of the selected client, derived from director's view of it.
// 'connected'    – healthy, reachable
// 'reconnecting' – briefly missing one poll, give it a moment
// 'lost'         – missing multiple polls, treat the link as broken (UI shows red, user can leave)
// 'unknown'      – no data yet (initial load)
export type ConnectionQuality = 'connected' | 'reconnecting' | 'lost' | 'unknown'

interface DirectorContextType {
  // Current selected client (null = Director local operations)
  selectedClient: Client | null
  setSelectedClient: (client: Client | null) => void
  
  // Select client and trigger dropdown pulse
  selectClientWithPulse: (client: Client) => void
  selectorPulse: boolean

  // Available clients (only those currently connected — used for the switcher dropdown)
  clients: Client[]
  // All known clients incl. disconnected — used to track status of the currently selected one
  allClients: Client[]
  loadClients: () => Promise<void>

  // Live connection status of the selected client (derived)
  selectedConnectionQuality: ConnectionQuality
  // Explicit "leave remote session" — clears selection and returns to director-local view
  disconnectFromRemote: () => void

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
  const [allClients, setAllClients] = useState<Client[]>([])
  const [isDirectorMode, setIsDirectorMode] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [selectorPulse, setSelectorPulse] = useState(false)
  const [selectedConnectionQuality, setSelectedConnectionQuality] = useState<ConnectionQuality>('unknown')
  const previousClientId = useRef<string | null>(null)
  const isInitialLoad = useRef(true) // Track if this is initial page load
  // Counts consecutive polls where the selected client looks disconnected. We only flip to
  // 'lost' after a few misses to avoid red-flashing on a single dropped poll.
  const missedPolls = useRef(0)
  const RECONNECT_THRESHOLD = 1 // first miss → "reconnecting"
  const LOST_THRESHOLD = 3      // 3 consecutive misses → "lost"

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

  // Load clients when in Director mode. We poll faster while a remote session is active so
  // the topbar chip flips to "Reconnecting…" / "Lost" within a few seconds, not 30.
  useEffect(() => {
    if (isDirectorMode) {
      loadClients()

      const intervalMs = selectedClient ? 5000 : 30000
      const interval = setInterval(loadClients, intervalMs)
      return () => clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirectorMode, selectedClient?.client_id])

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
      const fullList: Client[] = response.data.data.clients || []

      // Switcher dropdown only offers clients we can actually reach right now.
      const availableClients = fullList.filter((client: Client) => client.is_connected === true)

      setClients(availableClients)
      setAllClients(fullList)

      // Try to restore selected client from localStorage (e.g., after page refresh)
      const storedClient = loadStoredClient()
      if (storedClient && !selectedClient && isInitialLoad.current) {
        // Restore even if currently disconnected — chip will show 'reconnecting'/'lost'
        // and the user gets to decide whether to leave the session or wait.
        const restoredClient = fullList.find((c: Client) => c.client_id === storedClient.client_id)
        if (restoredClient) {
          console.log('🔄 Restoring selected client from localStorage:', restoredClient.client_name)
          setSelectedClientState(restoredClient)
          previousClientId.current = restoredClient.client_id
          
          queryClient.invalidateQueries({ queryKey: ['repositories-list'] })
          queryClient.invalidateQueries({ queryKey: ['archives'] })
          queryClient.invalidateQueries({ queryKey: ['backups'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          queryClient.invalidateQueries({ queryKey: ['systemSettings'] })
          queryClient.invalidateQueries({ queryKey: ['schedule'] })
          queryClient.invalidateQueries({ queryKey: ['logs'] })
        } else {
          // Client record gone entirely (removed by admin) — clear storage.
          console.log('⚠️ Stored client is no longer known to director, clearing')
          saveStoredClient(null)
        }
      }

      if (isInitialLoad.current) {
        isInitialLoad.current = false
        console.log('✅ Initial client load complete')
      }

      // Compute live connection quality of the currently selected client. We do NOT auto-
      // deselect on disconnect — the user keeps the remote session and the chip reflects
      // that the link is shaky. The user explicitly leaves with the disconnect button.
      if (selectedClient) {
        const live = fullList.find((c: Client) => c.client_id === selectedClient.client_id)
        if (live && live.is_connected) {
          missedPolls.current = 0
          setSelectedConnectionQuality('connected')
        } else {
          missedPolls.current += 1
          if (missedPolls.current >= LOST_THRESHOLD) {
            setSelectedConnectionQuality('lost')
          } else if (missedPolls.current >= RECONNECT_THRESHOLD) {
            setSelectedConnectionQuality('reconnecting')
          }
        }
      } else {
        missedPolls.current = 0
        setSelectedConnectionQuality('unknown')
      }
    } catch (error) {
      console.error('Failed to load clients:', error)
      setClients([])
      // Don't clobber allClients on a transient failure — leave the last good list.
      if (selectedClient) {
        missedPolls.current += 1
        if (missedPolls.current >= LOST_THRESHOLD) {
          setSelectedConnectionQuality('lost')
        } else {
          setSelectedConnectionQuality('reconnecting')
        }
      }
    }
  }

  // Explicit user action: leave the remote session. Returns the UI to the director-local
  // view and navigates home so we don't sit on a page that only made sense in client mode.
  const disconnectFromRemote = () => {
    if (!selectedClient) return
    console.log(`👋 Leaving remote session: ${selectedClient.client_name}`)
    missedPolls.current = 0
    setSelectedConnectionQuality('unknown')
    setSelectedClient(null)
  }

  const value: DirectorContextType = {
    selectedClient,
    setSelectedClient,
    selectClientWithPulse,
    selectorPulse,
    clients,
    allClients,
    loadClients,
    selectedConnectionQuality,
    disconnectFromRemote,
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

