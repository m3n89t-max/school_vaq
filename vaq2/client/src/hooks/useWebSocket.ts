import { useEffect, useRef, useState, useCallback } from 'react';
import { RoomData } from '../types';

// ✅ PLC 브릿지 서버 포트로 변경 (8000)
// localhost로 강제 설정하여 연결 안정화
const WS_URL = 'ws://localhost:8000/ws';

export function useWebSocket() {
  const [data, setData] = useState<RoomData | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUnmountedRef = useRef(false);
  const messageHandlersRef = useRef<Map<string, (data: any) => void>>(new Map());

  const connectWebSocket = useCallback(() => {
    if (isUnmountedRef.current) return;
    
    // 기존 연결 정리
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(WS_URL);
    
    // 연결 타임아웃 설정 (10초)
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      setConnected(true);
      
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
        
        if (message.data && message.data.kitchen && message.data.washing) {
          const plcRoomData = message.data;
          const kitchenData = plcRoomData.kitchen;
          const washingData = plcRoomData.washing;
          
          if (!kitchenData || !washingData) {
            return;
          }
          const roomData: RoomData = {
            kitchen: {
              pm25: kitchenData.pm25 ?? 0,
              pm10: kitchenData.pm10 ?? 0,
              co2: kitchenData.co2 ?? 0,
              co: kitchenData.co ?? 0,
              voc: kitchenData.tvoc ?? 0,
              formaldehyde: kitchenData.formaldehyde ?? 0,
              temperature: kitchenData.temperature ?? 0,
              humidity: kitchenData.humidity ?? 0
            },
            washing: {
              pm25: washingData.pm25 ?? 0,
              pm10: washingData.pm10 ?? 0,
              co2: washingData.co2 ?? 0,
              co: washingData.co ?? 0,
              voc: washingData.tvoc ?? 0,
              formaldehyde: washingData.formaldehyde ?? 0,
              temperature: washingData.temperature ?? 0,
              humidity: washingData.humidity ?? 0
            }
          };
          
          setData(roomData);
        }
        
        if (message.type === 'briefing') {
          setBriefing(message.briefing);
        }
        
        // 커스텀 핸들러 호출
        const handler = messageHandlersRef.current.get(message.type);
        if (handler) {
          handler(message);
        }
      } catch (error) {
        console.error('WebSocket 메시지 파싱 오류:', error);
      }
    };

    ws.onerror = () => {
      clearTimeout(connectionTimeout);
      setConnected(false);
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      setConnected(false);
      
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
        
        // 정상 종료(1000)가 아니면 재연결 (3초 후)
        const delay = event.code === 1000 ? 10000 : 3000;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            connectWebSocket();
          }
        }, delay);
      }
    };

    wsRef.current = ws;
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
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const requestHistory = useCallback((room: string, metric: string, minutes: number = 30) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'getHistory',
        room,
        metric,
        minutes
      }));
    }
  }, []);

  const onMessage = useCallback((type: string, handler: (data: any) => void) => {
    messageHandlersRef.current.set(type, handler);
    return () => {
      messageHandlersRef.current.delete(type);
    };
  }, []);

  return { data, briefing, connected, requestHistory, onMessage };
}

