import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data.db');

let db: any;

// SQL.js 초기화
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // 기존 DB 파일이 있으면 로드
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  // 테이블 초기화
  db.run(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_room_metric_time 
      ON metrics(room, metric_name, timestamp DESC)
  `);
  
  // 주기적으로 DB를 파일에 저장
  setInterval(() => {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }, 5000); // 5초마다 저장
  
  console.log('Database initialized');
}

// 초기화 Promise
const dbReady = initDatabase();

export interface MetricRow {
  id: number;
  room: string;
  metric_name: string;
  value: number;
  timestamp: number;
}

export async function insertMetric(room: string, metricName: string, value: number): Promise<void> {
  await dbReady;
  db.run('INSERT INTO metrics (room, metric_name, value, timestamp) VALUES (?, ?, ?, ?)', 
    [room, metricName, value, Date.now()]);
}

export async function getRecentMetrics(room: string, metricName: string, minutes: number = 30): Promise<MetricRow[]> {
  await dbReady;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const stmt = db.prepare(`
    SELECT * FROM metrics 
    WHERE room = ? AND metric_name = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `);
  stmt.bind([room, metricName, cutoff]);
  
  const rows: MetricRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push(row as MetricRow);
  }
  stmt.free();
  
  return rows;
}

export async function getLatestMetrics(room: string): Promise<Record<string, number>> {
  await dbReady;
  const metricNames = ['pm10', 'pm25', 'co2', 'voc', 'hcho', 'co', 'temp', 'hum'];
  const result: Record<string, number> = {};
  
  for (const metricName of metricNames) {
    const stmt = db.prepare(`
      SELECT value FROM metrics
      WHERE room = ? AND metric_name = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    stmt.bind([room, metricName]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject();
      result[metricName] = row.value as number;
    }
    stmt.free();
  }
  
  return result;
}

export async function getSummaryStats(room: string, metricName: string, minutes: number = 30): Promise<{
  latest: number;
  avg: number;
  max: number;
  slope: number;
}> {
  await dbReady;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const stmt = db.prepare(`
    SELECT value, timestamp FROM metrics
    WHERE room = ? AND metric_name = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `);
  stmt.bind([room, metricName, cutoff]);
  
  const rows: Array<{ value: number; timestamp: number }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push(row as { value: number; timestamp: number });
  }
  stmt.free();
  
  if (rows.length === 0) {
    return { latest: 0, avg: 0, max: 0, slope: 0 };
  }

  const latest = rows[rows.length - 1].value;
  const avg = rows.reduce((sum, r) => sum + r.value, 0) / rows.length;
  const max = Math.max(...rows.map(r => r.value));

  // 기울기 계산: 최근 10분 평균 - 이전 10분 평균
  const now = Date.now();
  const recent10min = now - 10 * 60 * 1000;
  const prev10min = now - 20 * 60 * 1000;
  
  const recent = rows.filter(r => r.timestamp >= recent10min);
  const previous = rows.filter(r => r.timestamp >= prev10min && r.timestamp < recent10min);
  
  const recentAvg = recent.length > 0 ? recent.reduce((sum, r) => sum + r.value, 0) / recent.length : 0;
  const prevAvg = previous.length > 0 ? previous.reduce((sum, r) => sum + r.value, 0) / previous.length : 0;
  const slope = recentAvg - prevAvg;

  return { latest, avg, max, slope };
}
