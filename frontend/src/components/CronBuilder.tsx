import React, { useState, useEffect } from 'react';
import { X, Clock, Calendar, CalendarDays, Timer, Wand2 } from 'lucide-react';

interface CronBuilderProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (cronExpression: string) => void;
    initialExpression?: string;
}

type ScheduleType = 'simple' | 'advanced';
type SimpleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

const WEEKDAYS = [
    { value: 0, label: 'Sun', fullLabel: 'Sunday' },
    { value: 1, label: 'Mon', fullLabel: 'Monday' },
    { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
    { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
    { value: 4, label: 'Thu', fullLabel: 'Thursday' },
    { value: 5, label: 'Fri', fullLabel: 'Friday' },
    { value: 6, label: 'Sat', fullLabel: 'Saturday' },
];

const MONTHS = [
    { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
    { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
    { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
    { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

const CronBuilder: React.FC<CronBuilderProps> = ({
    isOpen,
    onClose,
    onApply,
    initialExpression = '0 2 * * *',
}) => {
    const [scheduleType, setScheduleType] = useState<ScheduleType>('simple');
    const [frequency, setFrequency] = useState<SimpleFrequency>('daily');

    // Simple mode state
    const [hour, setHour] = useState(2);
    const [minute, setMinute] = useState(0);
    const [everyNHours, setEveryNHours] = useState(1);
    const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([0]); // Sunday
    const [dayOfMonth, setDayOfMonth] = useState(1);
    const [selectedMonths, setSelectedMonths] = useState<number[]>([]);

    // Advanced mode state (raw cron parts)
    const [cronMinute, setCronMinute] = useState('0');
    const [cronHour, setCronHour] = useState('2');
    const [cronDay, setCronDay] = useState('*');
    const [cronMonth, setCronMonth] = useState('*');
    const [cronWeekday, setCronWeekday] = useState('*');

    // Parse initial expression
    useEffect(() => {
        if (initialExpression) {
            parseExpression(initialExpression);
        }
    }, [initialExpression]);

    const parseExpression = (expr: string) => {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return;

        const [min, hr, day, month, weekday] = parts;

        // Set advanced mode values
        setCronMinute(min);
        setCronHour(hr);
        setCronDay(day);
        setCronMonth(month);
        setCronWeekday(weekday);

        // Try to determine simple mode settings
        const minuteNum = parseInt(min);
        const hourNum = parseInt(hr);

        if (!isNaN(minuteNum)) setMinute(minuteNum);
        if (!isNaN(hourNum)) setHour(hourNum);

        // Detect frequency
        if (hr.startsWith('*/')) {
            setFrequency('hourly');
            setEveryNHours(parseInt(hr.replace('*/', '')) || 1);
        } else if (day === '*' && month === '*' && weekday === '*') {
            setFrequency('daily');
        } else if (day === '*' && month === '*' && weekday !== '*') {
            setFrequency('weekly');
            // Parse weekdays
            const days = weekday.split(',').map(d => parseInt(d)).filter(d => !isNaN(d));
            if (days.length > 0) setSelectedWeekdays(days);
        } else if (weekday === '*' && month === '*' && day !== '*') {
            setFrequency('monthly');
            const dayNum = parseInt(day);
            if (!isNaN(dayNum)) setDayOfMonth(dayNum);
        } else {
            setFrequency('custom');
            setScheduleType('advanced');
        }
    };

    // Generate cron expression from current state
    const generateExpression = (): string => {
        if (scheduleType === 'advanced') {
            return `${cronMinute} ${cronHour} ${cronDay} ${cronMonth} ${cronWeekday}`;
        }

        switch (frequency) {
            case 'hourly':
                if (everyNHours === 1) {
                    return `${minute} * * * *`;
                }
                return `${minute} */${everyNHours} * * *`;

            case 'daily':
                return `${minute} ${hour} * * *`;

            case 'weekly':
                const weekdayStr = selectedWeekdays.length > 0
                    ? selectedWeekdays.sort((a, b) => a - b).join(',')
                    : '*';
                return `${minute} ${hour} * * ${weekdayStr}`;

            case 'monthly':
                const monthStr = selectedMonths.length > 0
                    ? selectedMonths.sort((a, b) => a - b).join(',')
                    : '*';
                return `${minute} ${hour} ${dayOfMonth} ${monthStr} *`;

            case 'custom':
                return `${cronMinute} ${cronHour} ${cronDay} ${cronMonth} ${cronWeekday}`;

            default:
                return '0 2 * * *';
        }
    };

    const cronExpression = generateExpression();

    // Human-readable description
    const getDescription = (): string => {
        if (scheduleType === 'advanced' || frequency === 'custom') {
            return 'Custom schedule (see expression below)';
        }

        switch (frequency) {
            case 'hourly':
                if (everyNHours === 1) {
                    return `Every hour at minute ${minute}`;
                }
                return `Every ${everyNHours} hours at minute ${minute}`;

            case 'daily':
                return `Daily at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

            case 'weekly':
                const dayNames = selectedWeekdays.map(d => WEEKDAYS.find(w => w.value === d)?.fullLabel).join(', ');
                return `Every ${dayNames || 'day'} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

            case 'monthly':
                const monthNames = selectedMonths.length > 0
                    ? selectedMonths.map(m => MONTHS.find(mo => mo.value === m)?.label).join(', ')
                    : 'every month';
                const dayStr = dayOfMonth === 1 ? '1st' : dayOfMonth === 2 ? '2nd' : dayOfMonth === 3 ? '3rd' : `${dayOfMonth}th`;
                return `On the ${dayStr} of ${monthNames} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

            default:
                return 'Custom schedule';
        }
    };

    const toggleWeekday = (day: number) => {
        setSelectedWeekdays(prev =>
            prev.includes(day)
                ? prev.filter(d => d !== day)
                : [...prev, day]
        );
    };

    const toggleMonth = (month: number) => {
        setSelectedMonths(prev =>
            prev.includes(month)
                ? prev.filter(m => m !== month)
                : [...prev, month]
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <Wand2 className="w-6 h-6 text-white" />
                        <h2 className="text-xl font-semibold text-white">Cron Builder</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Mode Toggle */}
                    <div className="flex rounded-lg bg-gray-100 p-1">
                        <button
                            type="button"
                            onClick={() => setScheduleType('simple')}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${scheduleType === 'simple'
                                ? 'bg-white shadow text-blue-600'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Simple Mode
                        </button>
                        <button
                            type="button"
                            onClick={() => setScheduleType('advanced')}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${scheduleType === 'advanced'
                                ? 'bg-white shadow text-blue-600'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Advanced Mode
                        </button>
                    </div>

                    {scheduleType === 'simple' ? (
                        <>
                            {/* Frequency Selection */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-3">
                                    How often?
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[
                                        { value: 'hourly', label: 'Hourly', icon: Timer },
                                        { value: 'daily', label: 'Daily', icon: Clock },
                                        { value: 'weekly', label: 'Weekly', icon: Calendar },
                                        { value: 'monthly', label: 'Monthly', icon: CalendarDays },
                                    ].map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setFrequency(opt.value as SimpleFrequency)}
                                            className={`flex flex-col items-center p-3 rounded-lg border-2 transition-all ${frequency === opt.value
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                                }`}
                                        >
                                            <opt.icon className="w-5 h-5 mb-1" />
                                            <span className="text-sm font-medium">{opt.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Hourly Options */}
                            {frequency === 'hourly' && (
                                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Run every
                                        </label>
                                        <div className="flex items-center space-x-2">
                                            <select
                                                value={everyNHours}
                                                onChange={(e) => setEveryNHours(parseInt(e.target.value))}
                                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                                                    <option key={n} value={n}>{n}</option>
                                                ))}
                                            </select>
                                            <span className="text-gray-600">hour(s)</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            At minute
                                        </label>
                                        <select
                                            value={minute}
                                            onChange={(e) => setMinute(parseInt(e.target.value))}
                                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            {[0, 15, 30, 45].map((m) => (
                                                <option key={m} value={m}>:{m.toString().padStart(2, '0')}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* Daily Options */}
                            {frequency === 'daily' && (
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        At what time?
                                    </label>
                                    <div className="flex items-center space-x-2">
                                        <select
                                            value={hour}
                                            onChange={(e) => setHour(parseInt(e.target.value))}
                                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                            ))}
                                        </select>
                                        <span className="text-gray-500">:</span>
                                        <select
                                            value={minute}
                                            onChange={(e) => setMinute(parseInt(e.target.value))}
                                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            {Array.from({ length: 60 }, (_, i) => (
                                                <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* Weekly Options */}
                            {frequency === 'weekly' && (
                                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            On which days?
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {WEEKDAYS.map((day) => (
                                                <button
                                                    key={day.value}
                                                    type="button"
                                                    onClick={() => toggleWeekday(day.value)}
                                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedWeekdays.includes(day.value)
                                                        ? 'bg-blue-600 text-white'
                                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {day.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            At what time?
                                        </label>
                                        <div className="flex items-center space-x-2">
                                            <select
                                                value={hour}
                                                onChange={(e) => setHour(parseInt(e.target.value))}
                                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                {Array.from({ length: 24 }, (_, i) => (
                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                            <span className="text-gray-500">:</span>
                                            <select
                                                value={minute}
                                                onChange={(e) => setMinute(parseInt(e.target.value))}
                                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                {Array.from({ length: 60 }, (_, i) => (
                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Monthly Options */}
                            {frequency === 'monthly' && (
                                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            On which day of month?
                                        </label>
                                        <select
                                            value={dayOfMonth}
                                            onChange={(e) => setDayOfMonth(parseInt(e.target.value))}
                                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            {Array.from({ length: 28 }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>{i + 1}</option>
                                            ))}
                                        </select>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Using day 1-28 ensures the schedule runs every month
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Which months? (leave empty for all)
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {MONTHS.map((month) => (
                                                <button
                                                    key={month.value}
                                                    type="button"
                                                    onClick={() => toggleMonth(month.value)}
                                                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedMonths.includes(month.value)
                                                        ? 'bg-blue-600 text-white'
                                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {month.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            At what time?
                                        </label>
                                        <div className="flex items-center space-x-2">
                                            <select
                                                value={hour}
                                                onChange={(e) => setHour(parseInt(e.target.value))}
                                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                {Array.from({ length: 24 }, (_, i) => (
                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                            <span className="text-gray-500">:</span>
                                            <select
                                                value={minute}
                                                onChange={(e) => setMinute(parseInt(e.target.value))}
                                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                {Array.from({ length: 60 }, (_, i) => (
                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        /* Advanced Mode */
                        <div className="space-y-4">
                            <p className="text-sm text-gray-600">
                                Enter each part of the cron expression manually. Format: <code className="bg-gray-100 px-1 rounded">minute hour day month weekday</code>
                            </p>

                            <div className="grid grid-cols-5 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Minute</label>
                                    <input
                                        type="text"
                                        value={cronMinute}
                                        onChange={(e) => setCronMinute(e.target.value)}
                                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-center font-mono text-sm focus:ring-2 focus:ring-blue-500"
                                        placeholder="0-59"
                                    />
                                    <p className="mt-1 text-xs text-gray-400 text-center">0-59</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Hour</label>
                                    <input
                                        type="text"
                                        value={cronHour}
                                        onChange={(e) => setCronHour(e.target.value)}
                                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-center font-mono text-sm focus:ring-2 focus:ring-blue-500"
                                        placeholder="0-23"
                                    />
                                    <p className="mt-1 text-xs text-gray-400 text-center">0-23</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Day</label>
                                    <input
                                        type="text"
                                        value={cronDay}
                                        onChange={(e) => setCronDay(e.target.value)}
                                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-center font-mono text-sm focus:ring-2 focus:ring-blue-500"
                                        placeholder="1-31"
                                    />
                                    <p className="mt-1 text-xs text-gray-400 text-center">1-31</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
                                    <input
                                        type="text"
                                        value={cronMonth}
                                        onChange={(e) => setCronMonth(e.target.value)}
                                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-center font-mono text-sm focus:ring-2 focus:ring-blue-500"
                                        placeholder="1-12"
                                    />
                                    <p className="mt-1 text-xs text-gray-400 text-center">1-12</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Weekday</label>
                                    <input
                                        type="text"
                                        value={cronWeekday}
                                        onChange={(e) => setCronWeekday(e.target.value)}
                                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-center font-mono text-sm focus:ring-2 focus:ring-blue-500"
                                        placeholder="0-6"
                                    />
                                    <p className="mt-1 text-xs text-gray-400 text-center">0-6 (Sun-Sat)</p>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                                <strong>Tips:</strong>
                                <ul className="mt-1 list-disc list-inside text-xs space-y-1">
                                    <li><code>*</code> = any value</li>
                                    <li><code>*/5</code> = every 5 units</li>
                                    <li><code>1,15</code> = at 1 and 15</li>
                                    <li><code>1-5</code> = from 1 to 5</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Preview */}
                    <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg p-4 text-white">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-gray-400 uppercase tracking-wide">Generated Expression</span>
                            <span className="text-xs text-gray-400">{getDescription()}</span>
                        </div>
                        <code className="text-xl font-mono text-green-400">{cronExpression}</code>
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-4 bg-gray-50 flex items-center justify-end space-x-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onApply(cronExpression);
                            onClose();
                        }}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                    >
                        <Wand2 className="w-4 h-4" />
                        <span>Apply Expression</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CronBuilder;

