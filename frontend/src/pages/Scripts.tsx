import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { scriptsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import {
  Code,
  Plus,
  Play,
  Edit2,
  Trash2,
  Copy,
  FileCode,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader,
  ChevronDown,
  ChevronRight,
  Info,
  X,
} from 'lucide-react';

interface Script {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  hook_type: 'before_backup' | 'after_backup' | 'on_error';
  script: string;
  timeout: number;
  run_condition: 'always' | 'on_success' | 'on_error';
  isTemplate: boolean;
  used_by?: string[];
  created_at?: string;
  updated_at?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
}

const HOOK_TYPE_LABELS = {
  before_backup: { label: 'Before Backup', color: 'bg-blue-100 text-blue-800' },
  after_backup: { label: 'After Backup', color: 'bg-green-100 text-green-800' },
  on_error: { label: 'On Error', color: 'bg-red-100 text-red-800' },
};

const RUN_CONDITION_LABELS = {
  always: 'Always run',
  on_success: 'Only on success',
  on_error: 'Only on error',
};

export default function Scripts() {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['docker', 'database', 'custom']));
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testingScript, setTestingScript] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  // Fetch all scripts
  const { data: scriptsData, isLoading } = useQuery(
    ['scripts'],
    () => scriptsAPI.getAll(),
    { staleTime: 30000 }
  );

  // Fetch categories
  const { data: categoriesData } = useQuery(
    ['script-categories'],
    () => scriptsAPI.getCategories(),
    { staleTime: 60000 }
  );

  const scripts: Script[] = scriptsData?.data?.data?.scripts || [];
  const categories: Category[] = categoriesData?.data?.data?.categories || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => scriptsAPI.delete(id),
    onSuccess: () => {
      toast.success('Script deleted');
      queryClient.invalidateQueries(['scripts']);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete script');
    },
  });

  // Copy template mutation
  const copyTemplateMutation = useMutation({
    mutationFn: ({ templateId, name }: { templateId: string; name: string }) =>
      scriptsAPI.copyTemplate(templateId, { name }),
    onSuccess: (data) => {
      toast.success('Script copied! You can now customize it.');
      queryClient.invalidateQueries(['scripts']);
      setEditingScript(data.data.data);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to copy template');
    },
  });

  // Test mutation
  const testMutation = useMutation({
    mutationFn: (id: string) => scriptsAPI.test(id),
    onSuccess: (data) => {
      setTestResult(data.data.data);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Test failed');
      setTestResult({ success: false, error: error.response?.data?.error || 'Test failed' });
    },
  });

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleTest = (script: Script) => {
    setTestingScript(script.id);
    setTestResult(null);
    testMutation.mutate(script.id);
  };

  const handleCopyTemplate = (script: Script) => {
    copyTemplateMutation.mutate({
      templateId: script.id,
      name: `${script.name} (Copy)`,
    });
  };

  const handleDelete = (script: Script) => {
    if (script.used_by && script.used_by.length > 0) {
      toast.error(`Cannot delete: script is used by ${script.used_by.length} backup(s)`);
      return;
    }
    if (window.confirm(`Delete script "${script.name}"? This action cannot be undone.`)) {
      deleteMutation.mutate(script.id);
    }
  };

  // Group scripts by category
  const scriptsByCategory = scripts.reduce((acc, script) => {
    const cat = script.category || 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(script);
    return acc;
  }, {} as Record<string, Script[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Code className="w-8 h-8 mr-3 text-purple-600" />
            Script Library
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage pre/post backup scripts. Use templates or create custom scripts.
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>New Script</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start space-x-3">
        <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">How Scripts Work</p>
          <p className="mt-1">
            Scripts can run before or after backups. <strong>Before Backup</strong> scripts run first (e.g., stop containers, dump databases). 
            <strong> After Backup</strong> scripts run when backup completes (e.g., start containers, cleanup). 
            <strong> On Error</strong> scripts only run if the backup fails.
          </p>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-4">
        {categories.map((category) => {
          const categoryScripts = scriptsByCategory[category.id] || [];
          const isExpanded = expandedCategories.has(category.id);

          return (
            <div key={category.id} className="card overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{category.icon}</span>
                  <span className="font-medium text-gray-900">{category.name}</span>
                  <span className="text-sm text-gray-500">
                    ({categoryScripts.length} {categoryScripts.length === 1 ? 'script' : 'scripts'})
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {/* Scripts List */}
              {isExpanded && categoryScripts.length > 0 && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                  {categoryScripts.map((script) => (
                    <ScriptCard
                      key={script.id}
                      script={script}
                      onEdit={() => setEditingScript(script)}
                      onTest={() => handleTest(script)}
                      onCopy={() => handleCopyTemplate(script)}
                      onDelete={() => handleDelete(script)}
                      isTesting={testingScript === script.id && testMutation.isLoading}
                    />
                  ))}
                </div>
              )}

              {isExpanded && categoryScripts.length === 0 && (
                <div className="px-6 py-8 text-center text-gray-500 border-t border-gray-200">
                  <FileCode className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p>No scripts in this category</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Test Result Modal */}
      {testResult && (
        <TestResultModal
          result={testResult}
          onClose={() => {
            setTestResult(null);
            setTestingScript(null);
          }}
        />
      )}

      {/* Edit/Create Modal */}
      {(editingScript || isCreating) && (
        <ScriptEditorModal
          script={editingScript}
          onClose={() => {
            setEditingScript(null);
            setIsCreating(false);
          }}
          onSave={() => {
            queryClient.invalidateQueries(['scripts']);
            setEditingScript(null);
            setIsCreating(false);
          }}
        />
      )}
    </div>
  );
}

// Script Card Component
function ScriptCard({
  script,
  onEdit,
  onTest,
  onCopy,
  onDelete,
  isTesting,
}: {
  script: Script;
  onEdit: () => void;
  onTest: () => void;
  onCopy: () => void;
  onDelete: () => void;
  isTesting: boolean;
}) {
  const hookInfo = HOOK_TYPE_LABELS[script.hook_type];

  return (
    <div className="px-6 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1 min-w-0">
          <span className="text-2xl">{script.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-gray-900">{script.name}</h3>
              {script.isTemplate && (
                <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                  Template
                </span>
              )}
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${hookInfo.color}`}>
                {hookInfo.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 line-clamp-1">{script.description}</p>
            <div className="mt-2 flex items-center space-x-4 text-xs text-gray-400">
              <span className="flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                Timeout: {script.timeout}s
              </span>
              <span>{RUN_CONDITION_LABELS[script.run_condition]}</span>
              {script.used_by && script.used_by.length > 0 && (
                <span className="text-blue-600">
                  Used by {script.used_by.length} backup(s)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1 ml-4">
          <button
            onClick={onTest}
            disabled={isTesting}
            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
            title="Test script"
          >
            {isTesting ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          {script.isTemplate ? (
            <button
              onClick={onCopy}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Copy to customize"
            >
              <Copy className="w-4 h-4" />
            </button>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Edit script"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Delete script"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Test Result Modal
function TestResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <h3 className="text-lg font-semibold">
              {result.success ? 'Test Passed' : 'Test Failed'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {result.duration_ms && (
            <div className="text-sm text-gray-600">
              Duration: {result.duration_ms}ms
            </div>
          )}

          {result.output && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Output</h4>
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto font-mono">
                {result.output}
              </pre>
            </div>
          )}

          {result.errors && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Errors</h4>
              <pre className="bg-red-50 text-red-800 p-4 rounded-lg text-xs overflow-x-auto font-mono">
                {result.errors}
              </pre>
            </div>
          )}

          {result.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">{result.error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Script Editor Modal
function ScriptEditorModal({
  script,
  onClose,
  onSave,
}: {
  script: Script | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEditing = !!script && !script.isTemplate;
  const [formData, setFormData] = useState({
    name: script?.name || '',
    description: script?.description || '',
    category: script?.category || 'custom',
    icon: script?.icon || '📜',
    hook_type: script?.hook_type || 'before_backup' as const,
    script: script?.script || '#!/bin/bash\n\n# Your script here\necho "Hello from script"\n',
    timeout: script?.timeout || 300,
    run_condition: script?.run_condition || 'always' as const,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Script name is required');
      return;
    }
    if (!formData.script.trim()) {
      toast.error('Script content is required');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && script) {
        await scriptsAPI.update(script.id, formData);
        toast.success('Script updated');
      } else {
        await scriptsAPI.create(formData);
        toast.success('Script created');
      }
      onSave();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save script');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await scriptsAPI.testContent(formData.script, Math.min(formData.timeout, 30));
      setTestResult(response.data.data);
    } catch (error: any) {
      setTestResult({ success: false, error: error.response?.data?.error || 'Test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Script' : 'Create Script'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Script Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My Custom Script"
                className="input w-full"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input w-full"
              >
                <option value="docker">🐳 Docker</option>
                <option value="database">🗄️ Database</option>
                <option value="notification">📢 Notification</option>
                <option value="maintenance">🧹 Maintenance</option>
                <option value="system">💾 System</option>
                <option value="custom">📜 Custom</option>
              </select>
            </div>

            {/* Hook Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                When to Run *
              </label>
              <select
                value={formData.hook_type}
                onChange={(e) => setFormData({ ...formData, hook_type: e.target.value as any })}
                className="input w-full"
              >
                <option value="before_backup">Before Backup</option>
                <option value="after_backup">After Backup</option>
                <option value="on_error">On Error</option>
              </select>
            </div>

            {/* Run Condition */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Run Condition
              </label>
              <select
                value={formData.run_condition}
                onChange={(e) => setFormData({ ...formData, run_condition: e.target.value as any })}
                className="input w-full"
              >
                <option value="always">Always</option>
                <option value="on_success">Only on Success</option>
                <option value="on_error">Only on Error</option>
              </select>
            </div>

            {/* Timeout */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 300 })}
                min={1}
                max={3600}
                className="input w-full"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What this script does..."
                className="input w-full"
              />
            </div>
          </div>

          {/* Script Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Script Content *
            </label>
            <textarea
              value={formData.script}
              onChange={(e) => setFormData({ ...formData, script: e.target.value })}
              rows={15}
              className="input w-full font-mono text-sm"
              placeholder="#!/bin/bash&#10;&#10;# Your script here"
              spellCheck={false}
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`rounded-lg p-4 ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center space-x-2 mb-2">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
                <span className={`font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                  {testResult.success ? 'Test Passed' : 'Test Failed'}
                </span>
                {testResult.duration_ms && (
                  <span className="text-sm text-gray-500">({testResult.duration_ms}ms)</span>
                )}
              </div>
              {(testResult.output || testResult.errors || testResult.error) && (
                <pre className="text-xs font-mono whitespace-pre-wrap mt-2 p-2 bg-white rounded">
                  {testResult.output}
                  {testResult.errors}
                  {testResult.error}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={isTesting || !formData.script.trim()}
            className="btn-secondary flex items-center space-x-2"
          >
            {isTesting ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>Test Script</span>
          </button>

          <div className="flex items-center space-x-3">
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary flex items-center space-x-2"
            >
              {isSaving && <Loader className="w-4 h-4 animate-spin" />}
              <span>{isEditing ? 'Save Changes' : 'Create Script'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

