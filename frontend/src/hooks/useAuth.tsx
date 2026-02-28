import React, { useState, useEffect, createContext, useContext } from 'react'
import { authAPI, startHeartbeat, stopHeartbeat } from '../services/api'

interface User {
  id: number
  username: string
  email: string
  is_admin: boolean
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) {
      authAPI.getProfile()
        .then(response => {
          setUser(response.data)
          // Start heartbeat for existing session
          startHeartbeat()
        })
        .catch((error) => {
          console.error('Failed to get profile:', error)
          stopHeartbeat()
          localStorage.removeItem('access_token')
          // Redirect to login if token is invalid
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = async (username: string, password: string) => {
    const response = await authAPI.login(username, password)
    const { access_token } = response.data
    localStorage.setItem('access_token', access_token)
    
    const profileResponse = await authAPI.getProfile()
    setUser(profileResponse.data)
    
    // Start heartbeat to keep session alive
    startHeartbeat()
  }

  const logout = async () => {
    // Stop heartbeat first
    stopHeartbeat()
    
    try {
      await authAPI.logout()
    } catch (error) {
      // Ignore logout errors
    }
    localStorage.removeItem('access_token')
    setUser(null)
  }

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
} 