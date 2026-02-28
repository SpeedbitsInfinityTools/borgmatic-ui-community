import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import FileExplorerModal from './FileExplorerModal';

interface PathSelectorFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when path is selected via browser (not when typing). Use for path transformations. */
  onBrowseSelect?: (value: string) => string;
  placeholder?: string;
  /** Controls browser autofill behavior. Use "off" to avoid autofilling paths with usernames, etc. */
  autoComplete?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  selectMode?: 'directories' | 'files' | 'both';
  multiSelect?: boolean;
  className?: string;
  inputClassName?: string;
  error?: string;
}

const PathSelectorField: React.FC<PathSelectorFieldProps> = ({
  label,
  value,
  onChange,
  onBrowseSelect,
  placeholder = '/path/to/directory',
  autoComplete = 'off',
  helperText,
  disabled = false,
  required = false,
  selectMode = 'directories',
  multiSelect = false,
  className = '',
  inputClassName = '',
  error,
}) => {
  const [showBrowser, setShowBrowser] = useState(false);

  const handleSelect = (paths: string[]) => {
    if (paths.length > 0) {
      let selectedPath = multiSelect ? paths.join(',') : paths[0];
      // Apply transformation if onBrowseSelect is provided
      if (onBrowseSelect) {
        selectedPath = onBrowseSelect(selectedPath);
      }
      onChange(selectedPath);
    }
    setShowBrowser(false);
  };

  // Parse initial path from value
  const getInitialPath = () => {
    if (!value) return '/';
    // If multi-select, use the first path
    const firstPath = value.split(',')[0].trim();
    // Return the path directly - the file browser will open in this directory
    // If it's not a valid directory, the browser will handle the error
    return firstPath || '/';
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative flex">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          className={`
            flex-1 px-3 py-2 pr-10 border rounded-md shadow-sm 
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            ${error ? 'border-red-500' : 'border-gray-300'}
            ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}
            ${inputClassName}
          `}
        />
        <button
          type="button"
          onClick={() => setShowBrowser(true)}
          disabled={disabled}
          className={`
            absolute right-2 top-1/2 -translate-y-1/2 p-1 
            text-gray-400 hover:text-gray-600 
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          `}
          title="Browse filesystem"
        >
          <FolderOpen className="w-5 h-5" />
        </button>
      </div>
      {helperText && !error && (
        <p className="mt-1 text-xs text-gray-500">{helperText}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}

      <FileExplorerModal
        isOpen={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelect={handleSelect}
        initialPath={getInitialPath()}
        selectMode={selectMode}
        multiSelect={multiSelect}
        title={
          selectMode === 'directories'
            ? 'Select Directory'
            : selectMode === 'files'
            ? 'Select File'
            : 'Select Path'
        }
        selectButtonText="Select"
      />
    </div>
  );
};

export default PathSelectorField;

