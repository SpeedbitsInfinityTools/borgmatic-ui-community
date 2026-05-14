import React, { useEffect, useState } from 'react';
import {
    Server,
    Network,
    Trash2,
    KeyRound,
    Lock,
    Eye,
    EyeOff,
    Folder,
    Loader2,
    CheckCircle,
    AlertCircle,
    Info,
    X,
    Copy,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sshKeysAPI, repositoriesAPI, systemConfigAPI } from '../../services/api';
import SSHBrowserModal from '../repositories/SSHBrowserModal';

export interface SSHSourceCardProps {
    source: any;
    index: number;
    updateSource: (index: number, field: string, value: any) => void;
    trimSourceField: (index: number, field: string) => void;
    removeSource: (index: number) => void;
}

interface SshKeyOption {
    id: string | number;
    name: string;
    key_type: string;
    is_encrypted: boolean;
}

interface TestResult {
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
}

interface SshfsStatus {
    checked: boolean;
    available: boolean;
    error: string | null;
}

const DOCKER_FUSE_HINT = `# Add these to your borgmatic-ui container in docker-compose.yml:
services:
  borgmatic-ui:
    cap_add:
      - SYS_ADMIN
    devices:
      - /dev/fuse:/dev/fuse
    security_opt:
      - apparmor:unconfined
# And install sshfs in the image (Debian/Ubuntu):
#   apt-get install -y sshfs
# or (Alpine):
#   apk add --no-cache sshfs`;

const HOST_INSTALL_HINTS = [
    {
        id: 'debian',
        label: 'Debian / Ubuntu / WSL Ubuntu',
        command: 'sudo apt-get update && sudo apt-get install -y sshfs',
    },
    {
        id: 'alpine',
        label: 'Alpine',
        command: 'sudo apk add --no-cache sshfs fuse3',
    },
    {
        id: 'fedora',
        label: 'Fedora / RHEL / CentOS Stream',
        command: 'sudo dnf install -y fuse-sshfs',
    },
    {
        id: 'arch',
        label: 'Arch / Manjaro',
        command: 'sudo pacman -S --needed sshfs',
    },
    {
        id: 'opensuse',
        label: 'openSUSE',
        command: 'sudo zypper install sshfs',
    },
    {
        id: 'macos',
        label: 'macOS',
        command: 'brew install macfuse sshfs',
        note: 'macFUSE requires granting a system extension and usually a reboot.',
    },
];

const SSHSourceCard: React.FC<SSHSourceCardProps> = ({
    source,
    index,
    updateSource,
    trimSourceField,
    removeSource,
}) => {
    const [sshKeys, setSshKeys] = useState<SshKeyOption[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [showBrowser, setShowBrowser] = useState(false);
    const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
    const [sshfsStatus, setSshfsStatus] = useState<SshfsStatus>({ checked: false, available: true, error: null });
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [selectedHintId, setSelectedHintId] = useState('debian');
    const [showDockerHint, setShowDockerHint] = useState(false);
    const [recheckingSshfs, setRecheckingSshfs] = useState(false);

    useEffect(() => {
        sshKeysAPI.getSSHKeys()
            .then((res: any) => {
                const keys = res.data?.ssh_keys || res.data?.data?.ssh_keys || [];
                setSshKeys(keys);
            })
            .catch(() => setSshKeys([]));
    }, []);

    const probeSshfs = (refresh = false) => {
        // The backend caches the probe (positive: 5 min, negative: 10 s).
        // Pass refresh=true to force an immediate re-probe — used by the
        // "Re-check" button after the user installs sshfs on the host.
        return systemConfigAPI.getSshfsStatus(refresh)
            .then((res: any) => {
                const data = res.data?.data;
                setSshfsStatus({
                    checked: true,
                    available: !!data?.available,
                    error: data?.error || null,
                });
                return !!data?.available;
            })
            .catch(() => {
                setSshfsStatus({ checked: true, available: true, error: null });
                return true;
            });
    };

    useEffect(() => {
        // One-shot sshfs availability probe — surfaced as a banner so the
        // user knows what they need to install (or which Docker flags to
        // add) before saving the backup.
        probeSshfs(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRecheckSshfs = async () => {
        if (recheckingSshfs) return;
        setRecheckingSshfs(true);
        try {
            const ok = await probeSshfs(true);
            if (ok) {
                setBannerDismissed(false);
                toast.success('sshfs is now available on the backend');
            } else {
                toast.error('sshfs is still not available on the backend');
            }
        } finally {
            setRecheckingSshfs(false);
        }
    };

    const authMethod: 'key' | 'password' = source.auth_method === 'password' ? 'password' : 'key';
    const selectedKey = sshKeys.find((k) => String(k.id) === String(source.ssh_key_id));
    const selectableKeys = sshKeys.filter((k) => !k.is_encrypted);
    const selectedHint = HOST_INSTALL_HINTS.find((hint) => hint.id === selectedHintId) || HOST_INSTALL_HINTS[0];

    const copyToClipboard = async (value: string, successMessage: string) => {
        if (!navigator?.clipboard?.writeText) {
            toast.error('Clipboard API is not available in this browser context');
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            toast.success(successMessage);
        } catch {
            toast.error('Could not copy to clipboard');
        }
    };

    const handleTestConnection = async () => {
        const host = String(source.host || '').trim();
        const username = String(source.username || '').trim();
        const port = Number.isInteger(source.port) ? source.port : 22;

        if (!host || !username) {
            toast.error('Host and username are required to test the connection');
            return;
        }
        if (authMethod === 'key' && !source.ssh_key_id) {
            toast.error('Please select an SSH key first');
            return;
        }
        if (authMethod === 'key' && selectedKey?.is_encrypted) {
            toast.error('Encrypted SSH keys are not supported for sshfs source mounts yet');
            return;
        }
        if (authMethod === 'password' && !source.ssh_password) {
            toast.error('Please enter the SSH password first');
            return;
        }

        setTestResult({ status: 'testing', message: 'Connecting...' });
        try {
            // We exercise the same code path as the file browser: a successful
            // SFTP listing of the remote root proves credentials + connectivity
            // and works for both key auth and password auth in one call.
            const res: any = await repositoriesAPI.sshBrowse({
                host,
                port,
                username,
                ssh_key_id: authMethod === 'key' ? source.ssh_key_id : undefined,
                ssh_auth_method: authMethod,
                ssh_password: authMethod === 'password' ? source.ssh_password : undefined,
                remote_path: source.remote_path && source.remote_path.startsWith('/') ? source.remote_path : '/',
                use_sftp: false,
            });

            if (res.data?.success) {
                setTestResult({ status: 'success', message: 'Connection successful' });
            } else {
                throw new Error(res.data?.error || res.data?.detail || 'Connection failed');
            }
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Connection failed';
            setTestResult({ status: 'error', message: detail });
        }
    };

    const showBanner = sshfsStatus.checked && !sshfsStatus.available && !bannerDismissed;

    return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
            {showBanner && (
                <div className="mb-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold mb-1">sshfs is not available on the backend</p>
                        <p className="mb-2">
                            {sshfsStatus.error || 'Install sshfs on the machine/container running borgmatic before using SSH/SFTP sources.'}
                        </p>
                        <p className="mb-2 text-[11px] text-amber-800">
                            Install it on the host where borgmatic runs:
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {HOST_INSTALL_HINTS.map((hint) => (
                                <button
                                    key={hint.id}
                                    type="button"
                                    onClick={() => setSelectedHintId(hint.id)}
                                    className={`px-2 py-1 rounded border transition-colors ${
                                        selectedHintId === hint.id
                                            ? 'bg-amber-200 border-amber-400 text-amber-950'
                                            : 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'
                                    }`}
                                >
                                    {hint.label}
                                </button>
                            ))}
                        </div>
                        <pre className="bg-amber-100 border border-amber-200 rounded p-2 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words">{selectedHint.command}</pre>
                        {selectedHint.note && (
                            <p className="mt-1 text-[11px] text-amber-800">{selectedHint.note}</p>
                        )}
                        <p className="mt-1 text-[11px] text-amber-800">
                            WSL note: on some setups you may need <span className="font-mono">sudo modprobe fuse</span> and to add your user to the <span className="font-mono">fuse</span> group.
                        </p>
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <button
                                type="button"
                                onClick={() => copyToClipboard(selectedHint.command, 'Install command copied')}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 hover:text-amber-900 hover:underline"
                            >
                                <Copy className="w-3 h-3" /> Copy install command
                            </button>
                            <button
                                type="button"
                                onClick={handleRecheckSshfs}
                                disabled={recheckingSshfs}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-200 hover:bg-amber-300 border border-amber-400 rounded px-2 py-0.5 transition-colors disabled:opacity-60"
                                title="Re-check sshfs availability after installing it"
                            >
                                {recheckingSshfs ? (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin" /> Re-checking…
                                    </>
                                ) : (
                                    <>Re-check now</>
                                )}
                            </button>
                            <span className="text-[11px] text-amber-800">
                                After installing sshfs, click Re-check (no backend restart needed).
                            </span>
                        </div>

                        <div className="mt-3 border-t border-amber-300 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowDockerHint((v) => !v)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 hover:underline"
                            >
                                {showDockerHint ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                Running in Docker?
                            </button>
                            {showDockerHint && (
                                <div className="mt-2">
                                    <p className="mb-1 text-[11px] text-amber-800">
                                        Ensure your compose config includes FUSE flags and your image contains <span className="font-mono">sshfs</span>.
                                    </p>
                                    <pre className="bg-amber-100 border border-amber-200 rounded p-2 overflow-auto text-[11px] font-mono whitespace-pre">{DOCKER_FUSE_HINT}</pre>
                                    <p className="mt-1 text-[11px] text-amber-800">
                                        The project compose files now include these FUSE flags by default.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(DOCKER_FUSE_HINT, 'Docker snippet copied')}
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 hover:text-amber-900 hover:underline"
                                    >
                                        <Copy className="w-3 h-3" /> Copy Docker snippet
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setBannerDismissed(true)}
                        className="text-amber-600 hover:text-amber-800"
                        title="Dismiss"
                        aria-label="Dismiss sshfs warning"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="space-y-2">
                {/* Header row */}
                <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-teal-600 flex-shrink-0" />
                    <span className="text-sm font-semibold text-teal-800">SSH / SFTP Source</span>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => removeSource(index)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Remove"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                {/* Host / Port / Username */}
                <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-7">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Host *</label>
                        <input
                            type="text"
                            value={source.host || ''}
                            onChange={(e) => updateSource(index, 'host', e.target.value)}
                            onBlur={() => trimSourceField(index, 'host')}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="server.example.com"
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Port</label>
                        <input
                            type="number"
                            value={source.port || 22}
                            onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                updateSource(index, 'port', Number.isNaN(v) ? 22 : v);
                            }}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="22"
                            min={1}
                            max={65535}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Username *</label>
                        <input
                            type="text"
                            value={source.username || ''}
                            onChange={(e) => updateSource(index, 'username', e.target.value)}
                            onBlur={() => trimSourceField(index, 'username')}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="user"
                        />
                    </div>
                </div>

                {/* Auth method */}
                <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Authentication</label>
                        <div className="flex bg-gray-100 rounded p-0.5">
                            <button
                                type="button"
                                onClick={() => updateSource(index, 'auth_method', 'key')}
                                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${authMethod === 'key' ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                            >
                                <KeyRound className="w-3 h-3" /> SSH Key
                            </button>
                            <button
                                type="button"
                                onClick={() => updateSource(index, 'auth_method', 'password')}
                                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${authMethod === 'password' ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                            >
                                <Lock className="w-3 h-3" /> Password
                            </button>
                        </div>
                    </div>

                    {authMethod === 'key' ? (
                        <div className="col-span-8">
                            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">SSH Key *</label>
                            <select
                                value={source.ssh_key_id || ''}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    const parsed = v ? (Number.isNaN(Number(v)) ? v : Number(v)) : null;
                                    updateSource(index, 'ssh_key_id', parsed);
                                }}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                            >
                                <option value="">Select an SSH key…</option>
                                {selectableKeys.map((k) => (
                                    <option key={k.id} value={k.id}>
                                        {k.name} ({k.key_type})
                                    </option>
                                ))}
                            </select>
                            {selectableKeys.length === 0 && (
                                <p className="mt-1 text-[11px] text-gray-500">
                                    No usable SSH keys yet. Add an unencrypted key under <span className="font-medium">SSH Keys</span> in the sidebar.
                                </p>
                            )}
                            {sshKeys.some((k) => k.is_encrypted) && (
                                <p className="mt-1 text-[11px] text-amber-700">
                                    Encrypted keys are hidden for SSH/SFTP sources currently; use password auth or add an unencrypted key for sshfs mounting.
                                </p>
                            )}
                            {selectedKey?.is_encrypted && (
                                <p className="mt-1 text-[11px] text-amber-700">
                                    Encrypted private keys are not yet supported for sshfs mounts. Use an unencrypted key or password auth.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="col-span-8">
                            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">SSH Password *</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={source.ssh_password || ''}
                                    onChange={(e) => updateSource(index, 'ssh_password', e.target.value)}
                                    className="w-full px-2 py-1 pr-8 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                    placeholder="Enter SSH password"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    title={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">Stored encrypted in the password vault.</p>
                        </div>
                    )}
                </div>

                {/* Remote path + browse */}
                <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Remote Path *</label>
                    <div className="flex gap-1">
                        <input
                            type="text"
                            value={source.remote_path || ''}
                            onChange={(e) => updateSource(index, 'remote_path', e.target.value)}
                            onBlur={() => trimSourceField(index, 'remote_path')}
                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="/path/on/remote/server"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                if (!source.host || !source.username) {
                                    toast.error('Enter host and username before browsing');
                                    return;
                                }
                                if (authMethod === 'key' && !source.ssh_key_id) {
                                    toast.error('Select an SSH key before browsing');
                                    return;
                                }
                                if (authMethod === 'key' && selectedKey?.is_encrypted) {
                                    toast.error('Encrypted SSH keys are not supported for sshfs source mounts yet');
                                    return;
                                }
                                if (authMethod === 'password' && !source.ssh_password) {
                                    toast.error('Enter the SSH password before browsing');
                                    return;
                                }
                                setShowBrowser(true);
                            }}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 transition-colors flex items-center gap-1"
                            title="Browse remote folders"
                        >
                            <Folder className="w-3.5 h-3.5" /> Browse
                        </button>
                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={testResult.status === 'testing'}
                            className="px-2 py-1 text-xs bg-teal-50 text-teal-700 rounded border border-teal-300 hover:bg-teal-100 transition-colors flex items-center gap-1 disabled:opacity-60"
                            title="Test SSH/SFTP connectivity"
                        >
                            {testResult.status === 'testing' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Network className="w-3.5 h-3.5" />
                            )}
                            <span>Test Connection</span>
                        </button>
                    </div>
                </div>

                {/* Test result */}
                {testResult.status === 'success' && (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{testResult.message}</span>
                    </div>
                )}
                {testResult.status === 'error' && (
                    <div className="flex items-start gap-2 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{testResult.message}</span>
                    </div>
                )}

                {/* Mount-mode info */}
                <div className="flex items-start gap-2 px-2 py-2 bg-teal-50 border border-teal-200 rounded text-[11px] text-teal-800">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p>
                            The remote folder is <span className="font-semibold">temporarily sshfs-mounted</span> only while the backup runs and unmounted right after. <span className="font-semibold">If the mount fails, the backup fails</span> — files won&rsquo;t be silently skipped.
                        </p>
                        <p className="mt-1 text-teal-700">
                            For an always-on remote folder, use the <span className="font-semibold">Rclone UI</span> app and add the resulting folder as a Local Directory.
                        </p>
                    </div>
                </div>
            </div>

            <SSHBrowserModal
                isOpen={showBrowser}
                host={source.host || ''}
                port={Number.isInteger(source.port) ? source.port : 22}
                username={source.username || ''}
                sshKeyId={authMethod === 'key' ? (source.ssh_key_id || undefined) : undefined}
                sshAuthMethod={authMethod}
                sshPassword={authMethod === 'password' ? source.ssh_password : undefined}
                currentPath={source.remote_path || undefined}
                onSelectPath={(p) => {
                    updateSource(index, 'remote_path', p);
                    setShowBrowser(false);
                }}
                onClose={() => setShowBrowser(false)}
                title="Select Remote Folder to Back Up"
            />
        </div>
    );
};

export default SSHSourceCard;
