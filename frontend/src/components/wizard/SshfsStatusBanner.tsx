import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { systemConfigAPI } from '../../services/api';

/**
 * Self-contained sshfs / FUSE availability banner shared by SSH/SFTP source UIs.
 *
 * It probes the backend on mount and, when sshfs is unavailable, shows the
 * appropriate remediation: enable FUSE (Infinity Tools opt-in) when only the
 * FUSE device/capability is missing, or distro-specific install commands when
 * the sshfs binary itself is absent (bare-metal/dev hosts). Renders nothing when
 * sshfs is available or the user dismisses it.
 */

interface SshfsStatus {
    checked: boolean;
    available: boolean;
    error: string | null;
    binaryAvailable: boolean;
    fuseDeviceAvailable: boolean;
    sysAdminCapAvailable: boolean;
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

const SshfsStatusBanner: React.FC = () => {
    const [sshfsStatus, setSshfsStatus] = useState<SshfsStatus>({ checked: false, available: true, error: null, binaryAvailable: true, fuseDeviceAvailable: true, sysAdminCapAvailable: true });
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [selectedHintId, setSelectedHintId] = useState('debian');
    const [showDockerHint, setShowDockerHint] = useState(false);
    const [recheckingSshfs, setRecheckingSshfs] = useState(false);

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
                    binaryAvailable: data?.binary_available !== false,
                    fuseDeviceAvailable: data?.fuse_device_available !== false,
                    sysAdminCapAvailable: data?.sys_admin_cap_available !== false,
                });
                return !!data?.available;
            })
            .catch(() => {
                setSshfsStatus({ checked: true, available: true, error: null, binaryAvailable: true, fuseDeviceAvailable: true, sysAdminCapAvailable: true });
                return true;
            });
    };

    useEffect(() => {
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
                toast.success('SSH/SFTP sources are now available (sshfs + FUSE detected)');
            } else {
                toast.error('Still not available — sshfs and/or FUSE (/dev/fuse) are missing on the backend');
            }
        } finally {
            setRecheckingSshfs(false);
        }
    };

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

    const showBanner = sshfsStatus.checked && !sshfsStatus.available && !bannerDismissed;
    if (!showBanner) return null;

    const selectedHint = HOST_INSTALL_HINTS.find((hint) => hint.id === selectedHintId) || HOST_INSTALL_HINTS[0];
    // The sshfs binary ships in our image, so on a normal deployment the only
    // thing that can be missing is FUSE access (the Infinity Tools opt-in). In
    // that case we show the "enable FUSE / reinstall" guidance instead of the
    // host package-install instructions.
    const fuseDisabledOnly = sshfsStatus.binaryAvailable && (!sshfsStatus.fuseDeviceAvailable || !sshfsStatus.sysAdminCapAvailable);

    return (
        <div className="mb-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                {fuseDisabledOnly ? (
                    <>
                        <p className="font-semibold mb-1">FUSE is not enabled for this container</p>
                        <p className="mb-2">
                            SSH/SFTP sources mount the remote folder with <span className="font-mono">sshfs</span>, which needs FUSE
                            (<span className="font-mono">/dev/fuse</span>). This deployment was created without FUSE access, so the
                            backup would fail when it tries to mount.
                        </p>
                        <p className="mb-2 text-[11px] text-amber-800">
                            To enable it, re-run the <span className="font-semibold">Infinity Tools</span> installer for the borgmatic-ui
                            client and answer <span className="font-semibold">Yes</span> to
                            <span className="italic"> &ldquo;Enable SSH/SFTP backup sources&rdquo;</span>. For unattended installs,
                            set <span className="font-mono">BORGUI_ENABLE_FUSE=true</span> instead. Then redeploy the container.
                        </p>
                        <p className="mb-2 text-[11px] text-amber-800">
                            This can&rsquo;t be switched on from here — granting FUSE recreates the container with extra privileges
                            (<span className="font-mono">/dev/fuse</span> + <span className="font-mono">SYS_ADMIN</span>), which only the installer can do.
                        </p>
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <button
                                type="button"
                                onClick={handleRecheckSshfs}
                                disabled={recheckingSshfs}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-200 hover:bg-amber-300 border border-amber-400 rounded px-2 py-0.5 transition-colors disabled:opacity-60"
                                title="Re-check FUSE availability after redeploying with it enabled"
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
                                After redeploying with FUSE enabled, click Re-check.
                            </span>
                        </div>
                    </>
                ) : (
                    <>
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
                                        These flags are opt-in. Enable them in the Infinity Tools installer via
                                        <span className="italic"> &ldquo;Enable SSH/SFTP backup sources&rdquo;</span>
                                        (or set <span className="font-mono">BORGUI_ENABLE_FUSE=true</span> for unattended installs).
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
                    </>
                )}
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
    );
};

export default SshfsStatusBanner;
