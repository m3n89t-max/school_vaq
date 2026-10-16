import { Server as HTTPServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { getCachedPLCData, convertPLCToMetricData } from './plc-client.js';

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

export function setupWebSocket(server: HTTPServer) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    console.log('클라이언트 연결됨');
    clients.add(ws);

    // 연결 즉시 최신 PLC 데이터 전송
    const plcData = getCachedPLCData();
    if (plcData) {
      const kitchenData = plcData.data.kitchen ? convertPLCToMetricData(plcData.data.kitchen) : null;
      const washingData = plcData.data.washing ? convertPLCToMetricData(plcData.data.washing) : null;
      ws.send(JSON.stringify({
        type: 'sensorUpdate',
        data: {
          kitchen: kitchenData,
          washing: washingData,
          fans: {
            kitchen: {
              supply: { running: true, speed: 75 },
              exhaust: { running: true, speed: 80 }
            },
            washing: {
              supply: { running: true, speed: 70 },
              exhaust: { running: true, speed: 75 }
            }
          }
        }
      }));
    }

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        handleClientMessage(ws, data);
      } catch (error) {
        console.error('WebSocket 메시지 파싱 오류:', error);
      }
    });

    ws.on('close', () => {
      console.log('클라이언트 연결 종료');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket 오류:', error);
      clients.delete(ws);
    });
  });

  // ❌ Node.js 서버의 브로드캐스트 비활성화
  // 클라이언트가 PLC 브리지(8000)에 직접 연결하므로 중복 전송 방지
  // setInterval(() => {
  //   const plcData = getCachedPLCData();
  //   if (plcData) {
  //     const kitchenData = plcData.data.kitchen ? convertPLCToMetricData(plcData.data.kitchen) : null;
  //     const washingData = plcData.data.washing ? convertPLCToMetricData(plcData.data.washing) : null;
  //     broadcastSensorData({
  //       kitchen: kitchenData,
  //       washing: washingData,
  //       fans: {
  //         kitchen: {
  //           supply: { running: true, speed: 75 },
  //           exhaust: { running: true, speed: 80 }
  //         },
  //         washing: {
  //           supply: { running: true, speed: 70 },
  //           exhaust: { running: true, speed: 75 }
  //         }
  //       }
  //     });
  //   }
  // }, 1000);

  console.log('WebSocket 서버 설정 완료');
}

function handleClientMessage(ws: WebSocket, data: any) {
  // 클라이언트 요청 처리 (필요시 확장)
  if (data.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
  }
}

export function broadcastSensorData(data: any) {
  const message = JSON.stringify({
    type: 'sensorUpdate',
    data
  });

  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function broadcastBriefing(briefing: string) {
  const message = JSON.stringify({
    type: 'briefing',
    briefing
  });

  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
