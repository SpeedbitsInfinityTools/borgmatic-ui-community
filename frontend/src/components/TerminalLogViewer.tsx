import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal,
  Search,
  Download,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  Bug,
  X,
  Loader,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface LogLine {
  lineNumber: number;
  timestamp?: string;
  level?: 'error' | 'warning' | 'info' | 'success' | 'debug' | 'unknown';
  message: string;
  raw: string;
}

interface TerminalLogViewerProps {
  logs: string[];
  title?: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  maxHeight?: string;
  showLineNumbers?: boolean;
  showTimestamps?: boolean;
  showSearch?: boolean;
  showControls?: boolean;
  autoScroll?: boolean;
  className?: string;
  onClear?: () => void;
}

// Parse log level from a line
const parseLogLevel = (line: string): 'error' | 'warning' | 'info' | 'success' | 'debug' | 'unknown' => {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal') || lower.includes('critical')) {
    return 'error';
  }
  if (lower.includes('warn')) {
    return 'warning';
  }
  if (lower.includes('success') || lower.includes('completed successfully') || lower.includes('done')) {
    return 'success';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  if (lower.includes('info') || lower.includes('starting') || lower.includes('processing')) {
    return 'info';
  }
  return 'unknown';
};

// Parse timestamp from log line
const parseTimestamp = (line: string): string | undefined => {
  // Common timestamp patterns
  const patterns = [
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
    /(\d{2}:\d{2}:\d{2})/,
    /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return undefined;
};

// Clean borgmatic log metadata like [,264] or [123,456]
const cleanLogLine = (line: string): string => {
  let cleaned = line.replace(/^\[\s*,?\d+\]\s*/g, '');
  cleaned = cleaned.replace(/^\[\d+,\d+\]\s*/g, '');
  return cleaned.trim();
};

// Get level colors for terminal theme
const getLevelStyles = (level: string) => {
  switch (level) {
    case 'error':
      return 'text-red-400';
    case 'warning':
      return 'text-yellow-400';
    case 'success':
      return 'text-green-400';
    case 'info':
      return 'text-blue-400';
    case 'debug':
      return 'text-gray-500';
    default:
      return 'text-gray-300';
  }
};

// Get level badge colors
const getLevelBadge = (level: string) => {
  switch (level) {
    case 'error':
      return 'bg-red-600 text-white';
    case 'warning':
      return 'bg-yellow-600 text-white';
    case 'success':
      return 'bg-green-600 text-white';
    case 'info':
      return 'bg-blue-600 text-white';
    case 'debug':
      return 'bg-gray-600 text-white';
    default:
      return 'bg-gray-700 text-gray-300';
  }
};

// Get level icon
const getLevelIcon = (level: string) => {
  const iconClass = 'w-3.5 h-3.5';
  switch (level) {
    case 'error':
      return <AlertCircle className={`${iconClass} text-red-400`} />;
    case 'warning':
      return <AlertTriangle className={`${iconClass} text-yellow-400`} />;
    case 'success':
      return <CheckCircle className={`${iconClass} text-green-400`} />;
    case 'info':
      return <Info className={`${iconClass} text-blue-400`} />;
    case 'debug':
      return <Bug className={`${iconClass} text-gray-500`} />;
    default:
      return <Terminal className={`${iconClass} text-gray-400`} />;
  }
};

const TerminalLogViewer: React.FC<TerminalLogViewerProps> = ({
  logs,
  title = 'Terminal',
  isLoading = false,
  isStreaming = false,
  maxHeight = '500px',
  showLineNumbers = true,
  showTimestamps = true,
  showSearch = true,
  showControls = true,
  autoScroll: initialAutoScroll = true,
  className = '',
  onClear,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(initialAutoScroll);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Parse logs into structured format
  const parsedLogs: LogLine[] = useMemo(() => {
    return logs.map((raw, index) => {
      const cleaned = cleanLogLine(raw);
      return {
        lineNumber: index + 1,
        timestamp: parseTimestamp(cleaned),
        level: parseLogLevel(cleaned),
        message: cleaned,
        raw,
      };
    });
  }, [logs]);

  // Filter logs by search
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return parsedLogs;
    const query = searchQuery.toLowerCase();
    return parsedLogs.filter(log => log.message.toLowerCase().includes(query));
  }, [parsedLogs, searchQuery]);

  // Search matches for navigation
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return parsedLogs
      .map((log, idx) => ({ log, idx }))
      .filter(({ log }) => log.message.toLowerCase().includes(query));
  }, [parsedLogs, searchQuery]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Scroll handler to detect manual scrolling
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  };

  // Jump to line
  const jumpToLine = (lineNumber: number) => {
    const element = document.getElementById(`log-line-${lineNumber}`);
    if (element && scrollRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Navigate search results
  const navigateSearch = (direction: 'next' | 'prev') => {
    if (searchMatches.length === 0) return;
    let newIndex = searchMatchIndex;
    if (direction === 'next') {
      newIndex = (searchMatchIndex + 1) % searchMatches.length;
    } else {
      newIndex = searchMatchIndex === 0 ? searchMatches.length - 1 : searchMatchIndex - 1;
    }
    setSearchMatchIndex(newIndex);
    jumpToLine(searchMatches[newIndex].log.lineNumber);
  };

  // Copy logs to clipboard
  const copyToClipboard = async () => {
    const text = filteredLogs.map(l => l.raw).join('\n');
    await navigator.clipboard.writeText(text);
    toast.success('Logs copied to clipboard');
  };

  // Download logs
  const downloadLogs = () => {
    const text = filteredLogs.map(l => l.raw).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Logs downloaded');
  };

  // Highlight search matches in text
  const highlightMatches = (text: string) => {
    if (!searchQuery.trim()) return text;
    const query = searchQuery.toLowerCase();
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query ? (
        <span key={i} className="bg-yellow-500 text-black px-0.5 rounded">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  // Stats
  const stats = useMemo(() => ({
    total: parsedLogs.length,
    errors: parsedLogs.filter(l => l.level === 'error').length,
    warnings: parsedLogs.filter(l => l.level === 'warning').length,
  }), [parsedLogs]);

  return (
    <div
      ref={containerRef}
      className={`bg-gray-900 rounded-lg overflow-hidden shadow-xl ${
        isFullscreen ? 'fixed inset-4 z-50' : ''
      } ${className}`}
    >
      {/* Header */}
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-3">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-gray-200">{title}</span>
          {isStreaming && (
            <span className="flex items-center space-x-1 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>Live</span>
            </span>
          )}
          {isLoading && (
            <Loader className="w-4 h-4 text-blue-400 animate-spin" />
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Stats */}
          <div className="flex items-center space-x-3 text-xs mr-4">
            <span className="text-gray-400">{stats.total} lines</span>
            {stats.errors > 0 && (
              <span className="text-red-400">{stats.errors} errors</span>
            )}
            {stats.warnings > 0 && (
              <span className="text-yellow-400">{stats.warnings} warnings</span>
            )}
          </div>

          {showControls && (
            <>
              {/* Search toggle */}
              {showSearch && (
                <button
                  onClick={() => setShowSearchBar(!showSearchBar)}
                  className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${
                    showSearchBar ? 'bg-gray-700 text-blue-400' : 'text-gray-400'
                  }`}
                  title="Search"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}

              {/* Auto-scroll toggle */}
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`p-1.5 rounded hover:bg-gray-700 transition-colors ${
                  autoScroll ? 'bg-gray-700 text-green-400' : 'text-gray-400'
                }`}
                title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
              >
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* Copy */}
              <button
                onClick={copyToClipboard}
                className="p-1.5 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                title="Copy to clipboard"
              >
                <Copy className="w-4 h-4" />
              </button>

              {/* Download */}
              <button
                onClick={downloadLogs}
                className="p-1.5 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                title="Download logs"
              >
                <Download className="w-4 h-4" />
              </button>

              {/* Fullscreen */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>

              {/* Clear */}
              {onClear && (
                <button
                  onClick={onClear}
                  className="p-1.5 rounded text-gray-400 hover:bg-gray-700 hover:text-red-400 transition-colors"
                  title="Clear logs"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Search Bar */}
      {showSearchBar && (
        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchMatchIndex(0);
              }}
              placeholder="Search logs..."
              className="w-full pl-10 pr-4 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          {searchQuery && (
            <>
              <span className="text-xs text-gray-400">
                {searchMatches.length > 0
                  ? `${searchMatchIndex + 1} / ${searchMatches.length}`
                  : 'No matches'}
              </span>
              <button
                onClick={() => navigateSearch('prev')}
                disabled={searchMatches.length === 0}
                className="p-1 rounded text-gray-400 hover:bg-gray-700 disabled:opacity-50"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigateSearch('next')}
                disabled={searchMatches.length === 0}
                className="p-1 rounded text-gray-400 hover:bg-gray-700 disabled:opacity-50"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchBar(false);
                }}
                className="p-1 rounded text-gray-400 hover:bg-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Log Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto font-mono text-sm"
        style={{ maxHeight: isFullscreen ? 'calc(100vh - 150px)' : maxHeight }}
      >
        {isLoading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 text-gray-500 animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Terminal className="w-8 h-8 mb-2" />
            <span className="text-sm">
              {searchQuery ? 'No matching logs found' : 'No logs available'}
            </span>
          </div>
        ) : (
          <table className="w-full">
            <tbody>
              {filteredLogs.map((log) => (
                <tr
                  key={log.lineNumber}
                  id={`log-line-${log.lineNumber}`}
                  className={`hover:bg-gray-800/50 ${
                    searchMatches[searchMatchIndex]?.log.lineNumber === log.lineNumber
                      ? 'bg-blue-900/30'
                      : ''
                  }`}
                >
                  {/* Line Number */}
                  {showLineNumbers && (
                    <td className="w-12 text-right pr-3 text-gray-600 select-none border-r border-gray-800 align-top py-0.5">
                      {log.lineNumber}
                    </td>
                  )}

                  {/* Level Icon */}
                  <td className="w-8 text-center align-top py-0.5">
                    {getLevelIcon(log.level || 'unknown')}
                  </td>

                  {/* Timestamp */}
                  {showTimestamps && log.timestamp && (
                    <td className="w-28 text-gray-500 text-xs align-top py-0.5 whitespace-nowrap pr-2">
                      {log.timestamp}
                    </td>
                  )}

                  {/* Message */}
                  <td className={`px-2 py-0.5 whitespace-pre-wrap break-all ${getLevelStyles(log.level || 'unknown')}`}>
                    {highlightMatches(log.message)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer - scroll to top/bottom */}
      {logs.length > 0 && (
        <div className="bg-gray-800 px-4 py-1.5 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {filteredLogs.length} of {parsedLogs.length} lines
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = 0;
                  setAutoScroll(false);
                }
              }}
              className="px-2 py-0.5 rounded hover:bg-gray-700 hover:text-gray-300 transition-colors"
            >
              ↑ Top
            </button>
            <button
              onClick={() => {
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                  setAutoScroll(true);
                }
              }}
              className="px-2 py-0.5 rounded hover:bg-gray-700 hover:text-gray-300 transition-colors"
            >
              ↓ Bottom
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalLogViewer;

