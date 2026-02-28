import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { toast } from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth.tsx'
import { useDirector } from '../contexts/DirectorContext'
import { authAPI, identityAPI } from '../services/api'
import { Server, Users, Monitor } from 'lucide-react'
import speedbitsLogo from '../assets/img/brand/speedbits-logo.svg'
import borgmaticLogo from '../assets/img/brand/borgmatic.png'

interface LoginForm {
  username: string
  password: string
}

interface ModeInfo {
  mode: string
  edition: string
}

// Mode configuration
const modeConfig = {
  standalone: {
    label: 'Standalone Mode',
    color: 'green',
    bgGradient: 'from-green-500 to-emerald-600',
    bgLight: 'bg-green-50',
    borderColor: 'border-green-500',
    textColor: 'text-green-700',
    icon: Server,
  },
  client: {
    label: 'Client Mode',
    color: 'blue',
    bgGradient: 'from-blue-500 to-indigo-600',
    bgLight: 'bg-blue-50',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-700',
    icon: Monitor,
  },
  director: {
    label: 'Director Mode',
    color: 'purple',
    bgGradient: 'from-purple-500 to-violet-600',
    bgLight: 'bg-purple-50',
    borderColor: 'border-purple-500',
    textColor: 'text-purple-700',
    icon: Users,
  },
  not_configured: {
    label: 'Setup Required',
    color: 'gray',
    bgGradient: 'from-gray-400 to-gray-500',
    bgLight: 'bg-gray-50',
    borderColor: 'border-gray-400',
    textColor: 'text-gray-600',
    icon: Server,
  },
}

export default function Login() {
  const [isLoading, setIsLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null)
  const { login } = useAuth()
  const { recheckMode } = useDirector()
  const navigate = useNavigate()

  // Fetch mode on mount (public endpoint)
  useEffect(() => {
    const fetchPublicState = async () => {
      try {
        const [modeResponse, setupResponse] = await Promise.all([
          identityAPI.getMode(),
          authAPI.getSetupStatus(),
        ])
        setModeInfo(modeResponse.data.data)
        setSetupRequired(Boolean(setupResponse.data?.setup_required))
      } catch (err) {
        console.log('Could not fetch mode, using default')
        setModeInfo({ mode: 'standalone', edition: 'commercial' })
      }
    }
    fetchPublicState()
  }, [])
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>()

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true)
    setErrorMessage('') // Clear previous errors
    try {
      await login(data.username, data.password)
      toast.success('Login successful!')
      // Re-check Director mode after login to show client dropdown if applicable
      await recheckMode()
      navigate('/dashboard')
    } catch (error: any) {
      console.error('Login error:', error)
      
      // Check for network errors (backend unreachable)
      const isNetworkError = 
        error.code === 'ERR_NETWORK' ||
        error.message === 'Network Error' ||
        error.message?.includes('NetworkError') ||
        (!error.response && error.request) ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT'
      
      let errorMsg: string
      if (isNetworkError) {
        errorMsg = 'Backend server cannot be reached. Please ensure the backend server is running.'
      } else if (error.response?.data?.detail) {
        errorMsg = error.response.data.detail
      } else {
        errorMsg = 'Username or password incorrect!'
      }
      
      setErrorMessage(errorMsg)
      toast.error(errorMsg, {
        duration: 5000,
        style: {
          background: '#fef2f2',
          color: '#dc2626',
          border: '1px solid #fecaca',
        }
      })
    } finally {
      setIsLoading(false)
    }
  }

  const onSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    if (!setupPassword || !setupConfirmPassword) {
      setErrorMessage('Please enter and confirm your password.')
      return
    }
    if (setupPassword.length < 10) {
      setErrorMessage('Password must be at least 10 characters long.')
      return
    }
    if (setupPassword !== setupConfirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setSetupLoading(true)
    try {
      await authAPI.setupAdmin(setupPassword, setupConfirmPassword)
      toast.success('Admin user created. Please sign in as admin.')
      setSetupRequired(false)
      setSetupPassword('')
      setSetupConfirmPassword('')
      setErrorMessage('')
    } catch (error: any) {
      const msg = error?.response?.data?.detail || 'Failed to create admin user'
      setErrorMessage(msg)
      toast.error(msg)
    } finally {
      setSetupLoading(false)
    }
  }

  const currentMode = modeInfo?.mode || 'standalone'
  const config = modeConfig[currentMode as keyof typeof modeConfig] || modeConfig.standalone
  const ModeIcon = config.icon

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top color bar based on mode */}
      <div className={`h-2 bg-gradient-to-r ${config.bgGradient}`} />

      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          {/* Logo section */}
          <div className="text-center">
            {/* Borgmatic logo (bigger) */}
            <div className="flex justify-center mb-4">
              <img 
                src={borgmaticLogo} 
                alt="Borgmatic" 
                className="h-24 w-auto"
              />
            </div>

            {/* Title */}
            <h2 className="text-3xl font-extrabold text-gray-900">
              Borgmatic Director UI
            </h2>

            {/* Mode indicator */}
            <div className={`mt-4 inline-flex items-center space-x-2 px-4 py-2 rounded-full ${config.bgLight} border ${config.borderColor}`}>
              <ModeIcon className={`h-4 w-4 ${config.textColor}`} />
              <span className={`text-sm font-semibold ${config.textColor}`}>
                {config.label}
              </span>
            </div>

            <p className="mt-4 text-sm text-gray-600">
              {setupRequired ? 'Create your admin password to complete setup' : 'Sign in to manage your backups'}
            </p>
          </div>

          {/* Login form */}
          <form className="mt-8 space-y-6" onSubmit={setupRequired ? onSetupSubmit : handleSubmit(onSubmit)}>
            <div className="rounded-md shadow-sm -space-y-px">
              {!setupRequired ? (
                <>
                  <div>
                    <label htmlFor="username" className="sr-only">
                      Username
                    </label>
                    <input
                      {...register('username', { required: 'Username is required' })}
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${
                        errors.username ? 'border-danger-300' : 'border-gray-300'
                      } placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm`}
                      placeholder="Username"
                    />
                    {errors.username && (
                      <p className="mt-1 text-sm text-danger-600">{errors.username.message}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="password" className="sr-only">
                      Password
                    </label>
                    <input
                      {...register('password', { required: 'Password is required' })}
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${
                        errors.password ? 'border-danger-300' : 'border-gray-300'
                      } placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm`}
                      placeholder="Password"
                    />
                    {errors.password && (
                      <p className="mt-1 text-sm text-danger-600">{errors.password.message}</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="setup-password" className="sr-only">
                      Create admin password
                    </label>
                    <input
                      id="setup-password"
                      type="password"
                      autoComplete="new-password"
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                      placeholder="Create admin password (min 10 chars)"
                    />
                  </div>
                  <div>
                    <label htmlFor="setup-confirm-password" className="sr-only">
                      Confirm admin password
                    </label>
                    <input
                      id="setup-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={setupConfirmPassword}
                      onChange={(e) => setSetupConfirmPassword(e.target.value)}
                      className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                      placeholder="Confirm admin password"
                    />
                  </div>
                </>
              )}
            </div>

            {errorMessage && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      {setupRequired ? 'Setup Failed' : 'Login Failed'}
                    </h3>
                    <div className="mt-2 text-sm text-red-700">
                      {errorMessage}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={setupRequired ? setupLoading : isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {setupRequired
                  ? (setupLoading ? 'Creating admin user...' : 'Create admin password')
                  : (isLoading ? 'Signing in...' : 'Sign in')}
              </button>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-600">
                {setupRequired
                  ? 'First-time setup detected: create your admin password now.'
                  : 'Username is always "admin". Use your configured password to sign in.'}
              </p>
            </div>
          </form>

          {/* Speedbits logo and copyright */}
          <div className="flex flex-col items-center pt-6 border-t border-gray-200 space-y-2">
            <a href="https://speedbits.io" target="_blank" rel="noopener noreferrer" className="opacity-80 hover:opacity-100 transition-opacity">
              <img 
                src={speedbitsLogo} 
                alt="Speedbits" 
                className="h-16 w-auto"
              />
            </a>
            <p className="text-xs text-gray-400 text-center">
              © Smart In Venture GmbH 2025. This is proprietary software and can be downloaded at{' '}
              <a 
                href="https://www.speedbits.io" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600 hover:underline"
              >
                www.speedbits.io
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
