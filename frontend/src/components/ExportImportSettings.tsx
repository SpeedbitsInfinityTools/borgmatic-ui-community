import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  Download,
  Upload,
  FileText,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader,
  Shield,
  Package,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { configExportAPI, dashboardAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface ExportPreview {
  repositories: number;
  backups: number;
  schedules: number;
  scripts: number;
  ssh_keys: number;
  has_notification_settings: boolean;
  has_system_settings: boolean;
}

interface ImportPreview {
  encrypted: boolean;
  decrypted?: boolean;
  version: string;
  exported_at: string | null;
  repositories: number;
  backups: number;
  schedules: number;
  scripts: number;
  ssh_keys: number;
  has_notification_settings: boolean;
  has_system_settings: boolean;
}

interface ImportResult {
  success: boolean;
  repositories_created: number;
  repositories_updated: number;
  repositories_skipped: number;
  backups_created: number;
  backups_updated: number;
  backups_skipped: number;
  schedules_created: number;
  schedules_updated?: number;
  schedules_skipped?: number;
  scripts_created: number;
  scripts_updated?: number;
  scripts_skipped?: number;
  warnings: string[];
  errors: string[];
  preview: Array<{ type: string; name: string; action: string; reason?: string }>;
}

const ExportImportSettings: React.FC = () => {
  const { user } = useAuth();
  // Export state
  const [exportType, setExportType] = useState<'standard' | 'encrypted'>('encrypted');
  const [isExporting, setIsExporting] = useState(false);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState<'skip' | 'update' | 'rename' | 'replace'>('skip');
  const [showPreviewDetails, setShowPreviewDetails] = useState(false);

  // Emergency Viewer state
  const [viewerFile, setViewerFile] = useState<File | null>(null);
  const [viewerPassword, setViewerPassword] = useState('');
  const [showViewerPassword, setShowViewerPassword] = useState(false);
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerFileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleDownloadVaultMasterKey = async () => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      return;
    }
    try {
      const response = await dashboardAPI.downloadVaultMasterKey();
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '.secret_key';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Vault master key downloaded');
    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Failed to download vault master key'));
    }
  };

  async function getErrorDetail(error: any, fallback: string) {
    // Axios with responseType: 'blob' returns Blob in error.response.data
    const data = error?.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        try {
          const json = JSON.parse(text);
          return json.detail || json.error || fallback;
        } catch {
          return text || fallback;
        }
      } catch {
        return fallback;
      }
    }
    return error?.response?.data?.detail || error?.response?.data?.error || error?.message || fallback;
  }

  // Fetch export preview
  const { data: exportPreviewData, isLoading: loadingPreview } = useQuery({
    queryKey: ['export-preview'],
    queryFn: async () => {
      const response = await configExportAPI.getExportPreview();
      return response.data.data.summary as ExportPreview;
    },
    enabled: !!user?.is_admin,
  });

  // Export mutation
  const handleExport = async () => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      return;
    }

    setIsExporting(true);

    try {
      const response = await configExportAPI.export({
        encrypted: exportType === 'encrypted',
        includeSecrets: exportType === 'encrypted',
        includeSchedules: true,
        includeScripts: true,
        includeNotifications: true,
      });

      // Download file
      const contentDisposition = response.headers['content-disposition'] || '';
      let filename = exportType === 'encrypted' 
        ? `borgmatic-ui-export-${new Date().toISOString().split('T')[0]}.encrypted.yaml`
        : `borgmatic-ui-export-${new Date().toISOString().split('T')[0]}.yaml`;

      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }

      const blob = new Blob([response.data], { type: 'application/x-yaml' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('Configuration exported successfully');

    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Failed to export configuration'));
    } finally {
      setIsExporting(false);
    }
  };

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      // Reset input so the same file can be selected again later
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
      toast.error('Please select a YAML file');
      return;
    }

    setImportFile(file);
    setImportResult(null);
    setImportPreview(null);
    setImportPassword('');

    // Get preview
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await configExportAPI.previewImport(formData);
      const preview = response.data.data;

      if (preview.requires_password) {
        setImportPreview({ encrypted: true } as ImportPreview);
      } else {
        setImportPreview(preview.summary);
      }
    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Failed to read file'));
      setImportFile(null);
    }
  };

  // Decrypt file
  const handleDecrypt = async () => {
    if (!importFile || !importPassword) return;

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('masterPassword', importPassword);

      const response = await configExportAPI.decryptImport(formData);
      setImportPreview(response.data.data.summary);
      toast.success('File decrypted successfully');
    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Decryption failed - check your password'));
    }
  };

  // Import configuration
  const handleImport = async (dryRun: boolean = false) => {
    if (!importFile) return;

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('mergeStrategy', mergeStrategy);
      formData.append('dryRun', String(dryRun));
      if (importPreview?.encrypted && importPassword) {
        formData.append('masterPassword', importPassword);
      }

      const response = await configExportAPI.import(formData);
      setImportResult(response.data.data);

      if (!dryRun && response.data.data.success) {
        toast.success('Configuration imported successfully');
        queryClient.invalidateQueries();
      } else if (dryRun) {
        toast.success('Preview generated');
        setShowPreviewDetails(true);
      }
    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Import failed'));
    }
  };

  // Emergency Viewer - Decrypt and display
  const handleViewerDecrypt = async () => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      return;
    }
    if (!viewerFile || !viewerPassword) {
      toast.error('Please select a file and enter the password');
      return;
    }

    setIsDecrypting(true);
    try {
      const formData = new FormData();
      formData.append('file', viewerFile);
      formData.append('masterPassword', viewerPassword);

      const response = await configExportAPI.viewDecrypted(formData);
      
      // The backend returns the full YAML content as a string
      const content = response.data.data.content;
      setViewerContent(content);
      toast.success('File decrypted successfully');
    } catch (error: any) {
      toast.error(await getErrorDetail(error, 'Decryption failed - check your password'));
      setViewerContent(null);
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleViewerFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user?.is_admin) {
      toast.error('Admin access required');
      // Reset input so the same file can be selected again later
      if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
      toast.error('Please select a YAML file');
      if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
      return;
    }

    setViewerFile(file);
    setViewerContent(null);
    setViewerPassword('');
    // Reset input so the same file can be selected again later
    if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
  };

  return (
    <div className="space-y-8">
      {!user?.is_admin && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium">Admin access required</p>
              <p className="mt-1 text-xs">
                Export/Import includes system configuration and can include secrets. Please log in as an admin user.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Vault Master Key (do NOT confuse with config export) */}
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <Lock className="w-6 h-6 text-gray-700" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Master Vault Key</h3>
            <p className="text-sm text-gray-500">
              Download <span className="font-mono">.secret_key</span> (used to decrypt the local vault: <span className="font-mono">passphrases.json</span>)
            </p>
          </div>
        </div>

        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg mb-4">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-yellow-700 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-yellow-900">
              <p className="font-medium">Important: this is NOT the same as “Export Configuration”.</p>
              <p className="mt-1 text-xs text-yellow-800">
                - <strong>Master Vault Key</strong> is required to decrypt stored secrets (repo passphrases, SSH secrets, DB credentials).<br />
                - <strong>Export Configuration</strong> exports settings/repos/backups (optionally encrypted with a separate password).
              </p>
              <p className="mt-2 text-xs text-yellow-800">
                Store <span className="font-mono">.secret_key</span> offline. If you lose it, previously stored secrets cannot be recovered.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleDownloadVaultMasterKey}
          disabled={!user?.is_admin}
          className="btn-secondary flex items-center space-x-2"
        >
          <Download className="w-4 h-4" />
          <span>Export Master Vault Key (.secret_key)</span>
        </button>
      </div>

      {/* Export Section */}
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <Download className="w-6 h-6 text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Configuration</h3>
            <p className="text-sm text-gray-500">
              Export your repositories, backups, and settings to a file
            </p>
          </div>
        </div>

        {/* Export Summary */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium text-gray-700 mb-3">What will be exported:</p>
          {!user?.is_admin ? (
            <p className="text-sm text-gray-500">Sign in as admin to view export summary.</p>
          ) : loadingPreview ? (
            <div className="flex items-center space-x-2 text-gray-500">
              <Loader className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : exportPreviewData ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center space-x-2">
                <Package className="w-4 h-4 text-gray-400" />
                <span>{exportPreviewData.repositories} Repositories</span>
              </div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span>{exportPreviewData.backups} Backups</span>
              </div>
              <div className="flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 text-gray-400" />
                <span>{exportPreviewData.schedules} Schedules</span>
              </div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span>{exportPreviewData.scripts} Scripts</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No data to export</p>
          )}
        </div>

        {/* Export Type Selection */}
        <div className="space-y-4 mb-6">
          <label className="block text-sm font-medium text-gray-700">Export Type</label>
          
          <div className="space-y-3">
            <label className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
              exportType === 'standard' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}>
              <input
                type="radio"
                name="exportType"
                value="standard"
                checked={exportType === 'standard'}
                onChange={() => setExportType('standard')}
                className="mt-1"
              />
              <div className="ml-3">
                <div className="flex items-center space-x-2">
                  <Unlock className="w-4 h-4 text-gray-500" />
                  <span className="font-medium text-gray-900">Standard Export</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Configuration only. No passwords, keys, or secrets included.
                </p>
              </div>
            </label>

            <label className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
              exportType === 'encrypted' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}>
              <input
                type="radio"
                name="exportType"
                value="encrypted"
                checked={exportType === 'encrypted'}
                onChange={() => setExportType('encrypted')}
                className="mt-1"
              />
              <div className="ml-3">
                <div className="flex items-center space-x-2">
                  <Lock className="w-4 h-4 text-green-600" />
                  <span className="font-medium text-gray-900">Encrypted Export</span>
                  <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                    Recommended
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Full backup including passwords, SSH keys, and all secrets. Protected with AES-256 encryption.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Encrypted Export (uses vault master key) */}
        {exportType === 'encrypted' && (
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg mb-6">
            <div className="flex items-center space-x-2 mb-3">
              <Shield className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-gray-900">Encryption</span>
            </div>

            <div className="flex items-start space-x-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-800">
                <strong>Encrypted export uses your Master Vault Key:</strong> We encrypt this export using the same key (<span className="font-mono">.secret_key</span>) that protects your vault.
                Download it above and store it safely.
              </p>
            </div>
          </div>
        )}

        {/* Export Button */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="btn-primary flex items-center space-x-2 disabled:opacity-50"
        >
          {isExporting ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              <span>Exporting...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Export Configuration</span>
            </>
          )}
        </button>
      </div>

      {/* Import Section */}
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <Upload className="w-6 h-6 text-green-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Import Configuration</h3>
            <p className="text-sm text-gray-500">
              Import a previously exported configuration file
            </p>
          </div>
        </div>

        {/* File Upload */}
        <div className="mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              importFile ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
            }`}
          >
            {importFile ? (
              <div className="flex items-center justify-center space-x-3">
                <FileText className="w-8 h-8 text-green-600" />
                <div className="text-left">
                  <p className="font-medium text-gray-900">{importFile.name}</p>
                  <p className="text-sm text-gray-500">
                    {(importFile.size / 1024).toFixed(1)} KB
                    {importPreview?.encrypted && !importPreview?.decrypted && (
                      <span className="ml-2 text-yellow-600">🔒 Encrypted</span>
                    )}
                    {importPreview?.encrypted && importPreview?.decrypted && (
                      <span className="ml-2 text-green-600">🔓 Decrypted</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setImportFile(null);
                    setImportPreview(null);
                    setImportResult(null);
                    setImportPassword('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="p-1 text-gray-400 hover:text-red-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">Drop a YAML file here or click to browse</p>
                <p className="text-sm text-gray-400 mt-1">Supports .yaml and .yml files</p>
              </>
            )}
          </div>
        </div>

        {/* Encrypted File Password */}
        {importPreview?.encrypted && !importPreview?.decrypted && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center space-x-2 mb-3">
              <Lock className="w-5 h-5 text-yellow-600" />
              <span className="font-medium text-gray-900">Encrypted File</span>
            </div>
            <p className="text-sm text-yellow-800 mb-3">
              This file is encrypted. Enter the <strong>Vault Master Key</strong> (<span className="font-mono">.secret_key</span>) or the password that was used to create the export.
            </p>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  type={showImportPassword ? 'text' : 'password'}
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Enter vault master key / export password"
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowImportPassword(!showImportPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showImportPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleDecrypt}
                disabled={!importPassword}
                className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
              >
                <Unlock className="w-4 h-4" />
                <span>Decrypt</span>
              </button>
            </div>
          </div>
        )}

        {/* Import Preview */}
        {importPreview && (!importPreview.encrypted || importPreview.decrypted) && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-3">File Contents:</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center space-x-2">
                <Package className="w-4 h-4 text-gray-400" />
                <span>{importPreview.repositories} Repositories</span>
              </div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span>{importPreview.backups} Backups</span>
              </div>
              <div className="flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 text-gray-400" />
                <span>{importPreview.schedules} Schedules</span>
              </div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span>{importPreview.scripts} Scripts</span>
              </div>
            </div>
            {importPreview.exported_at && (
              <p className="text-xs text-gray-500 mt-2">
                Exported: {new Date(importPreview.exported_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Merge Strategy */}
        {importPreview && (!importPreview.encrypted || importPreview.decrypted) && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Conflict Resolution
            </label>
            <select
              value={mergeStrategy}
              onChange={(e) => setMergeStrategy(e.target.value as any)}
              className="input"
            >
              <option value="skip">Skip Duplicates - Keep existing configurations</option>
              <option value="update">Update - Merge with existing configurations</option>
              <option value="rename">Rename - Auto-rename imported items</option>
              <option value="replace">Replace - Overwrite existing configurations</option>
            </select>
          </div>
        )}

        {/* Import Result */}
        {importResult && (
          <div className={`mb-6 p-4 rounded-lg ${
            importResult.success && importResult.errors.length === 0
              ? 'bg-green-50 border border-green-200'
              : importResult.success
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-center space-x-2 mb-3">
              {importResult.success && importResult.errors.length === 0 ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : importResult.success ? (
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <span className="font-medium text-gray-900">
                {importResult.success ? 'Import Summary' : 'Import Failed'}
              </span>
            </div>

            {importResult.success && (
              <div className="space-y-1 text-sm">
                <p>Repositories: {importResult.repositories_created} created, {importResult.repositories_updated} updated, {importResult.repositories_skipped} skipped</p>
                <p>Backups: {importResult.backups_created} created, {importResult.backups_updated} updated, {importResult.backups_skipped} skipped</p>
                <p>Schedules: {importResult.schedules_created} created{typeof importResult.schedules_updated === 'number' ? `, ${importResult.schedules_updated} updated` : ''}{typeof importResult.schedules_skipped === 'number' ? `, ${importResult.schedules_skipped} skipped` : ''}</p>
                <p>Scripts: {importResult.scripts_created} created{typeof importResult.scripts_updated === 'number' ? `, ${importResult.scripts_updated} updated` : ''}{typeof importResult.scripts_skipped === 'number' ? `, ${importResult.scripts_skipped} skipped` : ''}</p>
              </div>
            )}

            {importResult.warnings.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-yellow-800">Warnings:</p>
                {importResult.warnings.map((warning, idx) => (
                  <p key={idx} className="text-sm text-yellow-700">• {warning}</p>
                ))}
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-red-800">Errors:</p>
                {importResult.errors.map((error, idx) => (
                  <p key={idx} className="text-sm text-red-700">• {error}</p>
                ))}
              </div>
            )}

            {/* Preview Details */}
            {importResult.preview && importResult.preview.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowPreviewDetails(!showPreviewDetails)}
                  className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  {showPreviewDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <span>Details ({importResult.preview.length} items)</span>
                </button>
                {showPreviewDetails && (
                  <div className="mt-2 max-h-48 overflow-y-auto bg-white rounded border p-2">
                    {importResult.preview.map((item, idx) => (
                      <div key={idx} className="flex items-center space-x-2 text-xs py-1">
                        {item.action === 'create' && <span className="text-green-600">✚ NEW</span>}
                        {item.action === 'update' && <span className="text-blue-600">⟳ UPDATE</span>}
                        {item.action === 'skip' && <span className="text-gray-400">⊘ SKIP</span>}
                        <span className="text-gray-500">{item.type}:</span>
                        <span className="text-gray-900">{item.name}</span>
                        {item.reason && <span className="text-gray-400">({item.reason})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Import Buttons */}
        {importPreview && (!importPreview.encrypted || importPreview.decrypted) && (
          <div className="flex space-x-3">
            <button
              onClick={() => handleImport(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => handleImport(false)}
              className="btn-primary flex items-center space-x-2"
            >
              <Upload className="w-4 h-4" />
              <span>Import</span>
            </button>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">After importing:</p>
              <ul className="list-disc list-inside mt-1 text-xs space-y-0.5">
                <li>For encrypted imports: passwords and SSH keys are automatically restored</li>
                <li>For standard imports: you'll need to re-enter passphrases and configure SSH keys</li>
                <li>Test connections to remote repositories before running backups</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Emergency Viewer Section */}
      <div className="card">
        <div className="flex items-center space-x-3 mb-4">
          <Eye className="w-6 h-6 text-orange-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Emergency Viewer</h3>
            <p className="text-sm text-gray-500">
              Decrypt and view the entire contents of an encrypted export, including all passwords and secrets
            </p>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-800">
              <p className="font-medium">Security Warning</p>
              <p className="mt-1">
                This viewer will display all sensitive information including passwords, SSH keys, and repository passphrases in plain text.
                Use only for emergency recovery or troubleshooting.
              </p>
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="mb-6">
          <input
            ref={viewerFileInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={handleViewerFileSelect}
            className="hidden"
          />
          
          <div
            onClick={() => {
              if (!user?.is_admin) {
                toast.error('Admin access required');
                return;
              }
              viewerFileInputRef.current?.click();
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              !user?.is_admin
                ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                : viewerFile
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50'
            }`}
          >
            {viewerFile ? (
              <div className="flex items-center justify-center space-x-3">
                <Lock className="w-6 h-6 text-orange-600" />
                <div className="text-left">
                  <p className="font-medium text-gray-900">{viewerFile.name}</p>
                  <p className="text-sm text-gray-500">
                    {(viewerFile.size / 1024).toFixed(1)} KB - Encrypted Export
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewerFile(null);
                    setViewerContent(null);
                    setViewerPassword('');
                    if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
                  }}
                  className="p-1 text-gray-400 hover:text-red-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <>
                <Lock className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">Select an encrypted export file</p>
                <p className="text-sm text-gray-400 mt-1">Only works with encrypted .yaml files</p>
              </>
            )}
          </div>
        </div>

        {/* Password Input */}
        {viewerFile && !viewerContent && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vault Master Key / Export Password
            </label>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  type={showViewerPassword ? 'text' : 'password'}
                  value={viewerPassword}
                  onChange={(e) => setViewerPassword(e.target.value)}
                  placeholder="Enter vault master key / export password"
                  className="input pr-10"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && viewerPassword) {
                      handleViewerDecrypt();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowViewerPassword(!showViewerPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showViewerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleViewerDecrypt}
                disabled={!viewerPassword || isDecrypting}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50"
              >
                {isDecrypting ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Decrypting...</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-4 h-4" />
                    <span>Decrypt & View</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Decrypted Content Viewer */}
        {viewerContent && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Decrypted Successfully</span>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(viewerContent);
                    toast.success('Copied to clipboard');
                  }}
                  className="btn-secondary text-sm flex items-center space-x-1"
                >
                  <FileText className="w-4 h-4" />
                  <span>Copy</span>
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([viewerContent], { type: 'text/yaml' });
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `decrypted-${viewerFile?.name || 'export.yaml'}`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(url);
                    toast.success('Downloaded');
                  }}
                  className="btn-secondary text-sm flex items-center space-x-1"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => {
                    setViewerContent(null);
                    setViewerFile(null);
                    setViewerPassword('');
                    if (viewerFileInputRef.current) viewerFileInputRef.current.value = '';
                  }}
                  className="btn-secondary text-sm flex items-center space-x-1"
                >
                  <X className="w-4 h-4" />
                  <span>Close</span>
                </button>
              </div>
            </div>

            {/* Content Display */}
            <div className="relative">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-96 overflow-y-auto">
                {viewerContent}
              </pre>
            </div>

            {/* Warning */}
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-yellow-800">
                  <strong>Remember:</strong> This content contains sensitive information. Treat it as confidential and delete it securely when done.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportImportSettings;

