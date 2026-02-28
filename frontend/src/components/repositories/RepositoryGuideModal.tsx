import React from 'react';
import { X, Zap, Database, Cloud, HardDrive, Network, ArrowRight } from 'lucide-react';

interface RepositoryGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RepositoryGuideModal: React.FC<RepositoryGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const getColorClasses = (color: string) => {
    const colorMap: Record<string, { icon: string; bg: string }> = {
      green: { icon: 'text-green-600', bg: 'bg-green-100' },
      blue: { icon: 'text-blue-600', bg: 'bg-blue-100' },
      yellow: { icon: 'text-yellow-600', bg: 'bg-yellow-100' },
      orange: { icon: 'text-orange-600', bg: 'bg-orange-100' },
      red: { icon: 'text-red-600', bg: 'bg-red-100' },
    };
    return colorMap[color] || colorMap.blue;
  };

  const repositoryTypes = [
    {
      type: 'Local Filesystem',
      icon: HardDrive,
      speed: 100,
      speedLabel: 'Fastest',
      storageMode: 'Direct',
      description: 'Direct filesystem access on the same machine or fast local network',
      pros: ['Fastest performance', 'No network overhead', 'Lowest latency', 'Simple setup'],
      cons: ['Requires local storage', 'No off-site backup', 'Vulnerable to local disasters'],
      bestFor: 'Same machine backups, fast local network storage',
      color: 'green'
    },
    {
      type: 'SSH (Native Borg)',
      icon: Zap,
      speed: 90,
      speedLabel: 'Very Fast',
      storageMode: 'Direct',
      description: 'Borg\'s native SSH protocol with optimized deduplication and compression over the wire',
      pros: ['Highly optimized', 'Native Borg protocol', 'Efficient deduplication', 'Secure', 'Low overhead'],
      cons: ['Requires Borg on remote server', 'Needs SSH access'],
      bestFor: 'Remote servers with Borg installed, production backups',
      color: 'green'
    },
    {
      type: 'S3 Direct (Native)',
      icon: Cloud,
      speed: 75,
      speedLabel: 'Fast',
      storageMode: 'Direct',
      description: 'Borg\'s native S3 support using boto3, optimized for cloud object storage',
      pros: ['Native S3 support', 'Optimized for cloud', 'Scalable', 'Works with many providers'],
      cons: ['Network latency', 'S3 API overhead', 'Costs per request'],
      bestFor: 'Cloud storage (AWS, Hetzner, Wasabi, Backblaze B2, MinIO)',
      color: 'blue'
    },
    {
      type: 'SFTP',
      icon: Network,
      speed: 60,
      speedLabel: 'Moderate',
      storageMode: 'Direct',
      description: 'SSH-based file transfer protocol, slower than native SSH but works without Borg on remote',
      pros: ['Works without Borg on remote', 'Secure', 'Standard protocol'],
      cons: ['Protocol overhead', 'Slower than native SSH', 'Less optimized'],
      bestFor: 'Remote servers without Borg installed',
      color: 'yellow'
    },
    {
      type: 'Rclone Direct (Mounted)',
      icon: Network,
      speed: 50,
      speedLabel: 'Moderate-Slow',
      storageMode: 'Direct (via FUSE mount)',
      description: 'Rclone FUSE mount providing access to 100+ cloud providers, but with filesystem overhead',
      pros: ['Supports 100+ providers', 'Unified interface', 'Direct access'],
      cons: ['FUSE overhead', 'Network filesystem latency', 'Can be unstable', 'Higher CPU usage'],
      bestFor: 'Cloud providers not natively supported (Google Drive, Dropbox, etc.)',
      color: 'orange'
    },
    {
      type: 'Network Mounts (NFS/SMB)',
      icon: Network,
      speed: 45,
      speedLabel: 'Slow',
      storageMode: 'Direct (via network mount)',
      description: 'Network filesystems like NFS, SMB/CIFS, or other mounted remote filesystems',
      pros: ['Standard protocols', 'Works with existing infrastructure'],
      cons: ['High latency', 'Network filesystem overhead', 'Can be unreliable', 'Slower than direct protocols'],
      bestFor: 'Existing network storage infrastructure',
      color: 'orange'
    },
    {
      type: 'S3 Sync Mode',
      icon: Cloud,
      speed: 40,
      speedLabel: 'Slow',
      storageMode: 'Sync (Local + Rclone sync)',
      description: 'Write locally first, then sync to S3 using Rclone - double write overhead',
      pros: ['Works when direct S3 fails', 'Local backup available'],
      cons: ['Double write overhead', 'Requires local storage', 'Slower backups', 'Sync delays'],
      bestFor: 'When S3 direct mode is not available',
      color: 'red'
    },
    {
      type: 'Rclone Sync Mode',
      icon: Network,
      speed: 35,
      speedLabel: 'Slowest',
      storageMode: 'Sync (Local + Rclone sync)',
      description: 'Write locally first, then sync to cloud using Rclone - maximum overhead',
      pros: ['Works with any provider', 'Local backup available'],
      cons: ['Double write overhead', 'Requires local storage', 'Slowest method', 'Sync delays'],
      bestFor: 'When direct mounting is not possible',
      color: 'red'
    }
  ];

  const getSpeedColor = (speed: number) => {
    if (speed >= 80) return 'text-green-600 bg-green-50';
    if (speed >= 60) return 'text-blue-600 bg-blue-50';
    if (speed >= 40) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const getSpeedBarColor = (speed: number) => {
    if (speed >= 80) return 'bg-green-500';
    if (speed >= 60) return 'bg-blue-500';
    if (speed >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 overflow-y-auto h-full w-full z-50">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-7xl my-8 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Repository Types & Performance Guide</h2>
              <p className="text-sm text-gray-600 mt-1">
                Understand the differences between repository types and choose the best option for your needs
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
              <h3 className="text-lg font-semibold text-blue-900 mb-2">About Repositories in Borgmatic Director UI</h3>
              <p className="text-blue-800 mb-4">
                A <strong>repository</strong> is where your backups are stored. Borgmatic Director UI supports multiple repository types, 
                each with different performance characteristics. The choice of repository type significantly impacts backup speed, 
                resource usage, and reliability. Understanding these differences helps you make informed decisions for your backup strategy.
              </p>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2">Direct Mode</h4>
                  <p className="text-sm text-blue-800">
                    Borg writes directly to the remote storage. This is the fastest method as there's no intermediate step.
                  </p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2">Sync Mode</h4>
                  <p className="text-sm text-blue-800">
                    Borg writes locally first, then a sync tool (like Rclone) copies to cloud. This adds overhead and delay.
                  </p>
                </div>
              </div>
            </div>

            {/* Performance Comparison Table */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Database className="w-6 h-6" />
                Performance Comparison
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-300">
                        Repository Type
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-300">
                        Speed Rating
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-300">
                        Storage Mode
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                        Best Use Case
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {repositoryTypes.map((repo, idx) => {
                      const Icon = repo.icon;
                      const colorClasses = getColorClasses(repo.color);
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-4 border-r border-gray-300">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-5 h-5 ${colorClasses.icon}`} />
                              <span className="font-medium text-gray-900">{repo.type}</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">{repo.description}</p>
                          </td>
                          <td className="px-4 py-4 text-center border-r border-gray-300">
                            <div className="flex flex-col items-center">
                              <span className={`text-sm font-semibold px-2 py-1 rounded ${getSpeedColor(repo.speed)}`}>
                                {repo.speedLabel}
                              </span>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-2 max-w-[100px]">
                                <div
                                  className={`h-2 rounded-full ${getSpeedBarColor(repo.speed)}`}
                                  style={{ width: `${repo.speed}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 mt-1">{repo.speed}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center border-r border-gray-300">
                            <span className="text-sm text-gray-700">{repo.storageMode}</span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-gray-700">{repo.bestFor}</span>
                            {idx === 0 && (
                              <p className="text-xs text-red-600 mt-2 font-medium">
                                ⚠️ Not recommended due to potential data loss in case of disk crash or malicious attacks on local machine
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detailed Explanations */}
            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Detailed Explanations</h3>
              <div className="space-y-6">
                {repositoryTypes.map((repo, idx) => {
                  const Icon = repo.icon;
                  const colorClasses = getColorClasses(repo.color);
                  return (
                    <div key={idx} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className={`flex-shrink-0 p-3 rounded-lg ${colorClasses.bg}`}>
                          <Icon className={`w-6 h-6 ${colorClasses.icon}`} />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-lg font-semibold text-gray-900 mb-2">{repo.type}</h4>
                          <p className="text-gray-700 mb-4">{repo.description}</p>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <h5 className="font-semibold text-green-700 mb-2">✓ Advantages</h5>
                              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                {repo.pros.map((pro, i) => (
                                  <li key={i}>{pro}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h5 className="font-semibold text-red-700 mb-2">✗ Limitations</h5>
                              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                {repo.cons.map((con, i) => (
                                  <li key={i}>{con}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Decision Guide */}
            <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <ArrowRight className="w-6 h-6" />
                Quick Decision Guide
              </h3>
              <div className="space-y-4">
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Choose SSH (Native) if:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">
                    <li>You have a remote server with Borg installed</li>
                    <li>You want the fastest remote backup performance</li>
                    <li>You need production-grade reliability</li>
                    <li>You have SSH access to the remote server</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Choose S3 Direct if:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">
                    <li>You're using cloud object storage (AWS, Hetzner, Wasabi, etc.)</li>
                    <li>You want native cloud integration</li>
                    <li>You need scalable storage</li>
                    <li>You're okay with cloud API latency</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Choose Rclone Direct (Mounted) if:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">
                    <li>You need to use providers not natively supported (Google Drive, Dropbox, etc.)</li>
                    <li>You can accept moderate performance</li>
                    <li>You need unified access to multiple providers</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Avoid Sync Mode if possible:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">
                    <li>It's the slowest option due to double write overhead</li>
                    <li>Requires local storage space</li>
                    <li>Adds complexity and potential failure points</li>
                    <li>Only use when direct mode is not available</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-gray-900 mb-2">Avoid Network Mounts (NFS/SMB) if possible:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">
                    <li>They're among the slowest options</li>
                    <li>High latency and network filesystem overhead</li>
                    <li>Can be unreliable and unstable</li>
                    <li>Consider SSH or S3 Direct instead</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Performance Tips */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-yellow-900 mb-3">Performance Tips</h3>
              <ul className="list-disc list-inside text-yellow-800 space-y-2">
                <li><strong>SSH is fastest:</strong> If you have a remote server, SSH (native Borg) is almost always the fastest option</li>
                <li><strong>Direct beats Sync:</strong> Always prefer direct mode over sync mode when possible</li>
                <li><strong>Avoid double writes:</strong> Sync mode writes data twice (locally + cloud), significantly slowing backups</li>
                <li><strong>Network mounts are slow:</strong> NFS, SMB, and mounted Rclone are slower than direct protocols</li>
                <li><strong>Compression helps:</strong> Enable compression (LZ4) to reduce data transfer over network</li>
                <li><strong>Deduplication is key:</strong> Borg's deduplication works best with direct protocols like SSH</li>
              </ul>
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

export default RepositoryGuideModal;

