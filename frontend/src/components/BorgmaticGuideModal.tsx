import React, { useState, useEffect } from 'react';
import { X, Database, Clock, FileText, Server, Users, ArrowRight, BookOpen, Zap, Shield, ExternalLink } from 'lucide-react';
import { identityAPI } from '../services/api';

interface BorgmaticGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BorgmaticGuideModal: React.FC<BorgmaticGuideModalProps> = ({ isOpen, onClose }) => {
  const [edition, setEdition] = useState<string>('commercial');

  useEffect(() => {
    if (isOpen) {
      const fetchEdition = async () => {
        try {
          const response = await identityAPI.getStatus();
          setEdition(response.data.data.edition || 'commercial');
        } catch (error) {
          console.error('Failed to fetch edition:', error);
          setEdition('commercial');
        }
      };
      fetchEdition();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 overflow-y-auto h-full w-full z-50">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-7xl my-8 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Borgmatic Guide</h2>
              <p className="text-sm text-gray-600 mt-1">
                Learn how Borgmatic works and get started with your backup strategy
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {/* Introduction */}
            <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-2 flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                What is Borgmatic Director UI?
              </h3>
              <p className="text-blue-800 mb-4">
                <strong>Borgmatic Director UI</strong> is a modern web-based management interface for <strong>Borgmatic</strong>,
                which is a simple, configuration-driven backup software built on top of <strong>Borg Backup</strong>.
                Borgmatic automates the creation of backups, handles encryption, compression, and provides a powerful deduplication system
                that saves storage space by only storing unique data chunks. Borgmatic Director UI provides an intuitive interface
                to manage your backups, repositories, schedules, and archives without editing configuration files manually.
              </p>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2">Key Features</h4>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Automatic backup scheduling</li>
                    <li>Deduplication (saves storage)</li>
                    <li>Encryption and compression</li>
                    <li>Multiple repository support</li>
                    <li>Pre/post-backup hooks</li>
                    <li>Template-based setup</li>
                    <li>Database auto-discovery</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2">How It Works</h4>
                  <p className="text-sm text-blue-800">
                    Borgmatic Director UI runs in a single Docker container that includes everything you need.
                    Configuration files (YAML) define what to backup, where to store it, and when to run.
                    Backups execute automatically according to your schedule, creating incremental archives
                    that only store changes. You can also use templates to quickly set up common backup configurations.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Start Guide */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Zap className="w-6 h-6" />
                Quick Start Guide
              </h3>
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
                <p className="text-green-800 font-semibold mb-2">🚀 Fast Track: Use Templates</p>
                <p className="text-green-700 mb-3">
                  If you're setting up backups for common applications (like WordPress, BookStack, or other Infinity Tools),
                  you can use <strong>Templates</strong> to automatically configure everything. Go to "Templates" →
                  Select a template → Test connection → Activate. This creates repositories, schedules, and backup jobs automatically!
                </p>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
                <p className="text-yellow-800 font-medium mb-2">Manual Setup (follow these steps in order):</p>
                <ol className="list-decimal list-inside text-yellow-800 space-y-2">
                  <li>Create SSH Keys (if using SSH/SFTP repositories)</li>
                  <li>Create a Repository (where backups will be stored)</li>
                  <li>Create a Schedule (when backups should run)</li>
                  <li>Create a Backup Job (what to backup and how)</li>
                </ol>
              </div>

              <div className="space-y-6">
                {/* Step 1: SSH Keys */}
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-bold">1</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">SSH Keys (Optional)</h4>
                      <p className="text-gray-700 mb-3">
                        If you plan to use SSH or SFTP repositories, you'll need to create SSH keys first.
                        These keys allow secure, passwordless access to remote servers.
                      </p>
                      <div className="bg-gray-50 rounded p-3">
                        <p className="text-sm text-gray-600">
                          <strong>When needed:</strong> Only if using SSH or SFTP repository types
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Where:</strong> Go to "SSH Keys" in the navigation menu
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Repository */}
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Database className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">Create a Repository</h4>
                      <p className="text-gray-700 mb-3">
                        A <strong>repository</strong> is where your backups are stored. It can be local, on a remote server (SSH/SFTP),
                        or in the cloud (S3, Rclone). Think of it as the "destination" for your backups.
                      </p>
                      <div className="bg-gray-50 rounded p-3 mb-3">
                        <p className="text-sm text-gray-600">
                          <strong>Where:</strong> Go to "Repositories" → Click "Create Repository"
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Tip:</strong> Click "Read this first!" on the Repositories page to learn about different repository types and performance.
                        </p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <p className="text-sm text-blue-800">
                          <strong>💡 Example:</strong> Create an SSH repository pointing to <code className="bg-blue-100 px-1 rounded">ssh://user@server.com/var/backups/borg</code>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3: Schedule */}
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                      <Clock className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">Create a Schedule</h4>
                      <p className="text-gray-700 mb-3">
                        A <strong>schedule</strong> defines when backups should run. It uses cron syntax to specify
                        the frequency (e.g., daily at 2 AM, weekly on Sundays, etc.).
                      </p>
                      <div className="bg-gray-50 rounded p-3 mb-3">
                        <p className="text-sm text-gray-600">
                          <strong>Where:</strong> Go to "Schedules" → Click "Create Schedule"
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Tip:</strong> You can reuse the same schedule for multiple backup jobs
                        </p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <p className="text-sm text-blue-800">
                          <strong>💡 Example:</strong> Create a schedule with cron expression <code className="bg-blue-100 px-1 rounded">0 2 * * *</code> (runs daily at 2:00 AM)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 4: Backup Job */}
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <FileText className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">Create a Backup Job</h4>
                      <p className="text-gray-700 mb-3">
                        A <strong>backup job</strong> (or "backup") ties everything together. It specifies:
                      </p>
                      <ul className="list-disc list-inside text-gray-700 mb-3 space-y-1">
                        <li>What files/directories to backup (source paths)</li>
                        <li>Which repository to use (destination)</li>
                        <li>Which schedule to follow (when to run)</li>
                        <li>Retention policies (how long to keep backups)</li>
                        <li>Pre/post-backup commands (optional)</li>
                      </ul>
                      <div className="bg-gray-50 rounded p-3 mb-3">
                        <p className="text-sm text-gray-600">
                          <strong>Where:</strong> Go to "Backups" → Click "Create Backup"
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Tip:</strong> You can create multiple backup jobs using the same repository and schedule
                        </p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <p className="text-sm text-blue-800">
                          <strong>💡 Example:</strong> Create a backup job that backs up <code className="bg-blue-100 px-1 rounded">/home</code> and <code className="bg-blue-100 px-1 rounded">/etc</code>
                          to your SSH repository, running daily at 2 AM, keeping 7 daily, 4 weekly, and 12 monthly backups.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Terminology */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <BookOpen className="w-6 h-6" />
                Key Terminology
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Database className="w-8 h-8 text-blue-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Repository</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    A <strong>repository</strong> is the storage location where all your backups are stored.
                    It's like a "vault" that contains multiple backup archives.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600">
                      <strong>Key points:</strong>
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 space-y-1 list-disc list-inside">
                      <li>One repository can hold multiple backup jobs</li>
                      <li>Repositories can be local, remote (SSH), or cloud (S3)</li>
                      <li>Repositories are encrypted and deduplicated</li>
                      <li>You need at least one repository before creating backups</li>
                    </ul>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <FileText className="w-8 h-8 text-green-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Archive</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    An <strong>archive</strong> is a single backup snapshot created at a specific point in time.
                    Each time a backup runs, it creates a new archive in the repository.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600">
                      <strong>Key points:</strong>
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 space-y-1 list-disc list-inside">
                      <li>Each archive has a unique name (usually timestamp-based)</li>
                      <li>Archives are incremental (only store changes)</li>
                      <li>You can restore from any archive</li>
                      <li>Old archives are pruned based on retention policies</li>
                    </ul>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Clock className="w-8 h-8 text-purple-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Schedule</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    A <strong>schedule</strong> defines when backups should run using cron syntax.
                    It's reusable across multiple backup jobs.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600">
                      <strong>Examples:</strong>
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 space-y-1 font-mono">
                      <li><code>0 2 * * *</code> - Daily at 2:00 AM</li>
                      <li><code>0 0 * * 0</code> - Weekly on Sunday</li>
                      <li><code>0 */6 * * *</code> - Every 6 hours</li>
                    </ul>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <FileText className="w-8 h-8 text-orange-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Backup Job</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    A <strong>backup job</strong> (or simply "backup") is a configuration that defines what to backup,
                    where to store it, when to run, and retention policies.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600">
                      <strong>Components:</strong>
                    </p>
                    <ul className="text-sm text-gray-600 mt-1 space-y-1 list-disc list-inside">
                      <li>Source paths (what to backup)</li>
                      <li>Repository (where to store)</li>
                      <li>Schedule (when to run)</li>
                      <li>Retention policy (how long to keep)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Director/Client Mode */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Server className="w-6 h-6" />
                Director & Client Modes
              </h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <p className="text-blue-800 mb-4">
                  Borgmatic Director UI supports two operating modes: <strong>Standalone</strong> (default) and <strong>Director/Client</strong>
                  (for managing multiple backup servers from a central location).
                </p>
                {edition === 'community' && (
                  <div className="bg-white border border-blue-300 rounded-lg p-4 mt-4">
                    <p className="text-blue-900 font-semibold mb-2 flex items-center gap-2">
                      <Zap className="w-5 h-5" />
                      Upgrade to Commercial Edition
                    </p>
                    <p className="text-blue-800 mb-3">
                      You're currently using the <strong>Community Edition</strong>, which includes Standalone and Client modes.
                      To unlock <strong>Director Mode</strong> for centralized management of multiple backup servers, upgrade to the Commercial Edition.
                    </p>
                    <a
                      href="https://www.speedbits.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Learn More & Upgrade
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="border border-gray-200 rounded-lg p-6 bg-white">
                  <div className="flex items-center gap-3 mb-3">
                    <Server className="w-8 h-8 text-blue-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Standalone Mode</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    <strong>Default mode</strong> - Each server runs Borgmatic Director UI independently. Perfect for single-server deployments.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600 font-semibold mb-2">Characteristics:</p>
                    <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                      <li>Single server deployment</li>
                      <li>No network communication required</li>
                      <li>Simple setup and management</li>
                      <li>Best for small deployments</li>
                    </ul>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6 bg-white">
                  <div className="flex items-center gap-3 mb-3">
                    <Users className="w-8 h-8 text-green-600" />
                    <h4 className="text-lg font-semibold text-gray-900">Director/Client Mode</h4>
                  </div>
                  <p className="text-gray-700 mb-3">
                    <strong>Centralized management</strong> - One Director server manages multiple Client servers remotely.
                  </p>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-sm text-gray-600 font-semibold mb-2">Characteristics:</p>
                    <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                      <li>Central management dashboard</li>
                      <li>Multiple client servers</li>
                      <li>Secure WebSocket connections</li>
                      <li>Best for enterprise deployments</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Server className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">Director Mode</h4>
                        {edition === 'community' && (
                          <span className="px-2 py-1 text-xs font-semibold text-orange-700 bg-orange-100 rounded">
                            Commercial Only
                          </span>
                        )}
                      </div>
                      <p className="text-gray-700 mb-3">
                        The <strong>Director</strong> is the central management server that oversees multiple backup clients.
                        It provides a unified dashboard to monitor and manage all connected clients.
                      </p>
                      {edition === 'community' && (
                        <div className="bg-orange-50 border border-orange-200 rounded p-3 mb-3">
                          <p className="text-sm text-orange-800 mb-2">
                            <strong>Director Mode is available in the Commercial Edition.</strong> Upgrade to unlock centralized management of multiple backup servers.
                          </p>
                          <a
                            href="https://www.speedbits.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-orange-900 font-semibold hover:text-orange-700"
                          >
                            Learn more at speedbits.io
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                      <div className="bg-blue-50 border border-blue-200 rounded p-4">
                        <p className="text-sm text-blue-800 font-semibold mb-2">Director Capabilities:</p>
                        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                          <li><strong>Unified Dashboard:</strong> View backup status across all clients</li>
                          <li><strong>Remote Sessions:</strong> Switch between clients to view their data</li>
                          <li><strong>Template Management:</strong> Create and deploy backup configurations to multiple clients</li>
                          <li><strong>Centralized Reporting:</strong> Aggregate statistics and logs from all clients</li>
                          <li><strong>Client Management:</strong> Monitor, approve, and manage connected clients</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">Client Mode</h4>
                      <p className="text-gray-700 mb-3">
                        <strong>Clients</strong> are backup servers that connect to a Director. They execute backups locally
                        and report status back to the Director via secure WebSocket connections.
                      </p>
                      <div className="bg-green-50 border border-green-200 rounded p-4">
                        <p className="text-sm text-green-800 font-semibold mb-2">Client Capabilities:</p>
                        <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                          <li><strong>Secure Connection:</strong> Connects to Director via encrypted WebSocket (wss://)</li>
                          <li><strong>Local Execution:</strong> Runs backups on the client server</li>
                          <li><strong>Status Reporting:</strong> Sends backup status, logs, and statistics to Director</li>
                          <li><strong>Configuration Receipt:</strong> Accepts backup templates deployed from Director</li>
                          <li><strong>Automatic Reconnection:</strong> Reconnects automatically if connection is lost</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6 bg-yellow-50">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <Shield className="w-6 h-6 text-yellow-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">Security Architecture</h4>
                      <p className="text-gray-700 mb-3">
                        Director/Client mode uses cryptographic authentication to ensure secure communication:
                      </p>
                      <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                        <li><strong>Connection Token:</strong> Client connects with a shared connection token</li>
                        <li><strong>Challenge-Response:</strong> Director sends a cryptographic challenge</li>
                        <li><strong>Digital Signature:</strong> Client signs challenge with private key (Ed25519)</li>
                        <li><strong>Verification:</strong> Director verifies signature with client's public key</li>
                        <li><strong>Approval:</strong> Connection is approved or rejected</li>
                      </ol>
                      <div className="mt-3 bg-white rounded p-3 border border-yellow-200">
                        <p className="text-xs text-gray-600">
                          <strong>Protection:</strong> Maximum 10 failed authentication attempts, then 1-hour lockout period
                          to prevent brute-force attacks.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Diagram */}
            <div className="mb-8 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-indigo-900 mb-4">Typical Workflow</h3>
              <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
                <div className="bg-white rounded-lg p-4 border border-indigo-200 shadow-sm">
                  <div className="text-center">
                    <Database className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                    <p className="font-semibold text-gray-900">1. Repository</p>
                    <p className="text-xs text-gray-600 mt-1">Create storage location</p>
                  </div>
                </div>
                <ArrowRight className="w-6 h-6 text-indigo-600" />
                <div className="bg-white rounded-lg p-4 border border-indigo-200 shadow-sm">
                  <div className="text-center">
                    <Clock className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                    <p className="font-semibold text-gray-900">2. Schedule</p>
                    <p className="text-xs text-gray-600 mt-1">Define when to run</p>
                  </div>
                </div>
                <ArrowRight className="w-6 h-6 text-indigo-600" />
                <div className="bg-white rounded-lg p-4 border border-indigo-200 shadow-sm">
                  <div className="text-center">
                    <FileText className="w-8 h-8 text-green-600 mx-auto mb-2" />
                    <p className="font-semibold text-gray-900">3. Backup Job</p>
                    <p className="text-xs text-gray-600 mt-1">Configure what to backup</p>
                  </div>
                </div>
                <ArrowRight className="w-6 h-6 text-indigo-600" />
                <div className="bg-white rounded-lg p-4 border border-indigo-200 shadow-sm">
                  <div className="text-center">
                    <Zap className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                    <p className="font-semibold text-gray-900">4. Automatic</p>
                    <p className="text-xs text-gray-600 mt-1">Backups run automatically</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Got it, thanks!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BorgmaticGuideModal;

