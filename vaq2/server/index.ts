import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { setupWebSocket } from './websocket.js';
import { getLatestMetrics, getRecentMetrics, getSummaryStats } from './db.js';
import { generateBriefing, chatWithAI } from './ai.js';
import { startPLCPolling } from './plc-client.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 정적 파일 서빙 (프로덕션 빌드)
app.use(express.static('../client/dist'));

// API 라우트
app.get('/api/metrics/latest/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const metrics = await getLatestMetrics(room);
    res.json({ room, metrics });
  } catch (error) {
    res.status(500).json({ error: '메트릭 조회 실패' });
  }
});

app.get('/api/metrics/history/:room/:metric', async (req, res) => {
  try {
    const { room, metric } = req.params;
    const minutes = parseInt(req.query.minutes as string) || 30;
    const history = await getRecentMetrics(room, metric, minutes);
    res.json({ room, metric, data: history });
  } catch (error) {
    res.status(500).json({ error: '히스토리 조회 실패' });
  }
});

app.get('/api/metrics/summary/:room/:metric', async (req, res) => {
  try {
    const { room, metric } = req.params;
    const minutes = parseInt(req.query.minutes as string) || 30;
    const summary = await getSummaryStats(room, metric, minutes);
    res.json({ room, metric, summary });
  } catch (error) {
    res.status(500).json({ error: '요약 조회 실패' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: '메시지가 필요합니다' });
    }
    const answer = await chatWithAI(message, context);
    res.json({ answer, response: answer }); // 호환성을 위해 둘 다 제공
  } catch (error) {
    res.status(500).json({ error: 'AI 채팅 실패' });
  }
});

app.get('/api/ai/briefing', async (req, res) => {
  try {
    const briefing = await generateBriefing();
    res.json({ briefing });
  } catch (error) {
    res.status(500).json({ error: '브리핑 생성 실패' });
  }
});

app.get('/api/ai/brief', async (req, res) => {
  try {
    const brief = await generateBriefing();
    res.json(brief);
  } catch (error) {
    res.status(500).json({ error: '브리핑 생성 실패' });
  }
});

// vaq 호환 엔드포인트
app.post('/api/analyze-air-quality', async (req, res) => {
  try {
    const { userMessage, kitchenData, washingData } = req.body;
    if (!userMessage) {
      return res.status(400).json({ success: false, message: '메시지가 필요합니다' });
    }
    
    // 컨텍스트 구성
    const context = {
      kitchen: kitchenData,
      washing: washingData
    };
    
    const answer = await chatWithAI(userMessage, context);
    res.json({ success: true, message: answer });
  } catch (error) {
    console.error('AI 분석 오류:', error);
    res.status(500).json({ success: false, message: 'AI 응답 중 오류가 발생했습니다.' });
  }
});

const server = createServer(app);
setupWebSocket(server);

// PLC 폴링 시작 (1초 간격 - 대시보드 실시간 업데이트)
startPLCPolling(1000);

server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`PLC Bridge 연결 시도 중: http://localhost:8000`);
});

