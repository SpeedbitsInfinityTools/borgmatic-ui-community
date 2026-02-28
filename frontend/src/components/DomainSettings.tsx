import { useState, useEffect } from 'react'
import { systemConfigAPI } from '../services/api'
import { Globe, RefreshCw, Shield, AlertCircle, CheckCircle } from 'lucide-react'

export default function DomainSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [domain, setDomain] = useState('')
  const [additionalDomains, setAdditionalDomains] = useState('')
  const [certificate, setCertificate] = useState<any>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const response = await systemConfigAPI.getConfig()
      const config = response.data.data.config
      const cert = response.data.data.certificate

      setDomain(config.DOMAIN || '')
      setCertificate(cert)
    } catch (error) {
      console.error('Failed to load config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setMessage(null)

      const domains = additionalDomains
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0)

      await systemConfigAPI.configureDomain(domain, domains)

      setMessage({
        type: 'success',
        text: 'Domain and CORS configured successfully! Please restart the server for changes to take effect.'
      })

      // Reload config to show updated values
      setTimeout(() => loadConfig(), 1000)
    } catch (error: any) {
      console.error('Failed to save domain config:', error)
      setMessage({
        type: 'error',
        text: error.response?.data?.detail || 'Failed to save configuration'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRegenerateCert = async () => {
    if (!confirm('Regenerate SSL certificate? This will require a server restart.')) return

    try {
      setSaving(true)
      setMessage(null)

      await systemConfigAPI.regenerateCertificate()

      setMessage({
        type: 'success',
        text: 'SSL certificate regenerated successfully! Please restart the server.'
      })

      // Reload config
      setTimeout(() => loadConfig(), 1000)
    } catch (error: any) {
      console.error('Failed to regenerate certificate:', error)
      setMessage({
        type: 'error',
        text: error.response?.data?.detail || 'Failed to regenerate certificate'
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 flex items-center space-x-2">
          <Globe className="w-5 h-5" />
          <span>Domain & Security</span>
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Configure your domain, CORS origins, and SSL certificates
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`rounded-md p-4 ${
          message.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400" />
            )}
            <p className={`ml-3 text-sm ${
              message.type === 'success' ? 'text-green-800' : 'text-red-800'
            }`}>
              {message.text}
            </p>
          </div>
        </div>
      )}

      {/* Domain Configuration */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Primary Domain
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="input-field"
            placeholder="example.com or 192.168.1.100"
          />
          <p className="mt-1 text-xs text-gray-500">
            Your primary domain or IP address. SSL certificate will be generated for this domain.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional Domains (Optional)
          </label>
          <input
            type="text"
            value={additionalDomains}
            onChange={(e) => setAdditionalDomains(e.target.value)}
            className="input-field"
            placeholder="app.example.com, 192.168.1.101"
          />
          <p className="mt-1 text-xs text-gray-500">
            Comma-separated list of additional domains/IPs. CORS will be automatically configured.
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !domain}
            className="btn-primary flex items-center space-x-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4" />
                <span>Save & Configure</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* SSL Certificate Info */}
      {certificate && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
              <Shield className="w-4 h-4" />
              <span>SSL Certificate</span>
            </h4>
            <button
              onClick={handleRegenerateCert}
              disabled={saving}
              className="btn-secondary text-xs flex items-center space-x-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Regenerate</span>
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subject:</span>
              <span className="text-gray-900 font-mono text-xs">{certificate.subject}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Valid From:</span>
              <span className="text-gray-900">{certificate.notBefore}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Valid Until:</span>
              <span className="text-gray-900">{certificate.notAfter}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Path:</span>
              <span className="text-gray-900 font-mono text-xs truncate max-w-xs" title={certificate.path}>
                {certificate.path}
              </span>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-md">
            <p className="text-xs text-blue-800">
              ℹ️ Self-signed certificate generated automatically. For production, use Let's Encrypt or a trusted CA.
            </p>
          </div>
        </div>
      )}

      {/* Auto-Configuration Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">Auto-Configuration</h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>✅ SSL certificates auto-generated on first startup</li>
          <li>✅ CORS automatically configured based on your domains</li>
          <li>✅ Environment variables updated in .env file</li>
          <li>✅ Localhost origins included for development</li>
          <li>⚠️ Server restart required after configuration changes</li>
        </ul>
      </div>
    </div>
  )
}

