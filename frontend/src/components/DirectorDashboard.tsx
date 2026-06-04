import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import {
  Monitor,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Activity,
  Users,
  ArrowRight,
} from 'lucide-react';
import { directorAPI, vaultAPI } from '../services/api';
import { formatDateTime } from '../utils/dateFormat';
import VaultSetupModal from './VaultSetupModal';
import { useDirector } from '../contexts/DirectorContext';

// Maps a raw event_type to a colour + short label for the activity feed.
function classifyEvent(eventType: string, severity?: string) {
  const t = (eventType || '').toLowerCase();
  if (severity === 'error' || /failed|error/.test(t)) {
    return { tone: 'red' as const, label: 'Failed' };
  }
  if (/completed|success/.test(t)) {
    return { tone: 'green' as const, label: 'Completed' };
  }
  if (/started/.test(t)) {
    return { tone: 'blue' as const, label: 'Started' };
  }
  return { tone: 'gray' as const, label: t || 'event' };
}

const toneClasses: Record<'red' | 'green' | 'blue' | 'gray' | 'amber', string> = {
  red: 'bg-red-100 text-red-700 border border-red-200',
  green: 'bg-green-100 text-green-700 border border-green-200',
  blue: 'bg-blue-100 text-blue-700 border border-blue-200',
  gray: 'bg-gray-100 text-gray-700 border border-gray-200',
  amber: 'bg-amber-100 text-amber-700 border border-amber-200',
};

export default function DirectorDashboard() {
  // Manual dismissal flag: lets the operator (in practice: us during testing) close the
  // modal locally without server confirmation, e.g. after a successful initialization
  // where the optimistic close should not be undone by an in-flight `/vault/status` poll.
  const [vaultDismissed, setVaultDismissed] = useState(false);
  const { selectClientWithPulse } = useDirector();
  const queryClient = useQueryClient();

  // Open a remote session against the chosen client. Renamed from "View" → "Start
  // Session" to match the new Clients page and reflect what the action actually does.
  const handleStartSession = (client: any) => {
    selectClientWithPulse({
      client_id: client.client_id,
      client_name: client.client_name,
      status: 'connected',
      is_connected: true,
      ip_address: client.ip_address,
      ip_locked: client.ip_locked || false,
      last_seen: client.last_seen,
    });
  };

  // First-run vault setup. Backed by react-query so the result is cached and shared
  // across renders, and so the modal's visibility is derived from data — not from a
  // local boolean that depends on a one-shot effect. The old implementation set
  // `showVaultSetup=true` in a `useEffect` and rendered the modal *inside* the loading
  // branch below, which meant the modal got unmounted every time the heartbeat-driven
  // fleet/clients refetch briefly produced an isLoading+no-data window. Result: the
  // splash flickered open/closed every ~10 s. Reactive state fixes this for good.
  //
  // staleTime is generous because vault state changes only on explicit initialize.
  const { data: vaultStatusData } = useQuery(
    ['vault-status'],
    () => vaultAPI.getStatus().then(res => res.data?.data),
    {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    }
  );
  const vaultInitialized = vaultStatusData?.initialized === true;
  const showVaultSetup = vaultStatusData !== undefined && !vaultInitialized && !vaultDismissed;

  // If the operator dismissed the modal locally but the vault becomes uninitialized
  // again (e.g. they Reset Vault elsewhere), allow the splash to come back.
  useEffect(() => {
    if (vaultInitialized) setVaultDismissed(false);
  }, [vaultInitialized]);

  const { data: clientsData, isLoading: clientsLoading, refetch: refetchClients } = useQuery({
    queryKey: ['director-clients'],
    queryFn: () => directorAPI.getClients().then(res => res.data),
    refetchInterval: 10000,
  });

  const { data: fleetData, isLoading: fleetLoading, refetch: refetchFleet } = useQuery({
    queryKey: ['director-fleet-health', 24],
    queryFn: () => directorAPI.getFleetHealth(24).then(res => res.data),
    refetchInterval: 15000,
  });

  const isLoading = clientsLoading || fleetLoading;

  const clients = clientsData?.data?.categorized || { connected: [], disconnected: [] };
  const summary = clientsData?.data?.summary || { total: 0, connected: 0, disconnected: 0 };
  const fleet = fleetData?.data;
  const fleetSummary = fleet?.summary;
  const problemClients: any[] = fleet?.problem_clients || [];
  const recentActivity: any[] = fleet?.recent_activity || [];

  // IMPORTANT: render the blocking vault-setup modal *before* any early-return so it
  // stays mounted regardless of whether the dashboard body is currently showing the
  // loading spinner or the full content. Hoisting fixes the open/close flicker that
  // happened when the heartbeat refetch briefly produced an isLoading+no-data window.
  const vaultModalNode = showVaultSetup ? (
    <VaultSetupModal
      onComplete={() => {
        // Optimistic dismissal + cache refresh so the next render sees initialized=true
        // and the splash stays gone even before the user navigates away and back.
        setVaultDismissed(true);
        queryClient.invalidateQueries(['vault-status']);
      }}
    />
  ) : null;

  if (isLoading && !clientsData && !fleetData) {
    return (
      <>
        {vaultModalNode}
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      </>
    );
  }

  return (
    <>
      {vaultModalNode}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Director Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">
              Fleet health and live client sessions. Manage individual clients on the{' '}
              <Link to="/clients" className="text-blue-600 hover:underline font-medium">Clients</Link> page.
            </p>
          </div>
          <button
            onClick={() => { refetchClients(); refetchFleet(); }}
            className="btn-secondary flex items-center space-x-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Fleet Health summary — five at-a-glance numbers driven by real notification data */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryCard
            label="Total"
            value={summary.total}
            icon={<Monitor className="h-5 w-5" />}
            tone="blue"
          />
          <SummaryCard
            label="Connected"
            value={summary.connected}
            icon={<CheckCircle className="h-5 w-5" />}
            tone="green"
          />
          <SummaryCard
            label="Failing (24h)"
            value={fleetSummary?.failing_clients ?? 0}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={fleetSummary?.failing_clients ? 'red' : 'gray'}
          />
          <SummaryCard
            label="Healthy (24h)"
            value={fleetSummary?.healthy_clients ?? 0}
            icon={<CheckCircle className="h-5 w-5" />}
            tone="green"
          />
          <SummaryCard
            label="Quiet (24h)"
            value={fleetSummary?.quiet_clients ?? 0}
            icon={<Monitor className="h-5 w-5" />}
            tone="gray"
            help="No backup activity in the window"
          />
        </div>

        {/* Two-column: problem clients (left) + recent activity (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProblemClientsPanel
            problemClients={problemClients}
            onStartSession={handleStartSession}
          />
          <RecentActivityPanel events={recentActivity} />
        </div>

        {/* Currently connected — kept compact since the full roster lives on Clients page */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200 bg-green-50 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-green-900 flex items-center">
              <CheckCircle className="w-5 h-5 mr-2" />
              Currently Connected ({clients.connected.length})
            </h2>
            <Link
              to="/clients"
              className="text-sm font-medium text-blue-700 hover:text-blue-900 inline-flex items-center"
            >
              All clients <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          {clients.connected.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No clients are currently connected.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Backups</th>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Repos</th>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                    <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Backup</th>
                    <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {clients.connected.map((client: any) => {
                    const lastEv = client.last_backup_event;
                    const cls = lastEv ? classifyEvent(lastEv.event_type, lastEv.severity) : null;
                    return (
                      <tr key={client.client_id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                            <span className="font-medium text-gray-900">{client.client_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap font-mono text-xs text-gray-700">{client.ip_address}</td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{client.metadata?.backups_count ?? 0}</td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{client.metadata?.repos_count ?? 0}</td>
                        <td className="px-6 py-3 whitespace-nowrap text-xs text-gray-600">{formatDateTime(client.last_seen)}</td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          {cls ? (
                            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${toneClasses[cls.tone]}`} title={lastEv.message || ''}>
                              {cls.label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">no events</span>
                          )}
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-right">
                          <button
                            onClick={() => handleStartSession(client)}
                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                            title="Open a remote session against this client"
                          >
                            <ExternalLink className="w-4 h-4 mr-1.5" />
                            Start Session
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  label, value, icon, tone, help,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'blue' | 'green' | 'red' | 'gray';
  help?: string;
}) {
  const palette: Record<typeof tone, string> = {
    blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-900',
    green: 'from-green-50 to-green-100 border-green-200 text-green-900',
    red: 'from-red-50 to-red-100 border-red-200 text-red-900',
    gray: 'from-gray-50 to-gray-100 border-gray-200 text-gray-700',
  };
  const iconTone: Record<typeof tone, string> = {
    blue: 'text-blue-500',
    green: 'text-green-500',
    red: 'text-red-500',
    gray: 'text-gray-400',
  };
  return (
    <div
      className={`card bg-gradient-to-br ${palette[tone]} px-4 py-3`}
      title={help}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xs font-medium uppercase tracking-wide opacity-80`}>{label}</p>
          <p className="mt-1 text-2xl font-bold leading-none">{value}</p>
        </div>
        <div className={`flex-shrink-0 ${iconTone[tone]}`}>{icon}</div>
      </div>
    </div>
  );
}

function ProblemClientsPanel({
  problemClients, onStartSession,
}: {
  problemClients: any[];
  onStartSession: (c: any) => void;
}) {
  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200 bg-red-50 flex items-center">
        <AlertTriangle className="w-5 h-5 mr-2 text-red-700" />
        <h2 className="text-lg font-semibold text-red-900">
          Problem Clients{' '}
          <span className="text-sm font-normal text-red-700">(last 24h)</span>
        </h2>
      </div>
      {problemClients.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
          No failures in the last 24 hours.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {problemClients.slice(0, 8).map(c => (
            <li key={c.client_id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{c.client_name}</span>
                  {!c.is_connected && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">offline</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <span className="text-red-700 font-semibold">{c.runs_failed} failed</span>
                  {c.runs_succeeded > 0 && <span className="ml-2 text-green-700">{c.runs_succeeded} ok</span>}
                  {c.last_failure?.timestamp && <span className="ml-2">· {formatDateTime(c.last_failure.timestamp)}</span>}
                </div>
                {c.last_failure?.message && (
                  <div className="text-xs text-gray-500 mt-0.5 truncate" title={c.last_failure.message}>
                    {c.last_failure.message}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {c.is_connected ? (
                  <button
                    onClick={() => onStartSession(c)}
                    className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    title="Start a remote session to investigate"
                  >
                    Start Session
                  </button>
                ) : null}
                <Link
                  to={`/clients?focus=${c.client_id}`}
                  className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Details
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentActivityPanel({ events }: { events: any[] }) {
  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center">
        <Activity className="w-5 h-5 mr-2 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-800">Recent Activity</h2>
      </div>
      {events.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          No client events received yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 max-h-[420px] overflow-y-auto">
          {events.slice(0, 30).map((e, i) => {
            const cls = classifyEvent(e.event_type, e.severity);
            return (
              <li key={`${e.client_id}-${i}-${e.timestamp}`} className="px-6 py-2.5 flex items-start gap-3 hover:bg-gray-50">
                <span className={`mt-0.5 inline-flex px-2 py-0.5 text-[10px] font-semibold rounded ${toneClasses[cls.tone]} flex-shrink-0`}>
                  {cls.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 truncate">
                    <span className="font-medium">{e.client_name}</span>
                    {e.backup_name && <span className="text-gray-500"> · {e.backup_name}</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDateTime(e.timestamp)}
                  </div>
                  {e.message && (
                    <div className="text-xs text-gray-600 mt-0.5 line-clamp-2" title={e.message}>
                      {e.message}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
