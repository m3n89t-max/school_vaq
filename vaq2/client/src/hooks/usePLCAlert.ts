import { useEffect, useState, useRef, useCallback } from 'react';

// localhost로 강제 설정하여 연결 안정화
const PLC_ALERT_WS_URL = 'ws://localhost:8000/ws_alert';

export function usePLCAlert() {
  const [aiAlert, setAiAlert] = useState<string>('⚙️ AI 알림 시스템 연결 중...\n잠시만 기다려주세요');
  const [alertConnected, setAlertConnected] = useState(false);
  const wsAlertRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUnmountedRef = useRef(false);

  const connectWebSocket = useCallback(() => {
    if (isUnmountedRef.current) return;
    
    // 기존 연결 정리
    if (wsAlertRef.current) {
      wsAlertRef.current.close();
      wsAlertRef.current = null;
    }

    const ws = new WebSocket(PLC_ALERT_WS_URL);
    
    // 연결 타임아웃 설정 (10초)
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      setAlertConnected(true);
      
      // Heartbeat 시작 (30초마다 ping)
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.alert && typeof message.alert === 'string') {
          setAiAlert(message.alert);
        }
      } catch (error) {
        console.error('PLC Alert 메시지 파싱 오류:', error);
      }
    };

    ws.onerror = () => {
      clearTimeout(connectionTimeout);
      setAlertConnected(false);
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      setAlertConnected(false);
      
      // Heartbeat 정리
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      
      // 컴포넌트가 언마운트되지 않았을 때만 재연결
      if (!isUnmountedRef.current) {
        // 기존 재연결 타이머 취소
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        
        // 정상 종료(1000)가 아니면 재연결 (5초 후)
        const delay = event.code === 1000 ? 10000 : 5000;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            connectWebSocket();
          }
        }, delay);
      }
    };

    wsAlertRef.current = ws;
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    connectWebSocket();

    return () => {
      isUnmountedRef.current = true;
      
      // Heartbeat 정리
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      
      // 재연결 타이머 취소
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // WebSocket 연결 종료
      if (wsAlertRef.current) {
        wsAlertRef.current.close();
        wsAlertRef.current = null;
      }
    };
  }, [connectWebSocket]);

  return { aiAlert, alertConnected };
}
