import { useState, useEffect } from 'react';
import { useSSEContext } from '../contexts/SSEContext';

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

// Re-export the context hook as useSSE for backward compatibility
export const useSSE = () => {
  return useSSEContext();
};

// Hook for specific event types - NOW USES SHARED CONNECTION
export const useSSEEvent = (eventType: string) => {
  const { events, isConnected } = useSSEContext();

  const filteredEvents = events.filter(event => event.type === eventType);

  return {
    events: filteredEvents,
    lastEvent: filteredEvents[filteredEvents.length - 1] || null,
    isConnected
  };
};

// Hook for backup progress - NOW USES SHARED CONNECTION
export const useBackupProgress = (jobId?: string) => {
  const { events, isConnected } = useSSEContext();

  const backupEvents = events.filter(event =>
    event.type === 'backup_progress' &&
    (!jobId || event.data.job_id === jobId)
  );

  const lastProgress = backupEvents[backupEvents.length - 1] || null;

  return {
    progress: lastProgress?.data || null,
    isConnected,
    allProgress: backupEvents,
  };
};

// Hook for system status - NOW USES SHARED CONNECTION
export const useSystemStatus = () => {
  const { lastEvent, isConnected } = useSSEContext();

  const systemStatus = lastEvent?.type === 'system_status' ? lastEvent.data : null;

  return {
    systemStatus,
    isConnected,
  };
};

// Hook for tracking backup execution status - NOW USES SHARED CONNECTION
export const useBackupExecution = () => {
  const { events, isConnected } = useSSEContext();
  const [runningBackups, setRunningBackups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const running = new Set<string>();

    // Process all backup events to determine current state
    events.forEach(event => {
      if (event.type === 'backup_started') {
        running.add(event.data.backup_id);
      } else if (
        event.type === 'backup_completed' ||
        event.type === 'backup_failed' ||
        event.type === 'backup_stopped'
      ) {
        running.delete(event.data.backup_id);
      }
    });

    setRunningBackups(running);
  }, [events]);

  return {
    isRunning: (backupId: string) => runningBackups.has(backupId),
    runningBackups: Array.from(runningBackups),
    getBackupStatus: (backupId: string) => {
      const latestEvent = [...events]
        .reverse()
        .find(e =>
          (e.type === 'backup_started' ||
            e.type === 'backup_progress' ||
            e.type === 'backup_completed' ||
            e.type === 'backup_failed') &&
          e.data.backup_id === backupId
        );

      return latestEvent?.data || null;
    },
    isConnected,
  };
};
