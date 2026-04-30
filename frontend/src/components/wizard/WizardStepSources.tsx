import React, { useRef, useState, useEffect } from 'react';
import {
  FolderPlus,
  Database,
  Search,
  Trash2,
  AlertCircle,
  CheckCircle,
  List,
  Play,
  Loader2,
  GitBranch,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  X,
  Lock,
} from 'lucide-react';
import PathSelectorField from '../PathSelectorField';
import { gitReposAPI } from '../../services/api';
import { toast } from 'react-hot-toast';

const DB_TYPES = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'mssql'];

export interface WizardStepSourcesProps {
  formData: any;
  setFormData: (fd: any) => void;
  errors: Record<string, string>;
  mode?: string;
  operatingMode: string;

  addSource: (type: 'local' | 'database' | 'git_repos') => void;
  removeSource: (index: number) => void;
  updateSource: (index: number, field: string, value: any) => void;
  trimSourceField: (index: number, field: string) => void;
  getDefaultPort: (dbType: string) => number;
  getMssqlAuthHint: (source: any) => string;

  browseDatabases: (index: number) => void;
  testDatabaseConnection: (index: number) => void;
  testingDbConnectionIndex: number | null;
  dbConnectionTestErrors: Record<number, string>;
  dismissDbConnectionTestError: (index: number) => void;

  openDiscoveryOptions: () => void;
  isDiscovering: boolean;

  checkMssqlTools: () => void;
  checkAwsTools: () => void;
  mssqlToolCheck: { checked: boolean; ok: boolean; errors: string[] };
  awsToolCheck: { checked: boolean; ok: boolean; errors: string[] };

  dbHelpExpanded: boolean;
  setDbHelpExpanded: (fn: (prev: boolean) => boolean) => void;
  gitHelpExpanded: boolean;
  setGitHelpExpanded: (fn: (prev: boolean) => boolean) => void;

  showGitPat: Record<number, boolean>;
  setShowGitPat: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;

  gitDiscoveredReposBySource: Record<number, { id: string; group: string; name: string }[]>;
  setGitDiscoveredReposBySource: React.Dispatch<React.SetStateAction<Record<number, { id: string; group: string; name: string }[]>>>;
  gitSelectedReposBySource: Record<number, string[]>;
  setGitSelectedReposBySource: React.Dispatch<React.SetStateAction<Record<number, string[]>>>;
  isDiscoveringGitReposBySource: Record<number, boolean>;
  setIsDiscoveringGitReposBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  showGitRepoResultsBySource: Record<number, boolean>;
  setShowGitRepoResultsBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  gitTestResultBySource: Record<number, { success: boolean; message: string }>;
  setGitTestResultBySource: React.Dispatch<React.SetStateAction<Record<number, { success: boolean; message: string }>>>;
  isTestingGitConnectionBySource: Record<number, boolean>;
  setIsTestingGitConnectionBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  commercialFeatures: string[];
}

const WizardStepSources: React.FC<WizardStepSourcesProps> = (props) => {
  const {
    formData,
    setFormData,
    errors,
    mode,
    operatingMode,
    addSource,
    removeSource,
    updateSource,
    trimSourceField,
    getDefaultPort,
    getMssqlAuthHint,
    browseDatabases,
    testDatabaseConnection,
    testingDbConnectionIndex,
    dbConnectionTestErrors,
    dismissDbConnectionTestError,
    openDiscoveryOptions,
    isDiscovering,
    checkMssqlTools,
    checkAwsTools,
    mssqlToolCheck,
    awsToolCheck,
    dbHelpExpanded,
    setDbHelpExpanded,
    gitHelpExpanded,
    setGitHelpExpanded,
    showGitPat,
    setShowGitPat,
    gitDiscoveredReposBySource,
    setGitDiscoveredReposBySource,
    gitSelectedReposBySource,
    setGitSelectedReposBySource,
    isDiscoveringGitReposBySource,
    setIsDiscoveringGitReposBySource,
    showGitRepoResultsBySource,
    setShowGitRepoResultsBySource,
    gitTestResultBySource,
    setGitTestResultBySource,
    isTestingGitConnectionBySource,
    setIsTestingGitConnectionBySource,
    commercialFeatures,
  } = props;

  const hasFeature = (f: string) => commercialFeatures.includes(f);

  const UpgradeBanner = ({ feature, label }: { feature: string; label: string }) => (
    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-800">
      <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-semibold">{label}</span> is available in the Commercial edition.{' '}
        <a href="https://www.speedbits.io" target="_blank" rel="noopener noreferrer" className="underline font-medium text-amber-900 hover:text-amber-700">
          Get Commercial Edition at www.speedbits.io &rarr;
        </a>
      </div>
    </div>
  );

  const localSources = formData.sources.map((s: any, i: number) => ({ source: s, index: i })).filter(({ source }: any) => source.type === 'local');
  const dbSources = formData.sources.map((s: any, i: number) => ({ source: s, index: i })).filter(({ source }: any) => DB_TYPES.includes(source.type));
  const gitSources = formData.sources.map((s: any, i: number) => ({ source: s, index: i })).filter(({ source }: any) => source.type === 'git_repos');
  const localCount = localSources.length;
  const dbCount = dbSources.length;
  const gitCount = gitSources.length;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-6">
      {/* Sentinel: when this scrolls out, the header becomes "stuck" */}
      <div ref={sentinelRef} className="h-0" />

      <div className={`sticky top-0 z-20 transition-all duration-200 ${isStuck ? 'bg-white/95 backdrop-blur-sm shadow-md -mx-6 px-6 py-2 border-b border-gray-200' : ''}`}>
        <div className={`flex items-center justify-between ${isStuck ? '' : ''}`}>
          <h4 className={`font-medium text-gray-900 transition-all duration-200 ${isStuck ? 'text-sm' : 'text-lg'}`}>Backup Sources</h4>
          <div className="flex space-x-1.5">
            <button
              onClick={() => addSource('local')}
              className={`btn-secondary flex items-center space-x-1 relative transition-all duration-200 ${isStuck ? 'text-xs px-2 py-1' : 'text-sm'}`}
            >
              <FolderPlus className={`transition-all duration-200 ${isStuck ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
              <span className={isStuck ? 'hidden sm:inline' : ''}>Add Local Directory</span>
              {localCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{localCount}</span>
              )}
            </button>
            {!(mode === 'template' && operatingMode === 'director') && (
              <button
                onClick={openDiscoveryOptions}
                disabled={isDiscovering}
                className={`btn-secondary flex items-center space-x-1 transition-all duration-200 ${isStuck ? 'text-xs px-2 py-1' : 'text-sm'}`}
              >
                {isDiscovering ? (
                  <>
                    <div className={`border-2 border-gray-500 border-t-transparent rounded-full animate-spin ${isStuck ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}></div>
                    <span className={isStuck ? 'hidden sm:inline' : ''}>Discovering...</span>
                  </>
                ) : (
                  <>
                    <Search className={`transition-all duration-200 ${isStuck ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                    <span className={isStuck ? 'hidden sm:inline' : ''}>Auto-Discover</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => addSource('database')}
              className={`btn-secondary flex items-center space-x-1 relative transition-all duration-200 ${isStuck ? 'text-xs px-2 py-1' : 'text-sm'}`}
            >
              <Database className={`transition-all duration-200 ${isStuck ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
              <span className={isStuck ? 'hidden sm:inline' : ''}>Add Database</span>
              {dbCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{dbCount}</span>
              )}
            </button>
            <button
              onClick={() => {
                if (!hasFeature('git_repos')) {
                  toast('Git repository backup is available in the Commercial edition.\nVisit www.speedbits.io to upgrade.', { icon: '🔒', duration: 5000 });
                  return;
                }
                addSource('git_repos');
              }}
              className={`btn-secondary flex items-center space-x-1 relative transition-all duration-200 ${isStuck ? 'text-xs px-2 py-1' : 'text-sm'}`}
            >
              <GitBranch className={`transition-all duration-200 ${isStuck ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
              <span className={isStuck ? 'hidden sm:inline' : ''}>Add Git Repos</span>
              {!hasFeature('git_repos') && <Lock className="w-3 h-3 ml-0.5 text-amber-500" />}
              {gitCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-purple-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{gitCount}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {errors.sources && (
        <div className="flex items-center text-red-600 bg-red-50 p-3 rounded">
          <AlertCircle className="w-5 h-5 mr-2" />
          {errors.sources}
        </div>
      )}

      <div className="space-y-4">
        {/* ── Local Directories Section ── */}
        {localCount > 0 && (
          <div className="border-l-4 border-l-amber-400 pl-3 space-y-2">
            <div className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">Local Directories</span>
              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{localCount}</span>
            </div>
            {localSources.map(({ source, index }: any, pos: number) => (
              <div key={index} className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
                <div className="flex items-center gap-3">
                  {localCount > 1 ? (
                    <span className="text-[10px] text-amber-500 font-bold bg-amber-50 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 border border-amber-200">{pos + 1}</span>
                  ) : (
                    <span className="text-lg flex-shrink-0">📁</span>
                  )}
                  <div className="flex-1">
                    <PathSelectorField
                      value={source.path || ''}
                      onChange={(value: string) => updateSource(index, 'path', value)}
                      placeholder="/path/to/backup"
                      selectMode="directories"
                      inputClassName="py-1.5 text-sm"
                    />
                  </div>
                  <button
                    onClick={() => removeSource(index)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Databases Section ── */}
        {dbCount > 0 && (
          <div className="border-l-4 border-l-blue-400 pl-3 space-y-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">Databases</span>
              <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{dbCount}</span>
            </div>

            {/* Collapsible database help */}
            <button
              type="button"
              onClick={() => setDbHelpExpanded(prev => !prev)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 hover:bg-blue-100 transition-colors"
            >
              {dbHelpExpanded ? (
                <ChevronDown className="w-4 h-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="font-medium">Database Connection Help</span>
            </button>
            {dbHelpExpanded && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 overflow-y-auto" style={{ maxHeight: '200px' }}>
                <p className="font-semibold text-blue-800 mb-1">Hostname / Connection</p>
                <ul className="space-y-0.5 mb-2">
                  <li><strong>localhost</strong> — Database in the same container as Borgmatic</li>
                  <li><strong>Container name</strong> (e.g. <code className="bg-blue-100 px-1 rounded">postgres-db</code>) — Another Docker container on the same network</li>
                  <li><strong>host.docker.internal</strong> — Database on your host machine (outside Docker)</li>
                  <li><strong>IP / hostname</strong> — Remote server (e.g. <code className="bg-blue-100 px-1 rounded">db.example.com</code>, Azure SQL <code className="bg-blue-100 px-1 rounded">*.database.windows.net</code>, or AWS RDS <code className="bg-blue-100 px-1 rounded">*.rds.amazonaws.com</code>)</li>
                </ul>

                <p className="font-semibold text-blue-800 mb-1">Database Name</p>
                <p className="mb-2">Enter a specific database name, or click <strong>"All"</strong> to back up every database on the server. Use <strong>"Browse"</strong> to list and pick from available databases.</p>

                {formData.sources.some((s: any) => s.type === 'mssql') && (
                  <>
                    <p className="font-semibold text-blue-800 mb-1">MS SQL — Authentication</p>
                    <ul className="space-y-0.5 mb-2">
                      <li><strong>SQL Authentication</strong> — Classic SQL login (e.g. <code className="bg-blue-100 px-1 rounded">sa</code>) with username + password.</li>
                      <li><strong>Entra ID Password</strong> (formerly Azure AD) — Entra ID user. Enter UPN (e.g. <code className="bg-blue-100 px-1 rounded">user@company.com</code>) as Username.</li>
                      <li><strong>Service Principal</strong> — For automated backups. Fill in Client ID + Tenant ID; put the Client Secret in Password.</li>
                    </ul>

                    <p className="font-semibold text-blue-800 mb-1">MS SQL — Connection Options</p>
                    <ul className="space-y-0.5 mb-2">
                      <li><strong>Instance</strong> — Only for on-premise named instances (e.g. <code className="bg-blue-100 px-1 rounded">SQLEXPRESS</code>). Leave empty for Azure SQL and single-instance setups.</li>
                      <li><strong>Encrypt: Yes</strong> (default) — TLS encryption, required by Azure SQL. Use <strong>No</strong> only on trusted local networks. <strong>Strict</strong> requires SQL Server 2022+ or Azure.</li>
                      <li><strong>Trust Cert</strong> — Accept self-signed certificates. Check for on-premise servers; Azure SQL uses publicly trusted certs so unchecking works there too.</li>
                    </ul>
                  </>
                )}

                {formData.sources.some((s: any) => ['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(s.type)) && (
                  <>
                    <p className="font-semibold text-blue-800 mb-1">Dump Method</p>
                    <ul className="space-y-0.5 mb-2">
                      <li><strong>Borgmatic streaming</strong> (default) — Pipes the dump directly into the archive, no temp file on disk. Recommended on borgmatic ≥ 2.1.5, which fixed the earlier SSH-warning regression that broke this path for remote repos.</li>
                      <li><strong>Dump locally</strong> — Runs the DB client tool to create a dump file first, then backs it up. Uses transient disk space; pick this only if you are on an older borgmatic.</li>
                    </ul>
                  </>
                )}

                {formData.sources.some((s: any) => s.type === 'mongodb') && (
                  <>
                    <p className="font-semibold text-blue-800 mb-1">MongoDB / DocumentDB — TLS</p>
                    <p className="mb-2">Enable <strong>"Use TLS"</strong> when connecting to Amazon DocumentDB or MongoDB Atlas, which require encrypted connections.</p>
                  </>
                )}

                {formData.sources.some((s: any) => s.type === 'postgresql') && (
                  <>
                    <p className="font-semibold text-blue-800 mb-1">PostgreSQL — SSL Mode</p>
                    <ul className="space-y-0.5 mb-2">
                      <li><strong>Default (prefer)</strong> — Uses SSL if available, falls back to unencrypted. Works for most setups.</li>
                      <li><strong>Require</strong> — Enforces SSL. Use for AWS RDS with "require SSL" enabled or other cloud databases.</li>
                      <li><strong>Verify CA / Verify Full</strong> — Strict certificate validation. Requires CA certificate on the backup server.</li>
                    </ul>
                  </>
                )}

                {formData.sources.some((s: any) => ['postgresql', 'mysql', 'mariadb'].includes(s.type) && s.auth_method === 'aws_iam') && (
                  <>
                    <p className="font-semibold text-blue-800 mb-1">AWS IAM Database Authentication</p>
                    <ul className="space-y-0.5 mb-2">
                      <li><strong>Supported engines</strong> — PostgreSQL, MySQL, MariaDB on AWS RDS and Aurora.</li>
                      <li><strong>How it works</strong> — Generates a short-lived token (15 min) via <code className="bg-blue-100 px-1 rounded">aws rds generate-db-auth-token</code> at dump time. No stored password needed.</li>
                      <li><strong>DB user setup</strong> — PostgreSQL: grant the <code className="bg-blue-100 px-1 rounded">rds_iam</code> role to the user. MySQL/MariaDB: create user with <code className="bg-blue-100 px-1 rounded">AWSAuthenticationPlugin</code>.</li>
                      <li><strong>AWS credentials</strong> — Must be available in the container (env vars <code className="bg-blue-100 px-1 rounded">AWS_ACCESS_KEY_ID</code> / <code className="bg-blue-100 px-1 rounded">AWS_SECRET_ACCESS_KEY</code>, instance profile, or mounted <code className="bg-blue-100 px-1 rounded">~/.aws/credentials</code>).</li>
                      <li><strong>TLS</strong> — Required and enforced automatically when using IAM auth.</li>
                    </ul>
                  </>
                )}

                <p className="text-blue-500 mt-1"><strong>Tip:</strong> Use "Test" (MSSQL) or "Browse" to verify your connection before saving.</p>
              </div>
            )}

            {dbSources.map(({ source, index }: any, pos: number) => (
              <React.Fragment key={index}>
                {pos > 0 && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-blue-200" />
                    <span className="text-[10px] text-blue-400 font-medium">DB {pos + 1} of {dbCount}</span>
                    <div className="flex-1 border-t border-blue-200" />
                  </div>
                )}
                <DatabaseSourceCard
                  source={source}
                  index={index}
                  updateSource={updateSource}
                  trimSourceField={trimSourceField}
                  removeSource={removeSource}
                  getDefaultPort={getDefaultPort}
                  getMssqlAuthHint={getMssqlAuthHint}
                  browseDatabases={browseDatabases}
                  testDatabaseConnection={testDatabaseConnection}
                  testingDbConnectionIndex={testingDbConnectionIndex}
                  dbConnectionTestErrors={dbConnectionTestErrors}
                  dismissDbConnectionTestError={dismissDbConnectionTestError}
                  checkMssqlTools={checkMssqlTools}
                  checkAwsTools={checkAwsTools}
                  mssqlToolCheck={mssqlToolCheck}
                  awsToolCheck={awsToolCheck}
                  commercialFeatures={commercialFeatures}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Git Repositories Section ── */}
        {gitCount > 0 && (
          <div className="border-l-4 border-l-purple-400 pl-3 space-y-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-800">Git Repositories</span>
              <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">{gitCount}</span>
            </div>

            {!hasFeature('git_repos') && (
              <UpgradeBanner feature="git_repos" label="Git repository backup" />
            )}

            {/* Collapsible git help */}
            <button
              type="button"
              onClick={() => setGitHelpExpanded(prev => !prev)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700 hover:bg-purple-100 transition-colors"
            >
              {gitHelpExpanded ? (
                <ChevronDown className="w-4 h-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="font-medium">Git Repository Backup Help</span>
            </button>
            {gitHelpExpanded && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700 overflow-y-auto" style={{ maxHeight: '200px' }}>
                <p className="font-semibold text-purple-800 mb-1">How It Works</p>
                <p className="mb-2">
                  Repos are cloned to a <strong>persistent directory</strong> you choose. On each backup run, existing repos are fetched (incremental updates only), and new repos are cloned. Borg then archives the directory efficiently using deduplication.
                </p>

                <p className="font-semibold text-purple-800 mb-1">Scope</p>
                <ul className="space-y-0.5 mb-2">
                  <li><strong>Organization / User</strong> — Backs up all repos (or selected repos) from an org, group, workspace, or personal user account. For GitHub, you can enter either an <strong>organization name</strong> (e.g. <code className="bg-purple-100 px-1 rounded">SpeedbitsInfinityTools</code>) or your <strong>username</strong> (e.g. <code className="bg-purple-100 px-1 rounded">smartinventure</code>) — the system auto-detects which one it is. Use "Discover Repos" to see what's available.</li>
                  <li><strong>Single Repository</strong> — Backs up one specific repo by name. Useful when you only have access to one repo (e.g. a <strong>collaborator invitation</strong> on someone else's private repo). For GitHub, you can also paste the full <code className="bg-purple-100 px-1 rounded">owner/repo</code> slug into the Organization field of "Organization / User" mode and it will be detected automatically.</li>
                </ul>

                <p className="font-semibold text-purple-800 mb-1">Mirror vs. Clone</p>
                <ul className="space-y-0.5 mb-2">
                  <li><strong>Mirror (recommended)</strong> — Bare git repos (<code className="bg-purple-100 px-1 rounded">git clone --mirror</code>). Smallest size, fastest, preserves all branches, tags, and refs. Trivially restorable to any git platform with <code className="bg-purple-100 px-1 rounded">git push --mirror</code>. Best for disaster recovery.</li>
                  <li><strong>Clone</strong> — Working copies with checked-out files. Larger on disk (files stored twice: working tree + git objects). Useful if you need to browse/search the code directly on the filesystem without git commands.</li>
                </ul>
                <p className="text-purple-600 mb-2"><strong>Recommendation:</strong> Use <strong>Mirror</strong> for backups. It captures everything, uses less disk space, and is the standard approach for git disaster recovery. You can restore a mirror to GitHub, GitLab, Bitbucket, or Azure DevOps with a single push command.</p>

                <p className="font-semibold text-purple-800 mb-1">Authentication</p>
                <ul className="space-y-0.5 mb-2">
                  <li><strong>GitHub (Classic PAT)</strong> — Token with <code className="bg-purple-100 px-1 rounded">repo</code> scope. Works across all orgs you have access to. Grants read+write (no read-only scope for private repos).</li>
                  <li><strong>GitHub (Fine-grained PAT)</strong> — Token with <strong>Contents: Read</strong> permission. True read-only access, but scoped to one <strong>resource owner</strong> (org or user). Need a separate PAT per org.</li>
                  <li><strong>GitLab</strong> — Personal Access Token with <code className="bg-purple-100 px-1 rounded">read_api</code> + <code className="bg-purple-100 px-1 rounded">read_repository</code> scopes.</li>
                  <li><strong>Azure DevOps</strong> — PAT with <strong>Code (Read)</strong> + <strong>Project (Read)</strong> permissions.</li>
                  <li><strong>Bitbucket</strong> — API Token (Repository / Project / Workspace Access Token) <em>or</em> App Password (username + password) with <strong>Repositories: Read</strong> permission.</li>
                </ul>
                <p className="text-purple-600 mb-2"><strong>Recommendation:</strong> For backups, a <strong>Classic PAT</strong> with <code className="bg-purple-100 px-1 rounded">repo</code> scope is simplest — one token covers all your orgs and personal repos. This tool only performs read operations (clone, fetch, API listing).</p>

                <p className="font-semibold text-purple-800 mb-1">Options</p>
                <ul className="space-y-0.5 mb-2">
                  <li><strong>Group by project</strong> — Creates subdirectories per project/org inside the target directory (e.g. <code className="bg-purple-100 px-1 rounded">target/my-org/repo-name</code>). Recommended when backing up an organization with many repos.</li>
                  <li><strong>Prune deleted branches</strong> — Removes local branches/tags that no longer exist on the remote. Keeps mirrors clean and saves disk space, but means deleted remote branches cannot be recovered from the backup.</li>
                  <li><strong>Include private</strong> (GitHub) — Include private repositories in addition to public ones. Requires a PAT with <code className="bg-purple-100 px-1 rounded">repo</code> scope (classic) or a fine-grained PAT whose resource owner matches the target org/user.</li>
                  <li><strong>Include forks</strong> (GitHub) — Include forked repositories. Usually disabled to avoid backing up copies of upstream repos you don't own.</li>
                </ul>

                <p className="text-purple-500 mt-1"><strong>Tip:</strong> Click "Test Connection" to verify credentials, or "Discover Repos" to browse available repos before saving.</p>
              </div>
            )}

            {gitSources.map(({ source, index }: any, pos: number) => (
              <React.Fragment key={index}>
                {pos > 0 && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-purple-200" />
                    <span className="text-[10px] text-purple-400 font-medium">Git {pos + 1} of {gitCount}</span>
                    <div className="flex-1 border-t border-purple-200" />
                  </div>
                )}
                <GitSourceCard
                  source={source}
                  index={index}
                  formData={formData}
                  setFormData={setFormData}
                  updateSource={updateSource}
                  trimSourceField={trimSourceField}
                  removeSource={removeSource}
                  showGitPat={showGitPat}
                  setShowGitPat={setShowGitPat}
                  gitDiscoveredReposBySource={gitDiscoveredReposBySource}
                  setGitDiscoveredReposBySource={setGitDiscoveredReposBySource}
                  gitSelectedReposBySource={gitSelectedReposBySource}
                  setGitSelectedReposBySource={setGitSelectedReposBySource}
                  isDiscoveringGitReposBySource={isDiscoveringGitReposBySource}
                  setIsDiscoveringGitReposBySource={setIsDiscoveringGitReposBySource}
                  showGitRepoResultsBySource={showGitRepoResultsBySource}
                  setShowGitRepoResultsBySource={setShowGitRepoResultsBySource}
                  gitTestResultBySource={gitTestResultBySource}
                  setGitTestResultBySource={setGitTestResultBySource}
                  isTestingGitConnectionBySource={isTestingGitConnectionBySource}
                  setIsTestingGitConnectionBySource={setIsTestingGitConnectionBySource}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {formData.sources.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <FolderPlus className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>No sources added yet. Click the buttons above to add sources.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Database source card (single row) ──

interface DatabaseSourceCardProps {
  source: any;
  index: number;
  updateSource: (index: number, field: string, value: any) => void;
  trimSourceField: (index: number, field: string) => void;
  removeSource: (index: number) => void;
  getDefaultPort: (dbType: string) => number;
  getMssqlAuthHint: (source: any) => string;
  browseDatabases: (index: number) => void;
  testDatabaseConnection: (index: number) => void;
  testingDbConnectionIndex: number | null;
  dbConnectionTestErrors: Record<number, string>;
  dismissDbConnectionTestError: (index: number) => void;
  checkMssqlTools: () => void;
  checkAwsTools: () => void;
  mssqlToolCheck: { checked: boolean; ok: boolean; errors: string[] };
  awsToolCheck: { checked: boolean; ok: boolean; errors: string[] };
  commercialFeatures: string[];
}

const DatabaseSourceCard: React.FC<DatabaseSourceCardProps> = ({
  source, index, updateSource, trimSourceField, removeSource, getDefaultPort,
  getMssqlAuthHint, browseDatabases, testDatabaseConnection, testingDbConnectionIndex,
  dbConnectionTestErrors, dismissDbConnectionTestError,
  checkMssqlTools, checkAwsTools, mssqlToolCheck, awsToolCheck, commercialFeatures,
}) => {
  const hasFeature = (f: string) => commercialFeatures.includes(f);
  if (source.type === 'sqlite') {
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-lg flex-shrink-0">🗄️</span>
          <select
            value={source.type}
            onChange={(e) => updateSource(index, 'type', e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mariadb">MariaDB</option>
            <option value="mongodb">MongoDB</option>
            <option value="sqlite">SQLite</option>
            <option value="mssql">MS SQL Server</option>
          </select>
          <div className="flex-1">
            <PathSelectorField
              value={source.path || ''}
              onChange={(value: string) => updateSource(index, 'path', value)}
              placeholder="/opt/app/data/database.sqlite3"
              selectMode="both"
              inputClassName="py-1.5 text-sm"
            />
          </div>
          <button onClick={() => removeSource(index)} className="text-red-500 hover:text-red-700 p-1" title="Remove">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-lg flex-shrink-0">
            {source.type === 'postgresql' ? '🐘' : source.type === 'mongodb' ? '🍃' : source.type === 'mssql' ? '🗄️' : '🐬'}
          </span>
          <select
            value={source.type || 'postgresql'}
            onChange={(e) => updateSource(index, 'type', e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mariadb">MariaDB</option>
            <option value="mongodb">MongoDB</option>
            <option value="sqlite">SQLite</option>
            <option value="mssql">MS SQL Server</option>
          </select>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={source.database_name || ''}
              onChange={(e) => updateSource(index, 'database_name', e.target.value)}
              onBlur={() => trimSourceField(index, 'database_name')}
              className={`w-36 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${source.database_name === 'all' ? 'border-purple-400 bg-purple-50' : 'border-gray-300'}`}
              placeholder="Database name *"
            />
            {source.type !== 'sqlite' && (
              <>
                <button
                  type="button"
                  onClick={() => updateSource(index, 'database_name', 'all')}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${source.database_name === 'all' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'}`}
                  title="Backup ALL databases on this server"
                >All</button>
                <button
                  type="button"
                  onClick={() => browseDatabases(index)}
                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 transition-colors flex items-center gap-1"
                  title="Browse databases on this server"
                >
                  <List className="w-3 h-3" /><span>Browse</span>
                </button>
                {source.type === 'mssql' && (
                  <button
                    type="button"
                    onClick={() => testDatabaseConnection(index)}
                    disabled={testingDbConnectionIndex === index}
                    className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded border border-blue-300 hover:bg-blue-100 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Test MSSQL connection"
                  >
                    {testingDbConnectionIndex === index ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    <span>Test</span>
                  </button>
                )}
              </>
            )}
          </div>
          <span className="text-gray-400 text-xs">@</span>
          <input
            type="text"
            value={source.hostname ?? ''}
            onChange={(e) => updateSource(index, 'hostname', e.target.value)}
            onBlur={() => trimSourceField(index, 'hostname')}
            className="flex-1 min-w-[100px] px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="localhost"
          />
          <span className="text-gray-400 text-xs">:</span>
          <input
            type="number"
            value={source.port || getDefaultPort(source.type)}
            onChange={(e) => updateSource(index, 'port', parseInt(e.target.value))}
            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button onClick={() => removeSource(index)} className="text-red-500 hover:text-red-700 p-1 flex-shrink-0" title="Remove">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 pl-7">
          {source.type === 'mssql' && source.auth_method === 'service_principal' ? (
            <div className="w-56 px-2 py-1 text-xs text-gray-500 border border-dashed border-gray-300 rounded bg-gray-50">
              Username is not used in Service Principal mode
            </div>
          ) : (
            <input
              type="text"
              value={source.username || ''}
              onChange={(e) => updateSource(index, 'username', e.target.value)}
              onBlur={() => trimSourceField(index, 'username')}
              className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={['postgresql', 'mysql', 'mariadb'].includes(source.type) && source.auth_method === 'aws_iam' ? 'IAM DB user (e.g. iam_user)' : 'Username'}
            />
          )}
          {['postgresql', 'mysql', 'mariadb'].includes(source.type) && source.auth_method === 'aws_iam' ? (
            <div className="w-56 px-2 py-1 text-xs text-gray-500 border border-dashed border-gray-300 rounded bg-gray-50">
              Token generated at runtime via AWS IAM
            </div>
          ) : (
            <input
              type="password"
              value={source.password || ''}
              onChange={(e) => updateSource(index, 'password', e.target.value)}
              className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={source.type === 'mssql' && source.auth_method === 'service_principal' ? 'Client Secret' : 'Password'}
            />
          )}
          {source.discovered && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">Auto-discovered</span>
          )}
        </div>
        {/* MSSQL commercial gate */}
        {source.type === 'mssql' && !hasFeature('mssql') && (
          <div className="ml-7 mt-2 flex items-start gap-2 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
            <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>MS SQL Server backup</strong> is available in the Commercial edition.{' '}
              <a href="https://www.speedbits.io" target="_blank" rel="noopener noreferrer" className="underline font-medium">Get it at www.speedbits.io &rarr;</a>
            </span>
          </div>
        )}
        {/* MSSQL tool warning */}
        {source.type === 'mssql' && mssqlToolCheck.checked && !mssqlToolCheck.ok && (
          <div className="ml-7 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <strong>Missing MSSQL tools:</strong>
            {mssqlToolCheck.errors.map((err, i) => (<p key={i} className="mt-1">{err}</p>))}
            <p className="mt-1 text-red-500">Backup will fail until these tools are installed.</p>
            <button type="button" onClick={checkMssqlTools} className="mt-2 px-2 py-1 bg-red-100 border border-red-300 rounded text-red-700 hover:bg-red-200">Re-check tools</button>
          </div>
        )}
        {/* MSSQL-specific options */}
        {source.type === 'mssql' && (
          <>
            <div className="flex items-center gap-2 pl-7 mt-2 flex-wrap">
              <select value={source.auth_method || 'sql'} onChange={(e) => updateSource(index, 'auth_method', e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" title="Authentication method">
                <option value="sql">SQL Authentication</option>
                <option value="ad_password">Entra ID Password (Azure AD)</option>
                <option value="service_principal">Service Principal</option>
              </select>
              <input type="text" value={source.instance || ''} onChange={(e) => updateSource(index, 'instance', e.target.value)} onBlur={() => trimSourceField(index, 'instance')} className="w-32 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Instance (optional)" title="Named instance (e.g., SQLEXPRESS)" />
              <select value={source.encrypt || 'true'} onChange={(e) => updateSource(index, 'encrypt', e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" title="Connection encryption mode">
                <option value="true">Encrypt: Yes</option>
                <option value="false">Encrypt: No</option>
                <option value="strict">Encrypt: Strict</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-gray-600">
                <input type="checkbox" checked={source.trustServerCert || false} onChange={(e) => updateSource(index, 'trustServerCert', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                Trust Cert
              </label>
            </div>
            {source.auth_method === 'service_principal' && (
              <div className="flex items-center gap-2 pl-7 mt-2">
                <input type="text" value={source.client_id || ''} onChange={(e) => updateSource(index, 'client_id', e.target.value)} onBlur={() => trimSourceField(index, 'client_id')} className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Client ID (Application ID) *" title="Entra ID Application (Client) ID" />
                <input type="text" value={source.tenant_id || ''} onChange={(e) => updateSource(index, 'tenant_id', e.target.value)} onBlur={() => trimSourceField(index, 'tenant_id')} className="w-56 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Tenant ID *" title="Entra ID Tenant ID" />
              </div>
            )}
          </>
        )}
        {/* Auth method for PostgreSQL / MySQL / MariaDB (AWS IAM) */}
        {['postgresql', 'mysql', 'mariadb'].includes(source.type) && (
          <>
            <div className="flex items-center gap-2 pl-7 mt-2">
              <span className="text-xs text-gray-500">Auth:</span>
              <select value={source.auth_method || 'password'} onChange={(e) => updateSource(index, 'auth_method', e.target.value)} className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white" title="Authentication method">
                <option value="password">Password</option>
                <option value="aws_iam">AWS IAM</option>
              </select>
              {source.auth_method === 'aws_iam' && (
                <>
                  <span className="text-xs text-gray-500">Region:</span>
                  <input type="text" value={source.aws_region || ''} onChange={(e) => updateSource(index, 'aws_region', e.target.value)} onBlur={() => trimSourceField(index, 'aws_region')} className="w-32 px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="us-east-1" title="AWS Region of the RDS/Aurora instance" />
                </>
              )}
            </div>
            {source.auth_method === 'aws_iam' && !hasFeature('aws_iam') && (
              <div className="ml-7 mt-1 flex items-start gap-2 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>AWS IAM database authentication</strong> is available in the Commercial edition.{' '}
                  <a href="https://www.speedbits.io" target="_blank" rel="noopener noreferrer" className="underline font-medium">Get it at www.speedbits.io &rarr;</a>
                </span>
              </div>
            )}
            {source.auth_method === 'aws_iam' && hasFeature('aws_iam') && (
              <div className="ml-7 mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                AWS credentials (access key or IAM role) must be available in the borgmatic container environment. TLS is enforced automatically.
              </div>
            )}
            {source.auth_method === 'aws_iam' && awsToolCheck.checked && !awsToolCheck.ok && (
              <div className="ml-7 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                <strong>Missing AWS CLI:</strong>
                {awsToolCheck.errors.map((err, i) => (<p key={i} className="mt-1">{err}</p>))}
                <p className="mt-1 text-red-500">AWS IAM auth will fail until aws-cli is installed.</p>
                <button type="button" onClick={checkAwsTools} className="mt-2 px-2 py-1 bg-red-100 border border-red-300 rounded text-red-700 hover:bg-red-200">Re-check</button>
              </div>
            )}
          </>
        )}
        {/* MongoDB TLS */}
        {source.type === 'mongodb' && (
          <div className="flex items-center gap-2 pl-7 mt-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={source.tls || false} onChange={(e) => updateSource(index, 'tls', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              Use TLS
            </label>
            <span className="text-xs text-gray-400">Required for Amazon DocumentDB and MongoDB Atlas</span>
          </div>
        )}
        {/* PostgreSQL SSL mode */}
        {source.type === 'postgresql' && (
          <div className="flex items-center gap-2 pl-7 mt-2">
            <span className="text-xs text-gray-500">SSL mode:</span>
            <select value={source.ssl_mode || ''} onChange={(e) => updateSource(index, 'ssl_mode', e.target.value || undefined)} className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white">
              <option value="">Default (prefer)</option>
              <option value="disable">Disable</option>
              <option value="require">Require</option>
              <option value="verify-ca">Verify CA</option>
              <option value="verify-full">Verify Full</option>
            </select>
            <span className="text-xs text-gray-400">Set to "Require" for AWS RDS with mandatory SSL</span>
          </div>
        )}
        {/* Dump method selector */}
        {['mariadb', 'mysql', 'postgresql', 'mongodb'].includes(source.type) && (
          <div className="flex items-center gap-2 pl-7 mt-2">
            <span className="text-xs text-gray-500">Dump method:</span>
            <select value={source.dump_method || 'native'} onChange={(e) => updateSource(index, 'dump_method', e.target.value)} className="px-2 py-0.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white">
              <option value="native">Borgmatic streaming (default)</option>
              <option value="local">Dump locally, then backup</option>
            </select>
            <div className="relative group">
              <AlertCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                <p className="font-semibold mb-1">Borgmatic streaming (default):</p>
                <p className="mb-1.5">Uses borgmatic's native FIFO/pipe mechanism to stream the dump directly into the archive without touching disk. Saves disk space for large databases and is the recommended method as of borgmatic 2.1.5, which fixed the earlier SSH-warning regression that broke this path for remote repositories.</p>
                <p className="font-semibold mb-1">Dump locally, then backup:</p>
                <p>Runs the database client (e.g. mariadb-dump) to create a dump file first, then backs up that file. Uses transient disk space equal to the dump size. Pick this if you are still on an older borgmatic or want the output to appear as a regular file inside the archive.</p>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pl-7 mt-2">
          {source.database_name === 'all' && (<span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">All databases</span>)}
          {(source.is_host_database || source.hostname === 'host.docker.internal') && (
            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded" title="Connects to host system via host.docker.internal">🖥️ host</span>
          )}
          {source.type !== 'sqlite' && source.hostname && source.hostname !== 'localhost' && !(source.is_host_database || source.hostname === 'host.docker.internal') && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded" title="Connects over network (docker network for containers, or normal network for remote hosts). Dumps run inside the borgmatic container.">🔗 network</span>
          )}
        </div>
        {dbConnectionTestErrors[index] && (
          <div className="ml-7 mt-2 rounded-lg border border-red-200 bg-red-50">
            <div className="flex items-start gap-2 px-3 py-2 border-b border-red-200">
              <span className="text-red-600 text-xs font-semibold uppercase tracking-wide flex-1">Connection test failed</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(dbConnectionTestErrors[index]).then(
                    () => { /* clipboard ok */ },
                    () => { /* clipboard not available */ }
                  );
                }}
                className="text-[11px] font-medium text-red-700 hover:text-red-900 hover:underline"
                title="Copy error to clipboard"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => dismissDbConnectionTestError(index)}
                className="text-red-500 hover:text-red-700"
                title="Dismiss"
                aria-label="Dismiss connection error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="px-3 py-2 max-h-48 overflow-auto text-xs text-red-900 whitespace-pre-wrap break-words font-mono leading-relaxed">{dbConnectionTestErrors[index]}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Git source card ──

interface GitSourceCardProps {
  source: any;
  index: number;
  formData: any;
  setFormData: (fd: any) => void;
  updateSource: (index: number, field: string, value: any) => void;
  trimSourceField: (index: number, field: string) => void;
  removeSource: (index: number) => void;
  showGitPat: Record<number, boolean>;
  setShowGitPat: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  gitDiscoveredReposBySource: Record<number, { id: string; group: string; name: string }[]>;
  setGitDiscoveredReposBySource: React.Dispatch<React.SetStateAction<Record<number, { id: string; group: string; name: string }[]>>>;
  gitSelectedReposBySource: Record<number, string[]>;
  setGitSelectedReposBySource: React.Dispatch<React.SetStateAction<Record<number, string[]>>>;
  isDiscoveringGitReposBySource: Record<number, boolean>;
  setIsDiscoveringGitReposBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  showGitRepoResultsBySource: Record<number, boolean>;
  setShowGitRepoResultsBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  gitTestResultBySource: Record<number, { success: boolean; message: string }>;
  setGitTestResultBySource: React.Dispatch<React.SetStateAction<Record<number, { success: boolean; message: string }>>>;
  isTestingGitConnectionBySource: Record<number, boolean>;
  setIsTestingGitConnectionBySource: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
}

const GitSourceCard: React.FC<GitSourceCardProps> = ({
  source, index, formData, setFormData, updateSource, trimSourceField, removeSource,
  showGitPat, setShowGitPat,
  gitDiscoveredReposBySource, setGitDiscoveredReposBySource,
  gitSelectedReposBySource, setGitSelectedReposBySource,
  isDiscoveringGitReposBySource, setIsDiscoveringGitReposBySource,
  showGitRepoResultsBySource, setShowGitRepoResultsBySource,
  gitTestResultBySource, setGitTestResultBySource,
  isTestingGitConnectionBySource, setIsTestingGitConnectionBySource,
}) => {
  const handleDiscoverRepos = async () => {
    setIsDiscoveringGitReposBySource(prev => ({ ...prev, [index]: true }));
    setShowGitRepoResultsBySource(prev => ({ ...prev, [index]: false }));
    setGitTestResultBySource(prev => ({ ...prev, [index]: { success: true, message: '' } }));
    try {
      const response = await gitReposAPI.discoverRepos({
        platform: source.platform,
        organization: source.organization,
        user: source.user,
        group: source.group,
        workspace: source.workspace,
        project: source.project,
        host: source.host,
        pat: source.pat,
        bb_username: source.bb_username,
        bb_app_password: source.bb_app_password,
        include_private: source.include_private,
        include_forks: source.include_forks,
        include_archived: source.include_archived,
        include_subgroups: source.include_subgroups,
        repo_type: source.repo_type,
      });
      const repos = response.data?.repos || [];
      const warning = response.data?.warning;
      const repoIds = repos.map((r: any) => r.id || `${r.group}/${r.name}`);
      setGitDiscoveredReposBySource(prev => ({ ...prev, [index]: repos }));
      setGitSelectedReposBySource(prev => ({ ...prev, [index]: repoIds }));
      setShowGitRepoResultsBySource(prev => ({ ...prev, [index]: true }));
      updateSource(index, 'selected_repos', repoIds);
      if (warning) {
        toast.success(`Found ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} (with warnings)`);
        setGitTestResultBySource(prev => ({
          ...prev,
          [index]: { success: false, message: warning },
        }));
      } else {
        toast.success(`Found ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`);
      }
    } catch (err: any) {
      if (err.response?.status === 402) {
        const detail = err.response.data?.detail || 'This feature requires the Commercial edition.';
        toast.error(detail, { duration: 6000 });
        setGitTestResultBySource(prev => ({ ...prev, [index]: { success: false, message: detail } }));
      } else {
        const errMsg = err.response?.data?.error || 'Discovery failed';
        const firstLine = errMsg.split('\n')[0];
        toast.error(firstLine);
        setGitTestResultBySource(prev => ({ ...prev, [index]: { success: false, message: errMsg } }));
      }
    } finally {
      setIsDiscoveringGitReposBySource(prev => ({ ...prev, [index]: false }));
    }
  };

  const handleTestConnection = async () => {
    setIsTestingGitConnectionBySource(prev => ({ ...prev, [index]: true }));
    setGitTestResultBySource(prev => ({ ...prev, [index]: { success: true, message: '' } }));
    try {
      const response = await gitReposAPI.testConnection({
        platform: source.platform,
        organization: source.organization,
        user: source.user,
        group: source.group,
        workspace: source.workspace,
        project: source.project,
        host: source.host,
        pat: source.pat,
        bb_username: source.bb_username,
        bb_app_password: source.bb_app_password,
        repo_name: source.repo_name,
        include_private: source.include_private,
        include_forks: source.include_forks,
        include_archived: source.include_archived,
        include_subgroups: source.include_subgroups,
        repo_type: source.repo_type,
      });
      const hasWarning = !!response.data?.warning;
      setGitTestResultBySource(prev => ({
        ...prev,
        [index]: { success: !hasWarning, message: response.data?.message || 'Connection successful' },
      }));
    } catch (err: any) {
      if (err.response?.status === 402) {
        const detail = err.response.data?.detail || 'This feature requires the Commercial edition.';
        toast.error(detail, { duration: 6000 });
        setGitTestResultBySource(prev => ({ ...prev, [index]: { success: false, message: detail } }));
      } else {
        setGitTestResultBySource(prev => ({
          ...prev,
          [index]: { success: false, message: err.response?.data?.error || 'Connection failed' },
        }));
      }
    } finally {
      setIsTestingGitConnectionBySource(prev => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-600" />
            <span className="font-medium text-gray-900 text-sm">Git Repositories</span>
          </div>
          <button onClick={() => removeSource(index)} className="text-red-500 hover:text-red-700 p-1" title="Remove">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Platform selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['github', 'gitlab', 'bitbucket', 'azure'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => updateSource(index, 'platform', p)}
              className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${source.platform === p
                  ? 'border-purple-500 bg-purple-50 text-purple-700 font-medium'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
            >
              {p === 'github' ? 'GitHub' : p === 'gitlab' ? 'GitLab' : p === 'bitbucket' ? 'Bitbucket' : 'Azure DevOps'}
            </button>
          ))}
        </div>

        {/* Scope selector */}
        <div className="flex gap-2">
          <button type="button" onClick={() => updateSource(index, 'scope', 'organization')} className={`flex-1 px-3 py-1.5 text-xs border rounded-lg ${source.scope === 'organization' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {source.platform === 'gitlab' ? 'Group / User' : source.platform === 'bitbucket' ? 'Workspace' : 'Organization / User'}
          </button>
          <button type="button" onClick={() => updateSource(index, 'scope', 'single_repo')} className={`flex-1 px-3 py-1.5 text-xs border rounded-lg ${source.scope === 'single_repo' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            Single Repository
          </button>
        </div>

        {/* Platform-specific fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(source.platform === 'github' || source.platform === 'azure') && (
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">
                {source.scope === 'single_repo'
                  ? 'Owner'
                  : source.platform === 'azure'
                    ? 'Organization'
                    : 'Organization or Username'}
              </label>
              <input type="text" value={source.organization || ''} onChange={(e) => updateSource(index, 'organization', e.target.value)} onBlur={() => trimSourceField(index, 'organization')} placeholder={source.platform === 'azure' ? 'my-azure-org' : source.scope === 'single_repo' ? 'owner' : 'my-org, my-username, or owner/repo'} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
              {source.platform === 'github' && source.scope === 'organization' && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Works with GitHub organizations and personal user accounts. To back up a <strong>single private repo where you're a collaborator</strong>, paste the full <code className="px-1 rounded bg-gray-100">owner/repo</code> slug (e.g. <code className="px-1 rounded bg-gray-100">my-org/my-repo</code> or <code className="px-1 rounded bg-gray-100">someuser/their-repo</code>).
                </p>
              )}
            </div>
          )}
          {source.platform === 'gitlab' && (
            <>
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">{source.scope === 'single_repo' ? 'Owner / Group' : 'Group'}</label>
                <input type="text" value={source.group || ''} onChange={(e) => updateSource(index, 'group', e.target.value)} onBlur={() => trimSourceField(index, 'group')} placeholder="my-group" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
              </div>
              {source.scope === 'organization' && !source.group && (
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">Or Username</label>
                  <input type="text" value={source.user || ''} onChange={(e) => updateSource(index, 'user', e.target.value)} onBlur={() => trimSourceField(index, 'user')} placeholder="my-username" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">GitLab Host</label>
                <input type="text" value={source.host || ''} onChange={(e) => updateSource(index, 'host', e.target.value)} onBlur={() => trimSourceField(index, 'host')} placeholder="https://gitlab.com" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
              </div>
            </>
          )}
          {source.platform === 'bitbucket' && (
            <>
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">Workspace</label>
                <input type="text" value={source.workspace || ''} onChange={(e) => updateSource(index, 'workspace', e.target.value)} onBlur={() => trimSourceField(index, 'workspace')} placeholder="my-workspace" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">Project (optional)</label>
                <input type="text" value={source.project || ''} onChange={(e) => updateSource(index, 'project', e.target.value)} onBlur={() => trimSourceField(index, 'project')} placeholder="PRJ" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
              </div>
            </>
          )}
          {source.platform === 'azure' && (
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Project (optional)</label>
              <input type="text" value={source.project || ''} onChange={(e) => updateSource(index, 'project', e.target.value)} onBlur={() => trimSourceField(index, 'project')} placeholder="Leave empty for all projects" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
            </div>
          )}
          {source.scope === 'single_repo' && (
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Repository Name</label>
              <input type="text" value={source.repo_name || ''} onChange={(e) => updateSource(index, 'repo_name', e.target.value)} onBlur={() => trimSourceField(index, 'repo_name')} placeholder="my-repo" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
            </div>
          )}
        </div>

        {/* Authentication */}
        <div className="space-y-2">
          {source.platform === 'bitbucket' && (
            <div className="flex gap-2">
              <button type="button" onClick={() => {
                const newSources = [...formData.sources];
                newSources[index] = { ...newSources[index], bb_auth_mode: 'api_token', bb_app_password: '' };
                setFormData({ ...formData, sources: newSources });
              }} className={`flex-1 px-3 py-1.5 text-xs border rounded-lg ${(!source.bb_auth_mode || source.bb_auth_mode === 'api_token' || source.bb_auth_mode === 'access_token') ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                API Token
              </button>
              <button type="button" onClick={() => {
                const newSources = [...formData.sources];
                newSources[index] = { ...newSources[index], bb_auth_mode: 'app_password', pat: '' };
                setFormData({ ...formData, sources: newSources });
              }} className={`flex-1 px-3 py-1.5 text-xs border rounded-lg ${source.bb_auth_mode === 'app_password' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                App Password
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {source.platform === 'bitbucket' && source.bb_auth_mode === 'app_password' ? (
              <>
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">Username</label>
                  <input type="text" value={source.bb_username || ''} onChange={(e) => updateSource(index, 'bb_username', e.target.value)} onBlur={() => trimSourceField(index, 'bb_username')} placeholder="Bitbucket username" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">App Password</label>
                  <div className="relative">
                    <input type={showGitPat[index] ? 'text' : 'password'} value={source.bb_app_password || ''} onChange={(e) => updateSource(index, 'bb_app_password', e.target.value)} placeholder="App password" className="w-full px-2 py-1.5 pr-8 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    <button type="button" onClick={() => setShowGitPat(prev => ({ ...prev, [index]: !prev[index] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showGitPat[index] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </>
            ) : source.platform === 'bitbucket' ? (
              <>
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">Username or Email</label>
                  <input type="text" value={source.bb_username || ''} onChange={(e) => updateSource(index, 'bb_username', e.target.value)} onBlur={() => trimSourceField(index, 'bb_username')} placeholder="Bitbucket username or Atlassian email" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">API Token</label>
                  <div className="relative">
                    <input type={showGitPat[index] ? 'text' : 'password'} value={source.pat || ''} onChange={(e) => updateSource(index, 'pat', e.target.value)} placeholder="ATATT3xFfGF0..." className="w-full px-2 py-1.5 pr-8 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                    <button type="button" onClick={() => setShowGitPat(prev => ({ ...prev, [index]: !prev[index] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showGitPat[index] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Create under Repository / Project / Workspace settings &rarr; Access Tokens</p>
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-600 mb-0.5">Personal Access Token (PAT)</label>
                <div className="relative">
                  <input type={showGitPat[index] ? 'text' : 'password'} value={source.pat || ''} onChange={(e) => updateSource(index, 'pat', e.target.value)} placeholder={source.platform === 'github' ? 'ghp_...' : source.platform === 'gitlab' ? 'glpat-...' : 'PAT'} className="w-full px-2 py-1.5 pr-8 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
                  <button type="button" onClick={() => setShowGitPat(prev => ({ ...prev, [index]: !prev[index] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showGitPat[index] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Backup Type */}
        <div>
          <label className="block text-xs text-gray-600 mb-1">Backup Type</label>
          <div className="flex gap-2">
            {(['mirror', 'clone', 'both'] as const).map(bt => (
              <button key={bt} type="button" onClick={() => updateSource(index, 'backup_type', bt)} className={`flex-1 px-3 py-1.5 text-xs border rounded-lg ${source.backup_type === bt ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                {bt === 'mirror' ? 'Mirror (bare repos)' : bt === 'clone' ? 'Clone (working copies)' : 'Both'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {source.backup_type === 'both' ? 'Runs both modes: one mirror directory plus one clone directory.' : source.backup_type === 'clone' ? 'Working copies with checked-out files. Larger on disk. Best for browsing and searching code.' : 'Recommended. Bare git mirrors — smallest size, fastest, all refs preserved. Easily restorable with git push --mirror.'}
          </p>
        </div>

        {/* Target Directory */}
        <PathSelectorField label="Target Directory" value={source.target_dir || ''} onChange={(value: string) => updateSource(index, 'target_dir', value)} placeholder="/mnt/git-backups/my-org" helperText="Persistent directory where repositories will be stored. Repos are cloned once and updated incrementally on each backup run." selectMode="directories" required />
        {source.backup_type === 'both' && (
          <PathSelectorField label="Clone Target Directory" value={source.target_dir_clone || ''} onChange={(value: string) => updateSource(index, 'target_dir_clone', value)} placeholder="/mnt/git-backups/my-org-clone" helperText="Second persistent directory used for clone mode when Backup Type is set to Both." selectMode="directories" required />
        )}

        {/* Options */}
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-1.5" title="Create subdirectories per project/org inside the target directory"><input type="checkbox" checked={source.group_by_project !== false} onChange={(e) => updateSource(index, 'group_by_project', e.target.checked)} className="rounded border-gray-300" /> Group by project</label>
          <label className="flex items-center gap-1.5" title="Remove local branches/tags that no longer exist on the remote"><input type="checkbox" checked={source.prune !== false} onChange={(e) => updateSource(index, 'prune', e.target.checked)} className="rounded border-gray-300" /> Prune deleted branches</label>
          {source.platform === 'github' && (
            <>
              <label className="flex items-center gap-1.5" title="Include private repos. Requires PAT with 'repo' scope (classic) or fine-grained PAT with matching resource owner"><input type="checkbox" checked={source.include_private !== false} onChange={(e) => updateSource(index, 'include_private', e.target.checked)} className="rounded border-gray-300" /> Include private</label>
              <label className="flex items-center gap-1.5" title="Include forked repositories. Usually disabled to avoid backing up copies of upstream repos"><input type="checkbox" checked={!!source.include_forks} onChange={(e) => updateSource(index, 'include_forks', e.target.checked)} className="rounded border-gray-300" /> Include forks</label>
            </>
          )}
          {source.platform === 'gitlab' && (
            <>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!source.include_archived} onChange={(e) => updateSource(index, 'include_archived', e.target.checked)} className="rounded border-gray-300" /> Include archived</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={source.include_subgroups !== false} onChange={(e) => updateSource(index, 'include_subgroups', e.target.checked)} className="rounded border-gray-300" /> Include subgroups</label>
            </>
          )}
        </div>

        {/* Discover / Test buttons */}
        <div className="flex gap-2 flex-wrap">
          {source.scope === 'organization' && (
            <button type="button" onClick={handleDiscoverRepos} disabled={!!isDiscoveringGitReposBySource[index]} className="px-3 py-1.5 text-xs border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50 flex items-center gap-1">
              {!!isDiscoveringGitReposBySource[index] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Discover Repos
            </button>
          )}
          <button type="button" onClick={handleTestConnection} disabled={!!isTestingGitConnectionBySource[index]} className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1">
            {!!isTestingGitConnectionBySource[index] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Test Connection
          </button>
        </div>

        {/* Test result */}
        {gitTestResultBySource[index]?.message && (
          <div className={`p-2 rounded text-xs ${gitTestResultBySource[index]?.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            <div className="flex items-start gap-1">
              {gitTestResultBySource[index]?.success ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
              <span className="whitespace-pre-wrap">{gitTestResultBySource[index]?.message}</span>
            </div>
          </div>
        )}

        {/* Discovered repos selection panel */}
        {!!showGitRepoResultsBySource[index] && (gitDiscoveredReposBySource[index] || []).length > 0 && source.scope === 'organization' && (
          <div className="border border-purple-200 rounded-lg p-3 bg-purple-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-purple-800">{(gitDiscoveredReposBySource[index] || []).length} {(gitDiscoveredReposBySource[index] || []).length === 1 ? 'repository' : 'repositories'} found</span>
              <button type="button" onClick={() => setShowGitRepoResultsBySource(prev => ({ ...prev, [index]: false }))} className="text-purple-500 hover:text-purple-700"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => updateSource(index, 'repo_selection', 'all')} className={`px-2 py-1 text-xs rounded ${source.repo_selection === 'all' ? 'bg-purple-600 text-white' : 'bg-white text-purple-700 border border-purple-300'}`}>All repos (including future)</button>
              <button type="button" onClick={() => { const newSources = [...formData.sources]; newSources[index] = { ...newSources[index], repo_selection: 'selected', selected_repos: (gitSelectedReposBySource[index] || []) }; setFormData({ ...formData, sources: newSources }); }} className={`px-2 py-1 text-xs rounded ${source.repo_selection === 'selected' ? 'bg-purple-600 text-white' : 'bg-white text-purple-700 border border-purple-300'}`}>Selected repos only</button>
            </div>
            {source.repo_selection === 'all' && (<p className="text-xs text-purple-700">All repositories will be backed up, including any new repos added to the organization in the future.</p>)}
            {source.repo_selection === 'selected' && (
              <>
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={() => { const all = (gitDiscoveredReposBySource[index] || []).map(r => r.id || `${r.group}/${r.name}`); setGitSelectedReposBySource(prev => ({ ...prev, [index]: all })); updateSource(index, 'selected_repos', all); }} className="text-xs text-purple-600 hover:text-purple-800">Select All</button>
                  <button type="button" onClick={() => { setGitSelectedReposBySource(prev => ({ ...prev, [index]: [] })); updateSource(index, 'selected_repos', []); }} className="text-xs text-purple-600 hover:text-purple-800">Deselect All</button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {(gitDiscoveredReposBySource[index] || []).map(repo => (
                    <label key={repo.id || `${repo.group}/${repo.name}`} className="flex items-center gap-1.5 text-xs text-gray-800 cursor-pointer hover:bg-purple-100 px-1 py-0.5 rounded">
                      <input type="checkbox" checked={(gitSelectedReposBySource[index] || []).includes(repo.id || `${repo.group}/${repo.name}`)} onChange={() => { const repoId = repo.id || `${repo.group}/${repo.name}`; const selected = gitSelectedReposBySource[index] || []; const next = selected.includes(repoId) ? selected.filter(n => n !== repoId) : [...selected, repoId]; setGitSelectedReposBySource(prev => ({ ...prev, [index]: next })); updateSource(index, 'selected_repos', next); }} className="rounded border-gray-300" />
                      <span className="text-gray-500">{repo.group} /</span> {repo.name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Show selected repos summary when panel is closed */}
        {source.repo_selection === 'selected' && Array.isArray(source.selected_repos) && source.selected_repos.length > 0 && !showGitRepoResultsBySource[index] && (
          <p className="text-xs text-gray-500">{source.selected_repos.length} selected repo{source.selected_repos.length !== 1 ? 's' : ''}: {source.selected_repos.slice(0, 5).join(', ')}{source.selected_repos.length > 5 ? ` +${source.selected_repos.length - 5} more` : ''}</p>
        )}
      </div>
    </div>
  );
};

export default WizardStepSources;
