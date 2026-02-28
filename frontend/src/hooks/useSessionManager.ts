import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const SESSION_CHECK_INTERVAL = 60 * 1000; // Check session status every 1 minute
const WARNING_THRESHOLD = 5 * 60; // Warn when 5 minutes remaining (in seconds)

/**
 * Session Manager Hook
 * 
 * IMPORTANT: Heartbeats are ONLY sent when there's actual user activity!
 * This ensures inactive users are automatically logged out after 30 minutes.
 * 
 * How it works:
 * 1. User makes ANY API request -> backend updates "last activity" time
 * 2. User moves mouse/keyboard -> heartbeat sent after 2s of inactivity (max once per minute)
 * 3. Session check runs every 1 minute to warn user when close to expiration
 * 4. After 30 minutes of NO activity -> automatic logout
 */
export const useSessionManager = () => {
  const navigate = useNavigate();
  const sessionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const warningShownRef = useRef(false);

  /**
   * Send heartbeat to server to keep session alive
   */
  const sendHeartbeat = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.log('⏰ No token found, stopping heartbeat');
        return;
      }

      const response = await axios.post(
        '/api/auth/heartbeat',
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.data.success) {
        console.log('💓 Heartbeat sent successfully');
        warningShownRef.current = false; // Reset warning flag

        // Log session info
        if (response.data.session) {
          const { expiresInMinutes, expiresInSeconds } = response.data.session;
          console.log(`⏰ Session expires in ${expiresInMinutes} minutes (${expiresInSeconds}s)`);

          // Show warning if session is about to expire
          if (expiresInSeconds <= WARNING_THRESHOLD && !warningShownRef.current) {
            toast('⚠️ Your session will expire soon. Move your mouse to keep it active.', {
              duration: 8000,
              icon: '⏰',
            });
            warningShownRef.current = true;
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Heartbeat failed:', error.response?.data || error.message);

      // Check if session expired
      if (error.response?.status === 401) {
        const isSessionExpired = error.response?.data?.session_expired ||
          error.response?.data?.error === 'Session expired';

        if (isSessionExpired) {
          handleSessionExpired();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  /**
   * Check session status
   */
  const checkSessionStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await axios.get('/api/auth/session', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.data.success && response.data.session) {
        const { expiresInSeconds, isValid } = response.data.session;

        if (!isValid) {
          handleSessionExpired();
          return;
        }

        // Show warning if close to expiration
        if (expiresInSeconds <= WARNING_THRESHOLD && !warningShownRef.current) {
          toast('⚠️ Your session will expire soon. Move your mouse to keep it active.', {
            duration: 8000,
            icon: '⏰',
          });
          warningShownRef.current = true;
        }
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handleSessionExpired();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  /**
   * Handle session expiration
   */
  const handleSessionExpired = useCallback(() => {
    console.log('🚪 Session expired due to 30 minutes of inactivity, logging out...');

    // Clear intervals
    if (sessionCheckIntervalRef.current) {
      clearInterval(sessionCheckIntervalRef.current);
      sessionCheckIntervalRef.current = null;
    }

    // Clear local storage
    localStorage.removeItem('token');

    // Show notification
    toast.error('Session expired due to inactivity. Please log in again.', {
      duration: 5000,
    });

    // Redirect to login
    navigate('/login');
  }, [navigate]);

  /**
   * Start session management
   */
  const startSessionManager = useCallback(() => {
    console.log('🔄 Starting session manager...');

    // NOTE: We do NOT send automatic heartbeats on a timer!
    // Heartbeats are only sent when there's actual user activity (mouse, keyboard, etc.)
    // This ensures inactive users are logged out after 30 minutes.

    // Set up session check interval (every 1 minute) to warn user before expiration
    sessionCheckIntervalRef.current = setInterval(() => {
      checkSessionStatus();
    }, SESSION_CHECK_INTERVAL);

    console.log(`⏰ Session check scheduled every ${SESSION_CHECK_INTERVAL / 1000 / 60} minute(s)`);
    console.log(`💓 Heartbeats will be sent on user activity (not on timer)`);
  }, [checkSessionStatus]);

  /**
   * Stop session management
   */
  const stopSessionManager = useCallback(() => {
    console.log('🛑 Stopping session manager...');

    if (sessionCheckIntervalRef.current) {
      clearInterval(sessionCheckIntervalRef.current);
      sessionCheckIntervalRef.current = null;
    }
  }, []);

  /**
   * Initialize session manager on mount
   */
  useEffect(() => {
    const token = localStorage.getItem('token');

    if (token) {
      startSessionManager();
    }

    // Cleanup on unmount
    return () => {
      stopSessionManager();
    };
  }, [startSessionManager, stopSessionManager]);

  /**
   * Track user activity (mouse movement, keyboard, etc.)
   * Send heartbeat ONLY when user is actually active
   */
  useEffect(() => {
    let activityTimer: NodeJS.Timeout | null = null;
    let lastHeartbeat = Date.now();
    const MIN_HEARTBEAT_INTERVAL = 60 * 1000; // Don't send heartbeat more than once per minute

    const handleActivity = () => {
      const now = Date.now();

      // Debounce activity events
      if (activityTimer) {
        clearTimeout(activityTimer);
      }

      // Only send heartbeat if enough time has passed since last one
      // This prevents excessive API calls while still updating activity
      if (now - lastHeartbeat >= MIN_HEARTBEAT_INTERVAL) {
        activityTimer = setTimeout(() => {
          const token = localStorage.getItem('token');
          if (token) {
            console.log('👆 User activity detected, sending heartbeat...');
            sendHeartbeat();
            lastHeartbeat = Date.now();
          }
        }, 2000); // Wait 2 seconds after activity stops
      }
    };

    // Listen for user activity
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    console.log('👂 Listening for user activity...');

    return () => {
      if (activityTimer) {
        clearTimeout(activityTimer);
      }
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [sendHeartbeat]);

  return {
    sendHeartbeat,
    checkSessionStatus,
    handleSessionExpired,
    startSessionManager,
    stopSessionManager
  };
};

