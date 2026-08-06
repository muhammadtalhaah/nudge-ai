/**
 * Socket.IO connection lifecycle.
 *
 * Owns exactly one concern: keeping a connection open while authenticated, and reporting its
 * status. Consumers subscribe to events through the returned socket; this hook does not
 * interpret any of them.
 */

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { getAccessToken } from '@/api/client';
import { useAuth } from '@/context/AuthContext';

/**
 * Connection states worth showing a user. 'reconnecting' is deliberately distinct from
 * 'disconnected': the first is transient and self-healing, the second needs their attention.
 */
export const SOCKET_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
};

export const useSocket = () => {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [status, setStatus] = useState(SOCKET_STATUS.IDLE);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.close();
      socketRef.current = null;
      setStatus(SOCKET_STATUS.IDLE);
      return undefined;
    }

    setStatus(SOCKET_STATUS.CONNECTING);

    const socket = io({
      // Same origin: Vite proxies /socket.io in development and the API serves this bundle in
      // production, so there is no host to configure.
      path: '/socket.io',
      // Read lazily on every (re)connect attempt, so a token refreshed since the last attempt
      // is the one used. A captured value would go stale after 15 minutes.
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => setStatus(SOCKET_STATUS.CONNECTED));
    socket.on('disconnect', () => setStatus(SOCKET_STATUS.RECONNECTING));
    socket.io.on('reconnect_attempt', () => setStatus(SOCKET_STATUS.RECONNECTING));
    socket.io.on('reconnect', () => setStatus(SOCKET_STATUS.CONNECTED));
    // Fired once the attempt budget is exhausted — from here it will not recover on its own.
    socket.io.on('reconnect_failed', () => setStatus(SOCKET_STATUS.DISCONNECTED));
    socket.on('connect_error', () => setStatus(SOCKET_STATUS.RECONNECTING));

    socketRef.current = socket;

    return () => {
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  return { socket: socketRef.current, status };
};

export default useSocket;
