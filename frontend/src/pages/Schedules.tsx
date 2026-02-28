import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { scheduleAPI } from '../services/api';
import { Clock, Plus, Pencil, Trash2, X, Wand2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatDate } from '../utils/dateFormat';
import CronBuilder from '../components/CronBuilder';

interface Schedule {
  id: string;
  name: string;
  description: string;
  cron_expression: string;
  created_at: string;
  updated_at?: string;
}

const Schedules: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Fetch schedules
  const { data: schedulesData, isLoading } = useQuery('schedules', async () => {
    const response = await scheduleAPI.getSchedules();
    return response.data.data.schedules;
  }, {
    onError: (error: any) => {
      console.error('Failed to fetch schedules:', error);
      toast.error('Failed to load schedules');
    }
  });

  const schedules: Schedule[] = Array.isArray(schedulesData) ? schedulesData : [];

  // Create mutation
  const createMutation = useMutation(
    (data: any) => scheduleAPI.createSchedule(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('schedules');
        toast.success('Schedule created successfully');
        setIsCreateModalOpen(false);
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Failed to create schedule');
      },
    }
  );

  // Update mutation
  const updateMutation = useMutation(
    ({ id, data }: { id: string; data: any }) => scheduleAPI.updateSchedule(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('schedules');
        toast.success('Schedule updated successfully');
        setEditingSchedule(null);
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Failed to update schedule');
      },
    }
  );

  // Delete mutation
  const deleteMutation = useMutation(
    (id: string) => scheduleAPI.deleteSchedule(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('schedules');
        toast.success('Schedule deleted successfully');
        setDeleteConfirm(null);
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Failed to delete schedule');
      },
    }
  );

  const handleDelete = (scheduleId: string) => {
    if (deleteConfirm === scheduleId) {
      deleteMutation.mutate(scheduleId);
    } else {
      setDeleteConfirm(scheduleId);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Schedules</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage cron schedules that can be assigned to backups
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Create Schedule</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Clock className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No schedules</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating a new schedule.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Clock className="w-6 h-6 text-blue-600" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{schedule.name}</h3>
                    {schedule.description && (
                      <p className="text-sm text-gray-500">{schedule.description}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-600 mb-1">Cron Expression</p>
                  <code className="text-sm font-mono text-gray-900">
                    {schedule.cron_expression}
                  </code>
                </div>

                <div className="text-xs text-gray-500">
                  <span>Created: {formatDate(schedule.created_at)}</span>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-4 border-t">
                <button
                  onClick={() => setEditingSchedule(schedule)}
                  className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => handleDelete(schedule.id)}
                  className={`flex-1 flex items-center justify-center space-x-1 px-3 py-2 text-sm rounded-lg transition-colors ${deleteConfirm === schedule.id
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'text-red-600 hover:bg-red-50'
                    }`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{deleteConfirm === schedule.id ? 'Confirm?' : 'Delete'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreateModalOpen || editingSchedule) && (
        <ScheduleModal
          schedule={editingSchedule}
          onClose={() => {
            setIsCreateModalOpen(false);
            setEditingSchedule(null);
          }}
          onSubmit={(data) => {
            if (editingSchedule) {
              updateMutation.mutate({ id: editingSchedule.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
        />
      )}
    </div>
  );
};

// Schedule Modal Component
interface ScheduleModalProps {
  schedule: Schedule | null;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({ schedule, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: schedule?.name || '',
    description: schedule?.description || '',
    cron_expression: schedule?.cron_expression || '0 2 * * *',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showCronBuilder, setShowCronBuilder] = useState(false);

  const cronPresets = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at 2 AM', value: '0 2 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Weekly on Sunday', value: '0 3 * * 0' },
    { label: 'Monthly on 1st', value: '0 2 1 * *' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!formData.cron_expression.trim()) {
      newErrors.cron_expression = 'Cron expression is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {schedule ? 'Edit Schedule' : 'Create Schedule'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Schedule Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
              placeholder="e.g., Daily Backup"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cron Expression <span className="text-red-500">*</span>
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={formData.cron_expression}
                onChange={(e) =>
                  setFormData({ ...formData, cron_expression: e.target.value })
                }
                className={`flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${errors.cron_expression ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder="0 2 * * *"
              />
              <button
                type="button"
                onClick={() => setShowCronBuilder(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2"
                title="Open Cron Builder"
              >
                <Wand2 className="w-4 h-4" />
                <span>Builder</span>
              </button>
            </div>
            {errors.cron_expression && (
              <p className="mt-1 text-sm text-red-600">{errors.cron_expression}</p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Format: minute hour day month weekday — or use the Builder to create visually
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quick Presets
            </label>
            <div className="grid grid-cols-2 gap-2">
              {cronPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setFormData({ ...formData, cron_expression: preset.value })
                  }
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${formData.cron_expression === preset.value
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <div className="font-medium">{preset.label}</div>
                  <div className="text-xs font-mono text-gray-500">{preset.value}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {schedule ? 'Update Schedule' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>

      {/* Cron Builder Modal */}
      <CronBuilder
        isOpen={showCronBuilder}
        onClose={() => setShowCronBuilder(false)}
        onApply={(expression) => setFormData({ ...formData, cron_expression: expression })}
        initialExpression={formData.cron_expression}
      />
    </div>
  );
};

export default Schedules;
