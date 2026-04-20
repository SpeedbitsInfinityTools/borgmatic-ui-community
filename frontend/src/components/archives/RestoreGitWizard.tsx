import React, { useState, useEffect, useCallback } from 'react';
import {
  X, GitBranch, ArrowRight, ArrowLeft, Check, AlertCircle, Loader2,
  Eye, EyeOff, RefreshCw, CheckSquare, Square, Search,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { gitRestoreAPI } from '../../services/api';

interface RestoreGitWizardProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: string;
  archiveName: string;
  gitBasePath?: string;
  backupType?: string;
}

interface ScannedRepo {
  name: string;
  path: string;
  type: string;
  group: string | null;
}

interface RestoreResult {
  name: string;
  targetName: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
}

type Platform = 'github' | 'gitlab' | 'bitbucket' | 'azure';

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'bitbucket', label: 'Bitbucket' },
  { id: 'azure', label: 'Azure DevOps' },
];

const RestoreGitWizard: React.FC<RestoreGitWizardProps> = ({
  isOpen, onClose, repositoryPath, archiveName, gitBasePath, backupType,
}) => {
  const [step, setStep] = useState(1);

  // Step 1: Scanned repos
  const [scanning, setScanning] = useState(false);
  const [scannedRepos, setScannedRepos] = useState<ScannedRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [repoFilter, setRepoFilter] = useState('');

  // Step 2: Platform & auth
  const [platform, setPlatform] = useState<Platform>('github');
  const [organization, setOrganization] = useState('');
  const [group, setGroup] = useState('');
  const [user, setUser] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [gitlabHost, setGitlabHost] = useState('https://gitlab.com');
  const [azureProject, setAzureProject] = useState('');
  const [pat, setPat] = useState('');
  const [bbUsername, setBbUsername] = useState('');
  const [bbAuthMode, setBbAuthMode] = useState<string>('api_token');
  const [showPat, setShowPat] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Step 3: Naming
  const [namingMode, setNamingMode] = useState<'original' | 'suffix'>('original');
  const [nameSuffix, setNameSuffix] = useState('-restored');
  const [conflictMode, setConflictMode] = useState<'skip' | 'fail'>('skip');
  const [pushMode, setPushMode] = useState<'all' | 'default'>('all');

  // Step 4: Execute
  const [executing, setExecuting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);

  // Scan on mount
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setScannedRepos([]);
      setSelectedRepos(new Set());
      setJobId(null);
      setJobStatus(null);
      setExecuting(false);
      handleScan();
    }
  }, [isOpen]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const resp = await gitRestoreAPI.scan({
        repository: repositoryPath,
        archive: archiveName,
        basePath: gitBasePath,
      });
      const repos: ScannedRepo[] = resp.data?.repos || [];
      setScannedRepos(repos);
      setSelectedRepos(new Set(repos.map(r => r.path)));
      if (repos.length === 0) {
        toast('No git repositories found in this archive at the specified path.', { icon: 'ℹ️' });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to scan archive');
    } finally {
      setScanning(false);
    }
  }, [repositoryPath, archiveName, gitBasePath]);

  const toggleRepo = (repoPath: string) => {
    setSelectedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoPath)) next.delete(repoPath);
      else next.add(repoPath);
      return next;
    });
  };

  const selectAll = () => setSelectedRepos(new Set(filteredRepos.map(r => r.path)));
  const deselectAll = () => setSelectedRepos(new Set());

  const filteredRepos = scannedRepos.filter(r =>
    !repoFilter || r.name.toLowerCase().includes(repoFilter.toLowerCase())
  );

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await gitRestoreAPI.testConnection({
        platform, organization, group, user, workspace, host: gitlabHost, pat, bb_username: bbUsername, bb_auth_mode: bbAuthMode,
      });
      setTestResult({ success: true, message: resp.data?.message || 'Connection successful' });
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.error || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    try {
      const selected = scannedRepos.filter(r => selectedRepos.has(r.path));
      const resp = await gitRestoreAPI.execute({
        repository: repositoryPath,
        archive: archiveName,
        basePath: gitBasePath,
        repos: selected,
        platform, organization, group, user, workspace, host: gitlabHost, project: azureProject,
        pat, bb_username: bbUsername, bb_auth_mode: bbAuthMode,
        nameSuffix: namingMode === 'suffix' ? nameSuffix : '',
        conflictMode,
        pushMode,
      });
      setJobId(resp.data?.jobId);
      setStep(4);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to start restore');
      setExecuting(false);
    }
  };

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const resp = await gitRestoreAPI.getStatus(jobId);
        setJobStatus(resp.data?.data);
        if (['success', 'failed', 'partial'].includes(resp.data?.data?.status)) {
          setExecuting(false);
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (!isOpen) return null;

  const canProceedStep1 = selectedRepos.size > 0;
  const canProceedStep2 = pat.length > 0 && (
    platform === 'github' ? (organization || user) :
    platform === 'gitlab' ? (group || user) :
    platform === 'bitbucket' ? (workspace && bbUsername) :
    platform === 'azure' ? organization : false
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">Restore Git Repositories</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2 text-xs">
            {['Select Repos', 'Target Platform', 'Options', 'Execute'].map((label, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className="flex-1 h-px bg-gray-300" />}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full whitespace-nowrap ${
                  step === i + 1 ? 'bg-purple-100 text-purple-700 font-medium' :
                  step > i + 1 ? 'bg-green-100 text-green-700' : 'text-gray-400'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300 text-white'
                  }`}>{step > i + 1 ? <Check className="w-3 h-3" /> : i + 1}</span>
                  {label}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ── Step 1: Select Repos ── */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {scanning ? 'Scanning archive for git repositories...' :
                   `Found ${scannedRepos.length} ${scannedRepos.length === 1 ? 'repository' : 'repositories'} — ${selectedRepos.size} selected`}
                </p>
                <button onClick={handleScan} disabled={scanning} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                  <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} /> Rescan
                </button>
              </div>

              {scanning ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input type="text" value={repoFilter} onChange={e => setRepoFilter(e.target.value)} placeholder="Filter repos..." className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                    <button onClick={selectAll} className="text-xs px-2 py-1.5 text-purple-600 hover:bg-purple-50 rounded">Select All</button>
                    <button onClick={deselectAll} className="text-xs px-2 py-1.5 text-gray-500 hover:bg-gray-50 rounded">Deselect All</button>
                  </div>

                  <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto divide-y divide-gray-100">
                    {filteredRepos.map(repo => (
                      <label key={repo.path} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <button type="button" onClick={() => toggleRepo(repo.path)} className="text-purple-600">
                          {selectedRepos.has(repo.path) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-gray-300" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate block">{repo.name}</span>
                          {repo.group && <span className="text-[10px] text-gray-400">{repo.group}/</span>}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${repo.type === 'mirror' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                          {repo.type}
                        </span>
                      </label>
                    ))}
                    {filteredRepos.length === 0 && (
                      <div className="px-3 py-8 text-center text-sm text-gray-400">No repositories found</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Target Platform ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1.5 font-medium">Target Platform</label>
                <div className="grid grid-cols-4 gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p.id} type="button" onClick={() => setPlatform(p.id)}
                      className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                        platform === p.id ? 'border-purple-500 bg-purple-50 text-purple-700 font-medium' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}>{p.label}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {platform === 'github' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-600 mb-0.5">Organization or Username</label>
                    <input type="text" value={organization} onChange={e => setOrganization(e.target.value)} placeholder="my-org or my-username"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                  </div>
                )}
                {platform === 'gitlab' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Group or Username</label>
                      <input type="text" value={group} onChange={e => setGroup(e.target.value)} placeholder="my-group"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">GitLab Host</label>
                      <input type="text" value={gitlabHost} onChange={e => setGitlabHost(e.target.value)} placeholder="https://gitlab.com"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                  </>
                )}
                {platform === 'bitbucket' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Workspace</label>
                      <input type="text" value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="my-workspace"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Username or Email</label>
                      <input type="text" value={bbUsername} onChange={e => setBbUsername(e.target.value)} placeholder="Bitbucket username or email"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                  </>
                )}
                {platform === 'azure' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Organization</label>
                      <input type="text" value={organization} onChange={e => setOrganization(e.target.value)} placeholder="my-azure-org"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Project</label>
                      <input type="text" value={azureProject} onChange={e => setAzureProject(e.target.value)} placeholder="my-project"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    </div>
                  </>
                )}
              </div>

              {/* PAT */}
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">
                  {platform === 'bitbucket' ? 'API Token / App Password' : 'Personal Access Token (PAT)'}
                </label>
                <div className="relative">
                  <input type={showPat ? 'text' : 'password'} value={pat} onChange={e => setPat(e.target.value)}
                    placeholder={platform === 'github' ? 'ghp_...' : platform === 'gitlab' ? 'glpat-...' : platform === 'bitbucket' ? 'ATATT3xFfGF0...' : 'PAT'}
                    className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                  <button type="button" onClick={() => setShowPat(!showPat)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {platform === 'github' ? 'Needs repo scope (create + push access).' :
                   platform === 'gitlab' ? 'Needs api + write_repository scopes.' :
                   platform === 'bitbucket' ? 'Needs Repositories: Admin permission to create repos.' :
                   'Needs Code (Read & Write) + Project (Read) permissions.'}
                </p>
              </div>

              {/* Test button */}
              <div className="flex items-center gap-3">
                <button onClick={handleTestConnection} disabled={testing || !pat}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Test Connection
                </button>
                {testResult && (
                  <span className={`text-sm flex items-center gap-1 ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testResult.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Naming & Options ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1.5 font-medium">Repository Naming</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNamingMode('original')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${namingMode === 'original' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Use Original Names
                  </button>
                  <button type="button" onClick={() => setNamingMode('suffix')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${namingMode === 'suffix' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Append Suffix
                  </button>
                </div>
                {namingMode === 'suffix' && (
                  <input type="text" value={nameSuffix} onChange={e => setNameSuffix(e.target.value)} placeholder="-restored"
                    className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1.5 font-medium">If Repository Already Exists</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConflictMode('skip')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${conflictMode === 'skip' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Skip
                  </button>
                  <button type="button" onClick={() => setConflictMode('fail')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${conflictMode === 'fail' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Fail
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1.5 font-medium">Push Mode</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPushMode('all')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${pushMode === 'all' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    All Branches &amp; Tags
                  </button>
                  <button type="button" onClick={() => setPushMode('default')}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg ${pushMode === 'default' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Default Branch Only
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-xs text-gray-600 mb-1.5 font-medium">Preview ({selectedRepos.size} repos)</label>
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100 text-sm">
                  {scannedRepos.filter(r => selectedRepos.has(r.path)).slice(0, 20).map(repo => {
                    const repoName = repo.name.split('/').pop() || repo.name;
                    const targetName = namingMode === 'suffix' ? `${repoName}${nameSuffix}` : repoName;
                    return (
                      <div key={repo.path} className="px-3 py-1.5 flex items-center gap-2">
                        <span className="text-gray-500 truncate">{repoName}</span>
                        <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-purple-700 font-medium truncate">{targetName}</span>
                      </div>
                    );
                  })}
                  {selectedRepos.size > 20 && (
                    <div className="px-3 py-1.5 text-gray-400 text-center">...and {selectedRepos.size - 20} more</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Execute ── */}
          {step === 4 && (
            <div className="space-y-4">
              {!jobStatus ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500 mr-3" />
                  <span className="text-gray-500">Starting restore...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className={`font-medium ${
                        jobStatus.status === 'success' ? 'text-green-600' :
                        jobStatus.status === 'failed' ? 'text-red-600' :
                        jobStatus.status === 'partial' ? 'text-amber-600' : 'text-purple-600'
                      }`}>
                        {jobStatus.status === 'running' ? 'Restoring...' :
                         jobStatus.status === 'success' ? 'Restore Complete' :
                         jobStatus.status === 'failed' ? 'Restore Failed' :
                         'Partially Completed'}
                      </span>
                      <span className="text-gray-500 ml-2">
                        {jobStatus.completedRepos}/{jobStatus.totalRepos} repos
                        {jobStatus.failedRepos > 0 && `, ${jobStatus.failedRepos} failed`}
                      </span>
                    </div>
                    {jobStatus.currentRepo && (
                      <span className="text-xs text-purple-600 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> {jobStatus.currentRepo}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all bg-purple-500"
                      style={{ width: `${Math.round(((jobStatus.completedRepos + jobStatus.failedRepos) / jobStatus.totalRepos) * 100)}%` }} />
                  </div>

                  {/* Results */}
                  {jobStatus.results?.length > 0 && (
                    <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-gray-100">
                      {jobStatus.results.map((r: RestoreResult, i: number) => (
                        <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                          <span className="truncate">{r.targetName}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            r.status === 'success' ? 'bg-green-100 text-green-700' :
                            r.status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {r.status}{r.message ? `: ${r.message}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Log */}
                  {jobStatus.log?.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Show log ({jobStatus.log.length} entries)</summary>
                      <pre className="mt-1 bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto max-h-40 overflow-y-auto font-mono text-[11px]">
                        {jobStatus.log.join('\n')}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div>
            {step > 1 && step < 4 && (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 4 && !executing ? (
              <button onClick={onClose} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                Done
              </button>
            ) : step < 4 ? (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                {step < 3 ? (
                  <button onClick={() => setStep(step + 1)}
                    disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                    className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={handleExecute} disabled={executing}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                    {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Start Restore
                  </button>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestoreGitWizard;
