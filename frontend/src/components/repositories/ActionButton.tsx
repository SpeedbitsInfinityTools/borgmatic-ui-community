import React, { useState } from 'react';
import { Loader, Info } from 'lucide-react';

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  color?: 'primary' | 'warning' | 'secondary' | 'error' | 'info';
  showInfoIcon?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  label,
  tooltip,
  onClick,
  loading = false,
  disabled = false,
  color = 'primary',
  showInfoIcon = true,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const colorClasses: Record<string, string> = {
    primary: 'border-blue-500 text-blue-600 hover:bg-blue-50 hover:border-blue-600',
    warning: 'border-orange-500 text-orange-600 hover:bg-orange-50 hover:border-orange-600',
    secondary: 'border-purple-500 text-purple-600 hover:bg-purple-50 hover:border-purple-600',
    error: 'border-red-500 text-red-600 hover:bg-red-50 hover:border-red-600',
    info: 'border-cyan-500 text-cyan-600 hover:bg-cyan-50 hover:border-cyan-600',
  };

  const disabledClasses = 'opacity-50 cursor-not-allowed hover:bg-transparent';

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className={`
          flex items-center space-x-1 px-2 py-1 border rounded text-xs font-medium 
          transition-colors duration-150
          ${colorClasses[color]}
          ${(loading || disabled) ? disabledClasses : ''}
        `}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
      >
        {loading ? (
          <Loader className="w-3.5 h-3.5 animate-spin" />
        ) : (
          icon
        )}
        <span>{label}</span>
        {showInfoIcon && (
          <Info className="w-2.5 h-2.5 opacity-40" />
        )}
      </button>

      {showTooltip && tooltip && (
        <div 
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 
                     bg-gray-900 text-white text-xs rounded-lg shadow-lg max-w-xs z-50
                     whitespace-normal text-center"
          role="tooltip"
        >
          {tooltip}
          <div 
            className="absolute top-full left-1/2 -translate-x-1/2 
                       border-4 border-transparent border-t-gray-900"
          />
        </div>
      )}
    </div>
  );
};

export default ActionButton;

