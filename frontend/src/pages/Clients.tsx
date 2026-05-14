import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from 'react-query'
import { toast } from 'react-hot-toast'
import {
  Users,
  RefreshCw,
  ExternalLink,
  Pencil,
  KeyRound,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  LayoutGrid,
  List,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { directorAPI } from '../services/api'
import { useDirector } from '../contexts/DirectorContext'
import { formatDateTime } from '../utils/dateFormat'

// One row from the director's `/clients` API. Loosely typed because additional fields
// arrive as the rest of the system is upgraded — keeping it permissive lets new fields
// surface without breaking the page.
interface Client {
  client_id: string
  client_name: string
  hostname?: string
  platform?: string
  version?: string
  ip_address?: string
  ip_locked?: boolean
  is_connected: boolean
  last_seen?: string
  first_seen?: string
  status?: string
  health?: 'healthy' | 'failing' | 'unknown' | string
  last_backup_event?: {
    event_type?: string
    severity?: string
    backup_name?: string | null
    repository?: string | null
    message?: string
    at?: string
  }
  metadata?: { backups_count?: number; repos_count?: number; [k: string]: any }
}

function classifyHealth(client: Client): { tone: 'green' | 'red' | 'amber' | 'gray'; label: string; hint?: string } {
  if (client.health === 'failing') return { tone: 'red', label: 'Failing', hint: 'Most recent backup event was a failure' }
  if (client.health === 'healthy') return { tone: 'green', label: 'Healthy', hint: 'Most recent backup completed successfully' }
  const ev = client.last_backup_event?.event_type || ''
  if (/failed|error/i.test(ev) || client.last_backup_event?.severity === 'error') return { tone: 'red', label: 'Failing' }
  if (/completed|success/i.test(ev)) return { tone: 'green', label: 'Healthy' }
  return { tone: 'gray', label: 'Unknown', hint: 'No backup events received yet' }
}

const tonePill: Record<'green' | 'red' | 'amber' | 'gray', string> = {
  green: 'bg-green-100 text-green-700 border border-green-200',
  red: 'bg-red-100 text-red-700 border border-red-200',
  amber: 'bg-amber-100 text-amber-700 border border-amber-200',
  gray: 'bg-gray-100 text-gray-700 border border-gray-200',
}

export default function Clients() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { isDirectorMode, isLoading: directorLoading, selectClientWithPulse } = useDirector()

  const [viewMode, setViewMode] = useState<'cards' | 'list'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [tokenDialog, setTokenDialog] = useState<{ client: Client; token: string } | null>(null)

  // Director-only page. Standalone/client-mode users get bounced to the dashboard.
  useEffect(() => {
    if (!directorLoading && !isDirectorMode) {
      navigate('/dashboard', { replace: true })
    }
  }, [directorLoading, isDirectorMode, navigate])

  // Optional ?focus=<client_id> query (Dashboard's "Details" link) — scrolls into view.
  const focusId = useMemo(() => new URLSearchParams(location.search).get('focus'), [location.search])

  const { data: clientsData, isLoading, refetch } = useQuery({
    queryKey: ['director-clients'],
    queryFn: () => directorAPI.getClients().then(res => res.data),
    refetchInterval: 10000,
    enabled: isDirectorMode,
  })

  const clients: Client[] = clientsData?.data?.clients || []

  const updateMutation = useMutation({
    mutationFn: ({ clientId, data }: { clientId: string; data: any }) => directorAPI.updateClient(clientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['director-clients'] })
      toast.success('Client updated')
      setEditingId(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to update client'),
  })

  const removeMutation = useMutation({
    mutationFn: (clientId: string) => directorAPI.rejectClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['director-clients'] })
      toast.success('Client removed')
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to remove client'),
  })

  const rotateTokenMutation = useMutation({
    mutationFn: (clientId: string) => directorAPI.rotateClientToken(clientId),
    onSuccess: (res, clientId) => {
      const client = clients.find(c => c.client_id === clientId)
      const newToken: string = res?.data?.data?.per_client_token || ''
      if (!client || !newToken) {
        toast.error('Token rotated but the new token was not returned. Try again.')
        return
      }
      setTokenDialog({ client, token: newToken })
      queryClient.invalidateQueries({ queryKey: ['director-clients'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to rotate token'),
  })

  const handleStartSession = (client: Client) => {
    if (!client.is_connected) {
      toast.error('Client is not currently connected')
      return
    }
    selectClientWithPulse({
      client_id: client.client_id,
      client_name: client.client_name,
      status: 'connected',
      is_connected: true,
      ip_address: client.ip_address,
      ip_locked: client.ip_locked || false,
      last_seen: client.last_seen,
    })
  }

  const handleStartEdit = (client: Client) => {
    setEditingId(client.client_id)
    setEditingName(client.client_name)
  }
  const handleSaveEdit = () => {
    if (!editingId) return
    const trimmed = editingName.trim()
    if (!trimmed) { toast.error('Name cannot be empty'); return }
    updateMutation.mutate({ clientId: editingId, data: { client_name: trimmed } })
  }

  const handleRotateToken = (client: Client) => {
    if (!confirm(
      `Rotate the per-client connection token for "${client.client_name}"?\n\n` +
      `The client will be disconnected and will not be able to reconnect until you ` +
      `paste the new token into its Settings → Client Configuration → Connection Token.`
    )) return
    rotateTokenMutation.mutate(client.client_id)
  }

  const handleRemove = (client: Client) => {
    if (!confirm(
      `Remove "${client.client_name}" from this director?\n\n` +
      `Its record (including the per-client token) will be deleted. ` +
      `If the client still has the bootstrap token it could re-register; rotate the bootstrap token from Settings if you want to fully revoke access.`
    )) return
    removeMutation.mutate(client.client_id)
  }

  if (directorLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  // Sort: connected first, then by name. Within each group, problem clients bubble up.
  const sorted = [...clients].sort((a, b) => {
    if (a.is_connected !== b.is_connected) return a.is_connected ? -1 : 1
    const aFail = a.health === 'failing' ? -1 : 0
    const bFail = b.health === 'failing' ? -1 : 0
    if (aFail !== bFail) return aFail - bFail
    return (a.client_name || '').localeCompare(b.client_name || '')
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-blue-600" />
            Clients
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Administration of every backup client this director knows about. Dashboard shows fleet health; this page is the per-client editor.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {clients.length > 0 && (
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-2 py-1 rounded ${viewMode === 'cards' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                title="Cards view"
                aria-label="Cards view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 rounded ${viewMode === 'list' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                title="List view"
                aria-label="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No clients have registered with this director yet.</p>
          <p className="text-sm text-gray-500 mt-1">
            Hand the bootstrap connection token (Settings → Connection Configuration) to a client instance to get started.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(client => (
            <ClientCard
              key={client.client_id}
              client={client}
              focused={focusId === client.client_id}
              editing={editingId === client.client_id}
              editingName={editingName}
              setEditingName={setEditingName}
              onStartEdit={() => handleStartEdit(client)}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
              onStartSession={() => handleStartSession(client)}
              onRotateToken={() => handleRotateToken(client)}
              onRemove={() => handleRemove(client)}
              busy={updateMutation.isLoading || rotateTokenMutation.isLoading || removeMutation.isLoading}
            />
          ))}
        </div>
      ) : (
        <ClientsTable
          clients={sorted}
          focusId={focusId}
          editingId={editingId}
          editingName={editingName}
          setEditingName={setEditingName}
          onStartEdit={handleStartEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setEditingId(null)}
          onStartSession={handleStartSession}
          onRotateToken={handleRotateToken}
          onRemove={handleRemove}
        />
      )}

      {tokenDialog && (
        <TokenDisplayModal
          client={tokenDialog.client}
          token={tokenDialog.token}
          onClose={() => setTokenDialog(null)}
        />
      )}
    </div>
  )
}

// ----- Card view -----
function ClientCard({
  client, focused, editing, editingName, setEditingName,
  onStartEdit, onSaveEdit, onCancelEdit,
  onStartSession, onRotateToken, onRemove, busy,
}: {
  client: Client
  focused: boolean
  editing: boolean
  editingName: string
  setEditingName: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartSession: () => void
  onRotateToken: () => void
  onRemove: () => void
  busy: boolean
}) {
  const health = classifyHealth(client)
  return (
    <div
      id={`client-${client.client_id}`}
      className={`card p-4 flex flex-col gap-3 ${focused ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="input text-sm py-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
              />
              <button onClick={onSaveEdit} className="btn-primary text-xs px-2 py-1" disabled={busy}>Save</button>
              <button onClick={onCancelEdit} className="btn-secondary text-xs px-2 py-1" disabled={busy}>Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900 truncate" title={client.client_name}>
                {client.client_name}
              </h3>
              <button
                onClick={onStartEdit}
                className="text-gray-400 hover:text-blue-600"
                title="Rename"
                aria-label="Rename client"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="text-xs text-gray-500 truncate font-mono mt-0.5">{client.client_id}</div>
        </div>
        <ConnectionPill connected={client.is_connected} />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Field label="Hostname" value={client.hostname || '—'} mono />
        <Field label="OS" value={client.platform || '—'} />
        <Field label="IP" value={client.ip_address || '—'} mono />
        <Field label="Version" value={client.version || '—'} />
        <Field label="Backups" value={String(client.metadata?.backups_count ?? 0)} />
        <Field label="Repos" value={String(client.metadata?.repos_count ?? 0)} />
        <Field label="Last seen" value={client.last_seen ? formatDateTime(client.last_seen) : '—'} />
        <Field label="First seen" value={client.first_seen ? formatDateTime(client.first_seen) : '—'} />
      </dl>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded ${tonePill[health.tone]}`} title={health.hint}>
          {health.label}
        </span>
        {client.last_backup_event?.message && (
          <span className="text-[11px] text-gray-500 truncate ml-2" title={client.last_backup_event.message}>
            {client.last_backup_event.message}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          onClick={onStartSession}
          disabled={!client.is_connected || busy}
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title={client.is_connected ? 'Open a remote session' : 'Client is not connected'}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Start Session
        </button>
        <button
          onClick={onRotateToken}
          disabled={busy}
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded text-amber-700 bg-amber-50 hover:bg-amber-100"
          title="Rotate this client's per-client token"
        >
          <KeyRound className="w-3.5 h-3.5 mr-1" /> Rotate Token
        </button>
        <button
          onClick={onRemove}
          disabled={busy}
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded text-red-700 bg-red-50 hover:bg-red-100 ml-auto"
          title="Remove from director"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
        </button>
      </div>
    </div>
  )
}

// ----- List view -----
function ClientsTable({
  clients, focusId, editingId, editingName, setEditingName,
  onStartEdit, onSaveEdit, onCancelEdit,
  onStartSession, onRotateToken, onRemove,
}: {
  clients: Client[]
  focusId: string | null
  editingId: string | null
  editingName: string
  setEditingName: (v: string) => void
  onStartEdit: (c: Client) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartSession: (c: Client) => void
  onRotateToken: (c: Client) => void
  onRemove: (c: Client) => void
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <Th>Client</Th>
            <Th>Host / OS</Th>
            <Th>IP</Th>
            <Th>Status</Th>
            <Th>Backup health</Th>
            <Th>Last seen</Th>
            <Th>Backups / Repos</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {clients.map(c => {
            const health = classifyHealth(c)
            const editing = editingId === c.client_id
            return (
              <tr
                key={c.client_id}
                id={`client-${c.client_id}`}
                className={`hover:bg-gray-50 ${focusId === c.client_id ? 'bg-blue-50' : ''} ${!c.is_connected ? 'opacity-70' : ''}`}
              >
                <td className="px-4 py-2 align-top">
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="input text-sm py-1 w-40"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
                      />
                      <button onClick={onSaveEdit} className="btn-primary text-xs px-2 py-1">Save</button>
                      <button onClick={onCancelEdit} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-900 truncate" title={c.client_name}>{c.client_name}</span>
                      <button
                        onClick={() => onStartEdit(c)}
                        className="text-gray-400 hover:text-blue-600"
                        title="Rename"
                        aria-label="Rename client"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 font-mono truncate" title={c.client_id}>{c.client_id}</div>
                </td>
                <td className="px-4 py-2 align-top text-xs text-gray-700">
                  <div className="font-mono truncate max-w-[14rem]" title={c.hostname}>{c.hostname || '—'}</div>
                  <div className="text-gray-500">{c.platform || '—'}{c.version ? ` · v${c.version}` : ''}</div>
                </td>
                <td className="px-4 py-2 align-top text-xs font-mono text-gray-700">{c.ip_address || '—'}</td>
                <td className="px-4 py-2 align-top">
                  <ConnectionPill connected={c.is_connected} />
                </td>
                <td className="px-4 py-2 align-top">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded ${tonePill[health.tone]}`}
                    title={c.last_backup_event?.message || health.hint || ''}
                  >
                    {health.label}
                  </span>
                  {c.last_backup_event?.backup_name && (
                    <div className="text-[11px] text-gray-500 truncate mt-0.5 max-w-[14rem]" title={c.last_backup_event.backup_name}>
                      {c.last_backup_event.backup_name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 align-top text-xs text-gray-600">{c.last_seen ? formatDateTime(c.last_seen) : '—'}</td>
                <td className="px-4 py-2 align-top text-xs text-gray-700 whitespace-nowrap">
                  {c.metadata?.backups_count ?? 0} / {c.metadata?.repos_count ?? 0}
                </td>
                <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => onStartSession(c)}
                      disabled={!c.is_connected}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium rounded text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={c.is_connected ? 'Start a remote session' : 'Client is offline'}
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Session
                    </button>
                    <button
                      onClick={() => onRotateToken(c)}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium rounded text-amber-700 bg-amber-50 hover:bg-amber-100"
                      title="Rotate per-client token"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemove(c)}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium rounded text-red-700 bg-red-50 hover:bg-red-100"
                      title="Remove client"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ----- Bits -----
function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left'
  return (
    <th className={`px-4 py-2 ${alignClass} text-xs font-medium text-gray-500 uppercase`}>{children}</th>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-gray-800 truncate ${mono ? 'font-mono' : ''}`} title={value}>{value}</dd>
    </>
  )
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-700 border border-green-200">
      <Wifi className="w-3 h-3 mr-1" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-600 border border-gray-200">
      <WifiOff className="w-3 h-3 mr-1" /> Offline
    </span>
  )
}

// One-time-display modal for a freshly rotated per-client token.
function TokenDisplayModal({
  client, token, onClose,
}: {
  client: Client
  token: string
  onClose: () => void
}) {
  const [revealed, setRevealed] = useState(true)
  const [copied, setCopied] = useState(false)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <div className="flex items-start gap-3 mb-3">
          <div className="bg-amber-100 text-amber-700 rounded-full p-2">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">New token for {client.client_name}</h3>
            <p className="text-sm text-gray-600 mt-1">
              The client has been disconnected. Paste this token into its
              <strong> Settings → Client Configuration → Connection Token</strong> to allow it to reconnect.
              <span className="block mt-1 text-amber-700 font-medium">This is the only time it will be shown.</span>
            </p>
          </div>
        </div>

        <div className="relative">
          <input
            readOnly
            type={revealed ? 'text' : 'password'}
            value={token}
            className="input font-mono text-xs w-full pr-20"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-1 gap-1">
            <button
              onClick={() => setRevealed(v => !v)}
              className="p-1 text-gray-500 hover:text-gray-800"
              title={revealed ? 'Hide' : 'Reveal'}
              aria-label={revealed ? 'Hide token' : 'Reveal token'}
            >
              {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                } catch { /* ignore */ }
              }}
              className="p-1 text-gray-500 hover:text-gray-800"
              title="Copy"
              aria-label="Copy token"
            >
              {copied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="btn-primary px-4 py-2">I've saved it</button>
        </div>
      </div>
    </div>
  )
}
