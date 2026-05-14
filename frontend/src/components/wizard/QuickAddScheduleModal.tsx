import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from 'react-query';
import { X, Plus, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { scheduleAPI } from '../../services/api';

interface QuickAddScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
    defaultName?: string;
}

const PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at 2 AM', value: '0 2 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Weekly (Sunday)', value: '0 3 * * 0' },
    { label: 'Monthly (1st)', value: '0 2 1 * *' },
];

const QuickAddScheduleModal: React.FC<QuickAddScheduleModalProps> = ({
    isOpen,
    onClose,
    onCreated,
    defaultName = '',
}) => {
    const queryClient = useQueryClient();
    const [name, setName] = useState(defaultName);
    const [cron, setCron] = useState('0 2 * * *');
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<{ name?: string; cron?: string }>({});

    useEffect(() => {
        if (isOpen) {
            setName(defaultName);
            setCron('0 2 * * *');
            setDescription('');
            setErrors({});
        }
    }, [isOpen, defaultName]);

    const createMutation = useMutation(
        (data: any) => scheduleAPI.createSchedule(data),
        {
            onSuccess: (res) => {
                const created = res?.data?.data;
                queryClient.invalidateQueries(['schedules']);
                toast.success(`Schedule "${created?.name || name}" created`);
                const newId = created?.id;
                if (newId) onCreated(newId);
                onClose();
            },
            onError: (err: any) => {
                const msg = err?.response?.data?.error || 'Failed to create schedule';
                if (/cron/i.test(msg)) {
                    setErrors((e) => ({ ...e, cron: msg }));
                } else if (/name/i.test(msg)) {
                    setErrors((e) => ({ ...e, name: msg }));
                } else {
                    toast.error(msg);
                }
            },
        }
    );

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newErrors: { name?: string; cron?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required';
        if (!cron.trim()) newErrors.cron = 'Cron expression is required';
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;
        createMutation.mutate({
            name: name.trim(),
            cron_expression: cron.trim(),
            description: description.trim() || undefined,
            enabled: true,
        });
    };

    const handleClose = () => {
        if (createMutation.isLoading) return;
        onClose();
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
            onClick={handleClose}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-blue-600" />
                        Add Schedule
                    </h3>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                        disabled={createMutation.isLoading}
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Schedule Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (errors.name) setErrors({ ...errors, name: undefined });
                            }}
                            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.name ? 'border-red-500' : 'border-gray-300'
                                }`}
                            placeholder="e.g., Daily at 2 AM"
                            autoFocus
                        />
                        {errors.name && (
                            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{errors.name}</span>
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Cron Expression <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={cron}
                            onChange={(e) => {
                                setCron(e.target.value);
                                if (errors.cron) setErrors({ ...errors, cron: undefined });
                            }}
                            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${errors.cron ? 'border-red-500' : 'border-gray-300'
                                }`}
                            placeholder="0 2 * * *"
                        />
                        {errors.cron ? (
                            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{errors.cron}</span>
                            </p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500">
                                Format: minute hour day month weekday
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            Quick Presets
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    onClick={() => {
                                        setCron(p.value);
                                        if (errors.cron) setErrors({ ...errors, cron: undefined });
                                    }}
                                    className={`px-2 py-1.5 text-xs rounded border transition-colors text-left ${cron === p.value
                                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                        }`}
                                >
                                    <div className="font-medium">{p.label}</div>
                                    <div className="font-mono text-[11px] text-gray-500">{p.value}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description <span className="text-xs text-gray-400 font-normal">(optional)</span>
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            placeholder="Optional"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={createMutation.isLoading}
                            className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-60"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={createMutation.isLoading}
                            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                        >
                            {createMutation.isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Creating...</span>
                                </>
                            ) : (
                                <>
                                    <Plus className="w-4 h-4" />
                                    <span>Create Schedule</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default QuickAddScheduleModal;
