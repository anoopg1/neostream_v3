import { useState, useEffect, useRef, useCallback } from 'react';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS     = 30000;

/**
 * Connects to a WebSocket server and provides the last received event.
 * Automatically reconnects on disconnect with exponential backoff.
 *
 * @param {string} url - WebSocket server URL.
 * @returns {{ lastEvent: object|null, isConnected: boolean }}
 */
export function useWebSocket(url) {
  const [lastEvent,    setLastEvent]    = useState(null);
  const [isConnected,  setIsConnected]  = useState(false);
  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const delayRef     = useRef(INITIAL_RECONNECT_DELAY_MS);
  const mountedRef   = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        delayRef.current = INITIAL_RECONNECT_DELAY_MS;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const parsed = JSON.parse(event.data);
          setLastEvent(parsed);
        } catch (_) {}
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      scheduleReconnect();
    }
  }, [url]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => {
      delayRef.current = Math.min(delayRef.current * 2, MAX_RECONNECT_DELAY_MS);
      connect();
    }, delayRef.current);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { lastEvent, isConnected };
}
