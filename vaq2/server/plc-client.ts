import axios from 'axios';
import WebSocket from 'ws';
import http from 'http';

const PLC_BRIDGE_URL = 'http://localhost:8000';
const PLC_WS_URL = 'ws://localhost:8000/ws';

// axios 인스턴스 생성 (keep-alive 활성화로 연결 재사용)
const axiosInstance = axios.create({
  baseURL: PLC_BRIDGE_URL,
  timeout: 5000,
  httpAgent: new http.Agent({ 
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10
  }),
  headers: {
    'Connection': 'keep-alive'
  }
});

export interface PLCAirQuality {
  timestamp_local: string;
  co2: number | null;
  tvoc: number | null;
  pm25: number | null;
  pm10: number | null;
  formaldehyde: number | null;
  co: number | null;
  temperature: number | null;
  humidity: number | null;
}

export interface PLCRoomData {
  kitchen: PLCAirQuality | null;
  washing: PLCAirQuality | null;
}

export interface PLCStatus {
  level: string;
  message: string;
}

export interface PLCPayload {
  data: PLCRoomData;
  status: PLCStatus;
}

let latestPLCData: PLCPayload | null = null;
let pollInterval: NodeJS.Timeout | null = null;

// PLC 데이터 폴링 (REST API 사용)
export function startPLCPolling(intervalMs: number = 5000) {
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  // 즉시 한 번 실행
  updatePLCData();

  // 주기적으로 폴링
  pollInterval = setInterval(async () => {
    await updatePLCData();
  }, intervalMs);

  console.log(`PLC 폴링 시작 (${intervalMs}ms 간격)`);
}

async function updatePLCData() {
  try {
    const data = await getLatestPLCData();
    if (data) {
      latestPLCData = data;
      console.log('PLC 데이터 업데이트:', {
        kitchen_co2: data.data.kitchen?.co2,
        kitchen_pm25: data.data.kitchen?.pm25,
        washing_co2: data.data.washing?.co2,
        washing_pm25: data.data.washing?.pm25,
        status: data.status.level
      });
    }
  } catch (error) {
    // 연결 실패 시 무시 (다음 폴링 시도)
  }
}

export function stopPLCPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('PLC 폴링 중지');
  }
}

// REST API로 최신 데이터 가져오기
export async function getLatestPLCData(): Promise<PLCPayload | null> {
  try {
    const response = await axiosInstance.get('/api/latest');
    if (response.data.ok) {
      return response.data.payload;
    }
    return null;
  } catch (error) {
    // 연결 오류는 로그 최소화
    return null;
  }
}

// 캐시된 최신 데이터 반환
export function getCachedPLCData(): PLCPayload | null {
  return latestPLCData;
}

// PLC 데이터를 기존 MetricData 형식으로 변환
export function convertPLCToMetricData(plcData: PLCAirQuality): any {
  return {
    pm10: plcData.pm10 ?? 0,
    pm25: plcData.pm25 ?? 0,
    co2: plcData.co2 ?? 0,
    voc: plcData.tvoc ?? 0,
    formaldehyde: plcData.formaldehyde ?? 0,
    co: plcData.co ?? 0,
    temperature: plcData.temperature ?? 0,
    humidity: plcData.humidity ?? 0,
  };
}

