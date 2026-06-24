import React, { useEffect, useState } from 'react';
import {
    Server,
    Trash2,
    KeyRound,
    Lock,
    Eye,
    EyeOff,
    Folder,
    Loader2,
    CheckCircle,
    AlertCircle,
    Network,
    Plus,
    Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sshKeysAPI, repositoriesAPI } from '../../services/api';
import SSHBrowserModal from '../repositories/SSHBrowserModal';
import SshfsStatusBanner from './SshfsStatusBanner';

/**
 * Cosmetic grouping card for SSH/SFTP sources that share the SAME connection
 * (host + port + username + auth method/key). The underlying data model is
 * unchanged: every path is still its own independent `type: 'ssh'` source. This
 * card just renders the shared connection ONCE and lists the per-path sources so
 * they can be edited or removed individually (and new paths added to the same
 * server).
 */

export interface SSHServerGroupMember {
    source: any;
    index: number;
}

export interface SSHServerGroupCardProps {
    members: SSHServerGroupMember[];
    updateSource: (index: number, field: string, value: any) => void;
    trimSourceField: (index: number, field: string) => void;
    removeSource: (index: number) => void;
    formData: any;
    setFormData: (fd: any) => void;
}

interface SshKeyOption {
    id: string | number;
    name: string;
    key_type: string;
    is_encrypted: boolean;
}

const SSHServerGroupCard: React.FC<SSHServerGroupCardProps> = ({
    members,
    updateSource,
    trimSourceField,
    removeSource,
    formData,
    setFormData,
}) => {
    const [sshKeys, setSshKeys] = useState<SshKeyOption[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [browsingIndex, setBrowsingIndex] = useState<number | null>(null);
    const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({ status: 'idle', message: '' });

    useEffect(() => {
        sshKeysAPI.getSSHKeys()
            .then((res: any) => {
                const keys = res.data?.ssh_keys || res.data?.data?.ssh_keys || [];
                setSshKeys(keys);
            })
            .catch(() => setSshKeys([]));
    }, []);

    // The representative source carries the shared connection for the group.
    const rep = members[0]?.source || {};
    const authMethod: 'key' | 'password' = rep.auth_method === 'password' ? 'password' : 'key';
    const useSftp = rep.use_sftp !== false;
    const selectedKey = sshKeys.find((k) => String(k.id) === String(rep.ssh_key_id));
    const selectableKeys = sshKeys.filter((k) => !k.is_encrypted);

    // Connection edits apply to every path that shares this server.
    const updateAll = (field: string, value: any) => {
        members.forEach(({ index }) => updateSource(index, field, value));
    };
    const trimAll = (field: string) => {
        members.forEach(({ index }) => trimSourceField(index, field));
    };

    const resetTest = () => setTestResult({ status: 'idle', message: '' });

    // Switch auth method for the whole group and clear the credential that no
    // longer applies, so stale secrets don't linger in the form/source objects.
    const setAuthMethod = (method: 'key' | 'password') => {
        members.forEach(({ index }) => {
            updateSource(index, 'auth_method', method);
            if (method === 'key') {
                updateSource(index, 'ssh_password', '');
            } else {
                updateSource(index, 'ssh_key_id', null);
            }
        });
        resetTest();
    };

    const addPath = () => {
        const base = {
            type: 'ssh',
            host: rep.host || '',
            port: Number.isInteger(rep.port) ? rep.port : 22,
            username: rep.username || '',
            auth_method: authMethod,
            ssh_key_id: authMethod === 'key' ? (rep.ssh_key_id ?? null) : null,
            ssh_password: authMethod === 'password' ? (rep.ssh_password || '') : '',
            use_sftp: useSftp,
            remote_path: '',
            mount_options: rep.mount_options || '',
            exclude_patterns: [],
        };
        setFormData({ ...formData, sources: [...formData.sources, base] });
    };

    const removeGroup = () => {
        const idxSet = new Set(members.map((m) => m.index));
        setFormData({ ...formData, sources: formData.sources.filter((_: any, i: number) => !idxSet.has(i)) });
    };

    const handleTestConnection = async () => {
        const host = String(rep.host || '').trim();
        const username = String(rep.username || '').trim();
        const port = Number.isInteger(rep.port) ? rep.port : 22;

        if (!host || !username) {
            toast.error('Host and username are required to test the connection');
            return;
        }
        if (authMethod === 'key' && !rep.ssh_key_id) {
            toast.error('Please select an SSH key first');
            return;
        }
        if (authMethod === 'key' && selectedKey?.is_encrypted) {
            toast.error('Encrypted SSH keys are not supported for sshfs source mounts yet');
            return;
        }
        if (authMethod === 'password' && !rep.ssh_password) {
            toast.error('Please enter the SSH password first');
            return;
        }

        setTestResult({ status: 'testing', message: 'Connecting...' });
        try {
            const res: any = await repositoriesAPI.sshBrowse({
                host,
                port,
                username,
                ssh_key_id: authMethod === 'key' ? rep.ssh_key_id : undefined,
                ssh_auth_method: authMethod,
                ssh_password: authMethod === 'password' ? rep.ssh_password : undefined,
                remote_path: '/',
                use_sftp: useSftp,
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

    const serverLabel = `${rep.username || 'user'}@${rep.host || 'host'}:${Number.isInteger(rep.port) ? rep.port : 22}`;

    return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
                <Server className="w-5 h-5 text-teal-600 flex-shrink-0" />
                <span className="text-sm font-semibold text-teal-800 truncate">{serverLabel}</span>
                <span className="text-[10px] text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">
                    {members.length} path{members.length !== 1 ? 's' : ''}
                </span>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={removeGroup}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Remove this server and all its paths"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            <SshfsStatusBanner />

            {/* Shared connection */}
            <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-7">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Host *</label>
                        <input
                            type="text"
                            value={rep.host || ''}
                            onChange={(e) => { updateAll('host', e.target.value); resetTest(); }}
                            onBlur={() => trimAll('host')}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="server.example.com"
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Port</label>
                        <input
                            type="number"
                            value={rep.port || 22}
                            onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                updateAll('port', Number.isNaN(v) ? 22 : v);
                                resetTest();
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
                            value={rep.username || ''}
                            onChange={(e) => { updateAll('username', e.target.value); resetTest(); }}
                            onBlur={() => trimAll('username')}
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
                                onClick={() => setAuthMethod('key')}
                                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${authMethod === 'key' ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                            >
                                <KeyRound className="w-3 h-3" /> SSH Key
                            </button>
                            <button
                                type="button"
                                onClick={() => setAuthMethod('password')}
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
                                value={rep.ssh_key_id || ''}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    const parsed = v ? (Number.isNaN(Number(v)) ? v : Number(v)) : null;
                                    updateAll('ssh_key_id', parsed);
                                    resetTest();
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
                                    No usable SSH keys yet. Add an unencrypted key under <span className="font-medium">SSH Keys</span>, or use password auth.
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
                                    value={rep.ssh_password || ''}
                                    onChange={(e) => { updateAll('ssh_password', e.target.value); resetTest(); }}
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

                {/* Browse / Test transport */}
                <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Browse / Test mode</label>
                    <div className="flex bg-gray-100 rounded p-0.5 max-w-[220px]">
                        <button
                            type="button"
                            onClick={() => updateAll('use_sftp', true)}
                            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${useSftp ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                        >
                            <Folder className="w-3 h-3" /> SFTP
                        </button>
                        <button
                            type="button"
                            onClick={() => updateAll('use_sftp', false)}
                            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded transition-colors ${!useSftp ? 'bg-white text-teal-700 shadow-sm font-medium' : 'text-gray-600 hover:text-gray-800'}`}
                        >
                            <Network className="w-3 h-3" /> SSH shell
                        </button>
                    </div>
                </div>

                {/* Test connection */}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testResult.status === 'testing'}
                        className="px-2 py-1 text-xs bg-teal-50 text-teal-700 rounded border border-teal-300 hover:bg-teal-100 transition-colors flex items-center gap-1 disabled:opacity-60"
                        title="Test SSH/SFTP connectivity"
                    >
                        {testResult.status === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
                        <span>Test Connection</span>
                    </button>
                    {testResult.status === 'success' && (
                        <span className="flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle className="w-3.5 h-3.5" /> {testResult.message}
                        </span>
                    )}
                </div>
                {testResult.status === 'error' && (
                    <div className="flex items-start gap-2 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{testResult.message}</span>
                    </div>
                )}

                {/* Per-path list */}
                <div className="pt-1">
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">
                        Folders to back up from this server
                    </label>
                    <div className="space-y-1.5">
                        {members.map(({ source, index }) => (
                            <div key={index} className="flex gap-1 items-center">
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
                                        if (!rep.host || !rep.username) {
                                            toast.error('Enter host and username before browsing');
                                            return;
                                        }
                                        if (authMethod === 'key' && !rep.ssh_key_id) {
                                            toast.error('Select an SSH key before browsing');
                                            return;
                                        }
                                        if (authMethod === 'key' && selectedKey?.is_encrypted) {
                                            toast.error('Encrypted SSH keys are not supported for sshfs source mounts yet');
                                            return;
                                        }
                                        if (authMethod === 'password' && !rep.ssh_password) {
                                            toast.error('Enter the SSH password before browsing');
                                            return;
                                        }
                                        setBrowsingIndex(index);
                                    }}
                                    className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 transition-colors flex items-center gap-1"
                                    title="Browse remote folders"
                                >
                                    <Folder className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeSource(index)}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    title="Remove this path"
                                    disabled={members.length <= 1}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addPath}
                        className="mt-2 inline-flex items-center gap-1 px-2 py-1 text-xs text-teal-700 border border-teal-300 rounded hover:bg-teal-50 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" /> Add folder
                    </button>
                </div>

                <div className="flex items-start gap-2 px-2 py-1.5 bg-teal-50 border border-teal-200 rounded text-[11px] text-teal-800">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                        Each folder is temporarily sshfs-mounted while the backup runs. To remove a folder for use with a different
                        account, delete it here and add it again under a new server entry (different user or auth).
                    </span>
                </div>
            </div>

            <SSHBrowserModal
                isOpen={browsingIndex !== null}
                host={rep.host || ''}
                port={Number.isInteger(rep.port) ? rep.port : 22}
                username={rep.username || ''}
                sshKeyId={authMethod === 'key' ? (rep.ssh_key_id || undefined) : undefined}
                sshAuthMethod={authMethod}
                sshPassword={authMethod === 'password' ? rep.ssh_password : undefined}
                initialUseSftp={useSftp}
                currentPath={browsingIndex !== null ? (formData.sources[browsingIndex]?.remote_path || undefined) : undefined}
                onSelectPath={(p: string) => {
                    if (browsingIndex !== null) {
                        updateSource(browsingIndex, 'remote_path', p);
                    }
                    setBrowsingIndex(null);
                }}
                onClose={() => setBrowsingIndex(null)}
                title="Select Remote Folder to Back Up"
            />
        </div>
    );
};

export default SSHServerGroupCard;
