import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store/dashboard-store';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const { fetchModel, setConnected } = useDashboardStore();

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'model-update') {
            fetchModel();
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect after 1 second
        reconnectTimerRef.current = window.setTimeout(connect, 1000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchModel, setConnected]);
}
