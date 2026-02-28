import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

interface SSEContextType {
  isConnected: boolean;
  lastEvent: SSEEvent | null;
  events: SSEEvent[];
  clearEvents: () => void;
}

const SSEContext = createContext<SSEContextType | undefined>(undefined);

export const SSEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const hasEverHadTokenRef = useRef<boolean>(false);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const maxAttemptsLoggedRef = useRef<boolean>(false);

  const connect = useCallback(() => {
    // Stop reconnecting if we've exceeded max attempts
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      // Only log once to avoid console spam
      if (!maxAttemptsLoggedRef.current) {
        console.warn(`🛑 SSE: Max reconnection attempts (${maxReconnectAttempts}) reached. Giving up.`);
        console.info('💡 SSE: Real-time features are disabled. The UI will continue to work without live updates.');
        maxAttemptsLoggedRef.current = true;
      }
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Check if we have a valid token
      const token = localStorage.getItem('access_token');
      if (!token) {
        // This commonly happens on first load before login. We'll retry shortly.
        console.log('⚠️ No access token found, skipping SSE connection (will retry)');
        return;
      }
      hasEverHadTokenRef.current = true;

      // Use Vite proxy in development (avoids CORS issues)
      const url = `/api/events/stream?token=${token}`;
      console.log('🔌 Creating SSE connection via proxy:', url);
      const eventSource = new EventSource(url);

      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // Reset counter on successful connection
        maxAttemptsLoggedRef.current = false; // Reset the logged flag
        console.log('✅ SSE connection established');
      };

      eventSource.onmessage = (event) => {
        try {
          const sseEvent: SSEEvent = JSON.parse(event.data);
          console.log('📡 SSE Event:', sseEvent.type, sseEvent.data);

          setLastEvent(sseEvent);
          setEvents(prev => [...prev.slice(-99), sseEvent]); // Keep last 100 events
        } catch (error) {
          console.error('Failed to parse SSE event:', error);
        }
      };

      eventSource.onerror = () => {
        reconnectAttemptsRef.current += 1;

        console.error(`❌ SSE connection error (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}):`, {
          readyState: eventSource.readyState,
          url: eventSource.url
        });

        setIsConnected(false);

        // Close the failed connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Only reconnect if we haven't exceeded max attempts
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          // Reconnect after 5 seconds to prevent rapid reconnections
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null; // Clear ref so token poll can work if this fails
            console.log(`🔄 Attempting to reconnect SSE (${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})...`);
            connect();
          }, 5000);
        } else {
          console.warn('🛑 SSE: Stopped reconnection attempts. Real-time features disabled.');
          console.warn('💡 SSE: The application will continue to work, but live updates are unavailable.');
        }
      };

    } catch (error) {
      console.error('Failed to create SSE connection:', error);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (tokenPollIntervalRef.current) {
      clearInterval(tokenPollIntervalRef.current);
      tokenPollIntervalRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
    console.log('SSE connection closed');
  }, []);

  useEffect(() => {
    // Attempt to connect on mount. If there's no token yet (login flow),
    // keep retrying until the token exists.
    connect();

    tokenPollIntervalRef.current = setInterval(() => {
      const token = localStorage.getItem('access_token');
      if (!token) {
        // Token removed (logout/session expired): ensure SSE is closed.
        // Only do this if we've ever had a token, to avoid noisy logs on cold start.
        if (hasEverHadTokenRef.current && eventSourceRef.current) {
          disconnect();
        }
        return;
      }

      // Token exists:
      // - If we never connected yet (initial login), connect.
      // - If SSE errored and is waiting for backoff (reconnectTimeoutRef), do NOT override it.
      if (!eventSourceRef.current && !reconnectTimeoutRef.current) {
        connect();
      }
    }, 1000);

    // Cleanup on unmount
    return () => {
      disconnect();
    };
    // NOTE: Do NOT include isConnected in deps - it would cause infinite reconnection loop!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SSEContext.Provider value={{ isConnected, lastEvent, events, clearEvents }}>
      {children}
    </SSEContext.Provider>
  );
};

export const useSSEContext = () => {
  const context = useContext(SSEContext);
  if (context === undefined) {
    throw new Error('useSSEContext must be used within SSEProvider');
  }
  return context;
};

