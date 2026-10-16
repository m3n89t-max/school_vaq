import asyncio
import sqlite3
import time
import random
from collections import deque
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path
import warnings

import httpx
import uvicorn
import yaml
import pandas as pd
import numpy as np
from prophet import Prophet
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymodbus.client import AsyncModbusTcpClient
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# Prophet 경고 메시지 숨기기
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', module='prophet')


# =========================
# Models
# =========================
class AirQuality(BaseModel):
    timestamp_local: str  # 로컬시간 ISO 문자열
    co2: int | None = None
    tvoc: int | None = None
    pm25: int | None = None
    pm10: int | None = None
    formaldehyde: int | None = None
    co: int | None = None
    temperature: float | None = None
    humidity: float | None = None

class RoomData(BaseModel):
    """방별 공기질 데이터"""
    kitchen: AirQuality | None = None
    washing: AirQuality | None = None


class Status(BaseModel):
    level: str
    message: str


class Payload(BaseModel):
    data: RoomData  # 조리실 + 세척실 데이터
    status: Status
    alert: str | None = None


# =========================
# FastAPI (REST + WebSocket)
# =========================
app = FastAPI()

# CORS 설정 추가
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 모든 origin 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket 연결을 위한 추가 헤더
@app.middleware("http")
async def add_cors_header(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

_latest: Optional[Payload] = None
_clients: set[WebSocket] = set()

# AI 알림 전용
_alert_clients: set[WebSocket] = set()
_last_alert_text: str = "시스템 준비 완료\n실시간 공기질 모니터링 시작"
_last_prophet_time: float = 0.0  # Prophet 예보 마지막 전송 시간
_prophet_display_duration: int = 10  # Prophet 예보 표시 시간 (초) - 10초 노출

# 최근 샘플(트렌드 분석용) - 메모리 최적화
_recent: deque[dict] = deque(maxlen=36)  # 60→36 (약 3분, 5초*36=180초) - 메모리 절약 강화
_recent_washing: deque[dict] = deque(maxlen=36)  # 세척실 데이터 저장
_sample_count = 0
_realtime_alert_room = "kitchen"  # 실시간 알림용 방 전환 ("kitchen" 또는 "washing")
_prophet_alert_room = "kitchen"   # Prophet 예보용 방 전환 ("kitchen" 또는 "washing")


@app.get("/api/latest")
async def latest():
    if _latest is None:
        return JSONResponse({"ok": False, "error": "no data yet"}, status_code=503)
    return {"ok": True, "payload": _latest.model_dump()}


@app.get("/api/history")
async def get_history(metric: str = "co2", hours: int = 24, room: str = "kitchen"):
    """
    과거 데이터 조회 API
    - metric: co2, pm25, pm10, voc, temperature, humidity, formaldehyde, co 등
    - hours: 조회할 시간 범위 (기본 24시간)
    - room: kitchen 또는 washing (기본 kitchen)
    """
    try:
        import sqlite3
        from datetime import datetime, timedelta
        
        # 프론트엔드 metric 이름을 DB 컬럼 이름으로 매핑
        metric_mapping = {
            "voc": "tvoc",  # 프론트엔드는 voc, DB는 tvoc
            "formaldehyde": "formaldehyde",
            "co": "co",
            "co2": "co2",
            "pm25": "pm25",
            "pm10": "pm10",
            "temperature": "temperature",
            "humidity": "humidity",
        }
        
        # 유효하지 않은 metric 체크
        if metric not in metric_mapping:
            return JSONResponse(
                {"ok": False, "error": f"지원하지 않는 metric: {metric}"},
                status_code=400
            )
        
        # 매핑된 컬럼 이름 가져오기
        db_column = metric_mapping[metric]
        
        # config에서 DB 경로 가져오기
        cfg = load_config()
        db_path = cfg.get("storage", {}).get("sqlite_path", "airq.db")
        
        # DB 연결 (타임아웃 설정 및 읽기 전용 모드)
        conn = sqlite3.connect(db_path, timeout=30.0)  # 타임아웃 증가
        conn.execute("PRAGMA query_only = ON")  # 읽기 전용 모드
        conn.execute("PRAGMA cache_size = -64000")  # 캐시 크기 증가 (64MB)
        conn.execute("PRAGMA temp_store = MEMORY")  # 메모리 사용
        cur = conn.cursor()
        
        # 시작 시간 계산
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=hours)
        
        # 데이터 조회 최적화 (간단한 LIMIT 사용)
        max_records = 2000  # 최대 레코드 수 (메모리 최적화)
        
        # room 유효성 체크
        valid_rooms = ("kitchen", "washing")
        if room not in valid_rooms:
            room = "kitchen"
        
        query = f"""
            SELECT ts_local, {db_column}
            FROM airq_log
            WHERE room = ? AND ts_local >= ? AND {db_column} IS NOT NULL
            ORDER BY ts_local ASC
            LIMIT ?
        """
        
        cur.execute(query, (room, start_time.isoformat(), max_records))
        rows = cur.fetchall()
        conn.close()
        
        # 결과 포맷팅
        data = [{"timestamp": row[0], "value": row[1]} for row in rows]
        
        print(f"[API] /api/history - room:{room}, metric:{metric}, hours:{hours}, count:{len(data)}")
        
        return {
            "ok": True,
            "metric": metric,
            "hours": hours,
            "count": len(data),
            "data": data
        }
    
    except sqlite3.OperationalError as e:
        error_msg = str(e)
        if "locked" in error_msg:
            print(f"[API] DB 락 발생: {e}")
            return JSONResponse(
                {"ok": False, "error": "데이터베이스가 일시적으로 사용 중입니다. 잠시 후 다시 시도해주세요."},
                status_code=503
            )
        else:
            print(f"[API] DB 오류: {e}")
            return JSONResponse(
                {"ok": False, "error": f"데이터베이스 오류: {error_msg}"},
                status_code=500
            )
    
    except Exception as e:
        print(f"[API] 예상치 못한 오류: {e}")
        return JSONResponse(
            {"ok": False, "error": f"서버 오류: {str(e)}"},
            status_code=500
        )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """메인 데이터 WebSocket 엔드포인트 (개선된 에러 핸들링)"""
    client_id = id(ws)
    try:
        await ws.accept()
        _clients.add(ws)
        print(f"[WebSocket] 클라이언트 #{client_id} 연결됨. 총 {len(_clients)}개")
        
        # 연결 시 즉시 최신 데이터 전송
        if _latest is not None:
            await asyncio.wait_for(ws.send_json(_latest.model_dump()), timeout=2.0)
            print(f"[WebSocket] #{client_id} 초기 데이터 전송 완료")
        else:
            await asyncio.wait_for(ws.send_json({"status": "connected", "data": None}), timeout=2.0)
            print(f"[WebSocket] #{client_id} 연결 상태 전송")
        
        while True:
            # 클라이언트로부터 메시지 수신 (keep-alive 또는 ping)
            try:
                message = await asyncio.wait_for(ws.receive_text(), timeout=60.0)
                # Ping 응답
                if message and 'ping' in message.lower():
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                print(f"[WebSocket] #{client_id} 타임아웃 - 연결 종료")
                break
            except Exception as e:
                print(f"[WebSocket] #{client_id} 에러: {type(e).__name__}")
                break
    except Exception as e:
        print(f"[WebSocket] #{client_id} 예외: {type(e).__name__}: {e}")
    finally:
        _clients.discard(ws)
        try:
            await ws.close()
        except:
            pass
        print(f"[WebSocket] #{client_id} 연결 해제. 남은: {len(_clients)}개")


@app.websocket("/ws_alert")
async def ws_alert(ws: WebSocket):
    """AI 알림 WebSocket 엔드포인트 (개선된 에러 핸들링)"""
    client_id = id(ws)
    try:
        await ws.accept()
        _alert_clients.add(ws)
        print(f"[WS Alert] 클라이언트 #{client_id} 연결. 총 {len(_alert_clients)}개")
        
        # 접속 즉시 최신 알림 전송
        await asyncio.wait_for(ws.send_json({"alert": _last_alert_text}), timeout=2.0)
        print(f"[WS Alert] #{client_id} 초기 알림 전송")
        
        while True:
            try:
                message = await asyncio.wait_for(ws.receive_text(), timeout=60.0)
                # Ping 응답
                if message and 'ping' in message.lower():
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                print(f"[WS Alert] #{client_id} 타임아웃")
                break
            except Exception as e:
                print(f"[WS Alert] #{client_id} 에러: {type(e).__name__}")
                break
    except Exception as e:
        print(f"[WS Alert] #{client_id} 예외: {type(e).__name__}")
    finally:
        _alert_clients.discard(ws)
        try:
            await ws.close()
        except:
            pass
        print(f"[WS Alert] #{client_id} 해제. 남은: {len(_alert_clients)}개")


async def publish(payload: Payload):
    """WebSocket으로 데이터 전송 (연결이 끊긴 클라이언트 자동 제거, 최적화)"""
    global _latest
    _latest = payload
    
    if not _clients:
        return  # 클라이언트 없으면 즉시 리턴 (성능 향상)
    
    dead = []
    payload_dict = payload.model_dump()  # 한 번만 변환 (성능 향상)
    
    for c in list(_clients):
        try:
            await asyncio.wait_for(c.send_json(payload_dict), timeout=1.0)
        except (Exception, asyncio.TimeoutError):
            dead.append(c)
    
    for c in dead:
        _clients.discard(c)


async def publish_alert(text: str):
    """AI 알림 전송 (타임아웃 및 에러 핸들링, 최적화)"""
    global _last_alert_text
    _last_alert_text = text

    if not _alert_clients:
        return  # 클라이언트 없으면 즉시 리턴
    
    message = {"alert": text}  # 한 번만 생성 (성능 향상)
    dead = []
    
    for c in list(_alert_clients):
        try:
            await asyncio.wait_for(c.send_json(message), timeout=1.0)
        except:
            dead.append(c)
    
    for c in dead:
        _alert_clients.discard(c)


# =========================
# Helpers
# =========================
def load_config(path="config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def now_local_iso():
    # 윈도우 로컬시간 기준 ISO
    return datetime.now().isoformat(timespec="seconds")


def db_init(db_path: str):
    conn = sqlite3.connect(db_path, timeout=10.0)
    cur = conn.cursor()
    
    # WAL 모드 활성화 (읽기/쓰기 동시 접근 개선)
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")  # 성능 향상
    cur.execute("PRAGMA cache_size=10000")    # 캐시 크기 증가
    
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS airq_log (
          room TEXT NOT NULL,             -- "kitchen" 또는 "washing"
          ts_local TEXT NOT NULL,
          wday INTEGER NOT NULL,          -- 0=월
          minute_of_day INTEGER NOT NULL, -- 0~1439
          bucket INTEGER NOT NULL,        -- 15분 단위 0~95
          co2 INTEGER,
          tvoc INTEGER,
          pm25 INTEGER,
          pm10 INTEGER,
          formaldehyde INTEGER,
          co INTEGER,
          temperature REAL,
          humidity REAL
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airq_time ON airq_log (room, wday, bucket, ts_local)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ts_local ON airq_log (room, ts_local)")  # 시간 기반 인덱스 추가
    conn.commit()
    conn.close()
    print(f"[DB] 초기화 완료 - WAL 모드 활성화 (조리실/세척실 분리)")


def db_insert(db_path: str, aq: dict, bucket_min: int, room: str = "kitchen"):
    """DB 삽입 (에러 핸들링 개선, 방 구분 추가)"""
    t = time.localtime()
    wday = t.tm_wday
    minute_of_day = t.tm_hour * 60 + t.tm_min
    bucket = minute_of_day // bucket_min

    max_retries = 3
    for attempt in range(max_retries):
        try:
            conn = sqlite3.connect(db_path, timeout=10.0)
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO airq_log(room, ts_local, wday, minute_of_day, bucket, co2, tvoc, pm25, pm10, formaldehyde, co, temperature, humidity)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    room,
                    aq["timestamp_local"],
                    wday,
                    minute_of_day,
                    bucket,
                    aq.get("co2"),
                    aq.get("tvoc"),
                    aq.get("pm25"),
                    aq.get("pm10"),
                    aq.get("formaldehyde"),
                    aq.get("co"),
                    aq.get("temperature"),
                    aq.get("humidity"),
                ),
            )
            conn.commit()
            conn.close()
            return  # 성공 시 반환
        except sqlite3.OperationalError as e:
            if "locked" in str(e):
                if attempt < max_retries - 1:
                    print(f"[DB] 락 발생 - 재시도 {attempt + 1}/{max_retries}")
                    time.sleep(0.1 * (attempt + 1))  # 점진적 대기
                    continue
                else:
                    print(f"[DB] 쓰기 실패 (DB 락) - 최대 재시도 초과")
            else:
                print(f"[DB] 쓰기 오류: {type(e).__name__}: {e}")
            break
        except Exception as e:
            print(f"[DB] 예상치 못한 오류: {type(e).__name__}: {e}")
            break
        finally:
            try:
                if 'conn' in locals():
                    conn.close()
            except:
                pass


def db_baseline_for_now(db_path: str, days: int, bucket_min: int, room: str = "kitchen"):
    """
    최근 N일 데이터에서 '현재 요일+현재 버킷' 평균을 뽑아 baseline 제공 (최적화)
    - room: 방 이름 ("kitchen" 또는 "washing")
    """
    t = time.localtime()
    wday = t.tm_wday
    minute_of_day = t.tm_hour * 60 + t.tm_min
    bucket = minute_of_day // bucket_min

    # 최근 N일 컷오프(로컬 기준 단순 문자열 비교: ISO 형태라 정렬됨)
    cutoff = (datetime.now() - timedelta_days(days)).isoformat(timespec="seconds")

    conn = sqlite3.connect(db_path, timeout=10.0)
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA cache_size = -16000")  # 16MB 캐시
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
          COUNT(*) as n,
          AVG(co2) as co2_avg,
          AVG(pm25) as pm25_avg,
          AVG(pm10) as pm10_avg,
          AVG(tvoc) as tvoc_avg
        FROM airq_log
        WHERE room = ? AND wday = ? AND bucket = ? AND ts_local >= ?
        """,
        (room, wday, bucket, cutoff),
    )
    row = cur.fetchone()
    conn.close()

    n, co2_avg, pm25_avg, pm10_avg, tvoc_avg = row if row else (0, None, None, None, None)

    return {
        "wday": wday,
        "bucket": bucket,
        "samples": int(n or 0),
        "co2_avg": int(co2_avg) if co2_avg is not None else None,
        "pm25_avg": int(pm25_avg) if pm25_avg is not None else None,
        "pm10_avg": int(pm10_avg) if pm10_avg is not None else None,
        "tvoc_avg": int(tvoc_avg) if tvoc_avg is not None else None,
    }


def db_baseline_future(db_path: str, minutes_ahead: int, days: int, bucket_min: int, room: str = "kitchen"):
    """
    N분 후 시간대의 과거 평균 데이터 조회 (선행 예측용, 최적화)
    - room: 방 이름 ("kitchen" 또는 "washing")
    """
    t = time.localtime()
    future_minute = t.tm_hour * 60 + t.tm_min + minutes_ahead
    future_wday = t.tm_wday
    
    # 날짜 넘어가는 경우 처리
    if future_minute >= 1440:  # 24시간 = 1440분
        future_minute -= 1440
        future_wday = (future_wday + 1) % 7
    
    future_bucket = future_minute // bucket_min
    cutoff = (datetime.now() - timedelta_days(days)).isoformat(timespec="seconds")

    conn = sqlite3.connect(db_path, timeout=10.0)
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA cache_size = -16000")  # 16MB 캐시
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
          COUNT(*) as n,
          AVG(co2) as co2_avg,
          AVG(pm25) as pm25_avg,
          AVG(pm10) as pm10_avg,
          AVG(tvoc) as tvoc_avg
        FROM airq_log
        WHERE room = ? AND wday = ? AND bucket = ? AND ts_local >= ?
        """,
        (room, future_wday, future_bucket, cutoff),
    )
    row = cur.fetchone()
    conn.close()

    n, co2_avg, pm25_avg, pm10_avg, tvoc_avg = row if row else (0, None, None, None, None)

    return {
        "wday": future_wday,
        "bucket": future_bucket,
        "minutes_ahead": minutes_ahead,
        "samples": int(n or 0),
        "co2_avg": int(co2_avg) if co2_avg is not None else None,
        "pm25_avg": int(pm25_avg) if pm25_avg is not None else None,
        "pm10_avg": int(pm10_avg) if pm10_avg is not None else None,
        "tvoc_avg": int(tvoc_avg) if tvoc_avg is not None else None,
    }


def timedelta_days(days: int):
    # datetime - timedelta 대체(임포트 최소화)
    return timedelta(days=days)


# =========================
# Prophet 시계열 분석 함수들
# =========================
def get_timeseries_data(db_path: str, metric: str, hours: int = 168, room: str = "kitchen"):
    """
    DB에서 시계열 데이터를 Prophet 형식으로 조회 (최적화 버전)
    - hours: 분석할 시간 범위 (기본 7일 = 168시간)
    - room: 방 이름 ("kitchen" 또는 "washing")
    - 반환: Prophet용 DataFrame (ds, y 컬럼)
    """
    metric_mapping = {
        "voc": "tvoc",
        "formaldehyde": "formaldehyde",
        "co": "co",
        "co2": "co2",
        "pm25": "pm25",
        "pm10": "pm10",
    }
    
    db_column = metric_mapping.get(metric, metric)
    
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA cache_size = -32000")  # 32MB 캐시
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        
        # 데이터 샘플링으로 성능 개선 (15분 간격)
        query = f"""
            SELECT ts_local, AVG({db_column}) as value
            FROM airq_log
            WHERE room = ? AND ts_local >= ? AND {db_column} IS NOT NULL
            GROUP BY strftime('%Y-%m-%d %H', ts_local), CAST(strftime('%M', ts_local) AS INTEGER) / 15
            ORDER BY ts_local ASC
            LIMIT 1000
        """
        
        df = pd.read_sql_query(query, conn, params=(room, cutoff))
        conn.close()
        
        if df.empty or len(df) < 10:
            return None
        
        # Prophet 형식으로 변환
        df.columns = ['ds', 'y']
        df['ds'] = pd.to_datetime(df['ds'])
        
        return df
    except Exception as e:
        print(f"[Prophet] 데이터 조회 실패: {e}")
        return None


def prophet_forecast(df: pd.DataFrame, periods: int = 12):
    """
    Prophet을 이용한 시계열 예측 (최적화 버전)
    - df: Prophet 형식 DataFrame (ds, y)
    - periods: 예측할 미래 시점 개수 (기본 12 = 1시간, 5분 간격)
    - 반환: 예측 결과 DataFrame
    """
    if df is None or len(df) < 10:
        return None
    
    try:
        # Prophet 모델 생성 및 학습 (로깅 억제, 성능 최적화)
        model = Prophet(
            daily_seasonality=True,
            weekly_seasonality=False,  # 주간 패턴 비활성화 (성능 개선)
            yearly_seasonality=False,
            changepoint_prior_scale=0.05,
            seasonality_mode='additive',
            interval_width=0.8,  # 신뢰 구간 축소 (성능 개선)
            mcmc_samples=0  # MCMC 비활성화 (속도 개선)
        )
        
        # 로그 레벨 낮추기
        import logging
        logging.getLogger('prophet').setLevel(logging.ERROR)
        logging.getLogger('cmdstanpy').setLevel(logging.ERROR)
        
        # 경고 무시
        import warnings
        warnings.filterwarnings('ignore', category=FutureWarning)
        
        model.fit(df)
        
        # 미래 예측 (15분 간격으로 변경 - 성능 개선)
        future = model.make_future_dataframe(periods=4, freq='15min')
        forecast = model.predict(future)
        
        return forecast
    
    except Exception as e:
        print(f"[Prophet] 예측 실패: {e}")
        return None


def analyze_forecast_risk(current_value: float, forecast_df: pd.DataFrame, 
                         metric: str, thresholds: dict, periods_ahead: int = 6):
    """
    Prophet 예측 결과를 분석하여 위험도 판단
    - current_value: 현재 측정값
    - forecast_df: Prophet 예측 결과
    - metric: 측정 항목 (co2, pm25 등)
    - thresholds: 기준값 딕셔너리
    - periods_ahead: 몇 시점 앞을 볼지 (기본 6 = 30분 후)
    - 반환: (위험도, 예측값, 메시지)
    """
    if forecast_df is None or forecast_df.empty:
        return "unknown", None, ""
    
    try:
        # 미래 예측값 가져오기 (마지막 N개 중에서 periods_ahead 시점)
        future_rows = forecast_df.tail(periods_ahead + 1)
        if len(future_rows) < periods_ahead:
            return "unknown", None, ""
        
        predicted_value = future_rows.iloc[-1]['yhat']
        predicted_upper = future_rows.iloc[-1]['yhat_upper']
        
        # 상승/하락 추세 분석
        first_value = future_rows.iloc[0]['yhat']
        trend = predicted_value - first_value
        
        # 기준값에 따른 위험도 판단
        th = thresholds.get(metric, {})
        predicted_level = get_air_quality_level(predicted_value, metric, thresholds)
        
        # 위험 메시지 생성
        risk_level = "safe"
        message = ""
        
        # 매우나쁨으로 악화 예상
        if predicted_level == "매우나쁨":
            risk_level = "critical"
            message = f"{metric.upper()} 매우나쁨 예상 ({int(predicted_value)})"
        
        # 나쁨으로 악화 예상
        elif predicted_level == "나쁨":
            risk_level = "high"
            message = f"{metric.upper()} 나쁨 예상 ({int(predicted_value)})"
        
        # 보통으로 악화 예상
        elif predicted_level == "보통" and trend > 0:
            current_level = get_air_quality_level(current_value, metric, thresholds)
            if current_level in ["매우좋음", "좋음"]:
                risk_level = "medium"
                message = f"{metric.upper()} 상승 예상 ({int(predicted_value)})"
        
        # 급격한 상승 추세
        elif trend > 0:
            if metric == "co2" and trend > 200:
                risk_level = "medium"
                message = f"CO2 급상승 예상 (+{int(trend)}ppm)"
            elif metric == "pm25" and trend > 20:
                risk_level = "medium"
                message = f"PM2.5 급상승 예상 (+{int(trend)}㎍)"
        
        return risk_level, predicted_value, message
    
    except Exception as e:
        print(f"[Prophet] 분석 실패: {e}")
        return "unknown", None, ""


def prophet_analysis(db_path: str, aq: dict, cfg: dict, room: str = "kitchen"):
    """
    Prophet을 이용한 전체 시계열 분석
    - 과거 데이터 기반 예측
    - 선제 알람 판단
    - room: 방 이름 ("kitchen" 또는 "washing")
    - 반환: 분석 결과 딕셔너리
    """
    thresholds = cfg.get("thresholds", {})
    
    # 모든 공기질 항목에 대해 예측 수행
    analysis_result = {
        "co2": {"risk": "unknown", "predicted": None, "message": ""},
        "pm25": {"risk": "unknown", "predicted": None, "message": ""},
        "pm10": {"risk": "unknown", "predicted": None, "message": ""},
        "voc": {"risk": "unknown", "predicted": None, "message": ""},
        "formaldehyde": {"risk": "unknown", "predicted": None, "message": ""},
        "co": {"risk": "unknown", "predicted": None, "message": ""},
        "overall_risk": "safe",
        "alert_messages": []
    }
    
    # 모든 항목 분석
    for metric in ["co2", "pm25", "pm10", "voc", "formaldehyde", "co"]:
        current_value = aq.get(metric if metric != "voc" else "tvoc", 0)
        
        if current_value == 0:
            continue
        
        # 시계열 데이터 조회 (7일, 해당 방 데이터만)
        df = get_timeseries_data(db_path, metric, hours=168, room=room)
        
        if df is not None and len(df) >= 50:  # 최소 50개 데이터 필요
            # Prophet 예측
            forecast_df = prophet_forecast(df, periods=12)  # 1시간 예측
            
            if forecast_df is not None:
                # 30분 후 예측 분석
                risk, predicted, message = analyze_forecast_risk(
                    current_value, forecast_df, metric, thresholds, periods_ahead=6
                )
                
                analysis_result[metric] = {
                    "risk": risk,
                    "predicted": predicted,
                    "message": message,
                    "current": current_value
                }
                
                if message:
                    analysis_result["alert_messages"].append(message)
    
    # 전체 위험도 판단 (모든 항목 고려)
    risks = [
        analysis_result["co2"]["risk"], 
        analysis_result["pm25"]["risk"],
        analysis_result["pm10"]["risk"],
        analysis_result["voc"]["risk"],
        analysis_result["formaldehyde"]["risk"],
        analysis_result["co"]["risk"]
    ]
    if "critical" in risks:
        analysis_result["overall_risk"] = "critical"
    elif "high" in risks:
        analysis_result["overall_risk"] = "high"
    elif "medium" in risks:
        analysis_result["overall_risk"] = "medium"
    
    return analysis_result


def compute_trend(recent: deque, key: str, window: int = 20):
    """
    최근 window개로 단순 상승/하락 추정 (30→20으로 최적화)
    """
    try:
        vals = [x.get(key) for x in list(recent)[-window:] if isinstance(x.get(key), (int, float))]
        if len(vals) < 5:
            return 0.0
        return float(vals[-1] - vals[0])
    except Exception:
        return 0.0


def get_air_quality_level(value: float, metric: str, thresholds: dict) -> str:
    """
    기준표에 따라 공기질 등급 판정
    """
    th = thresholds.get(metric, {})
    if not th:
        return "측정불가"
    
    if value <= th.get("very_good", [0, 0])[1]:
        return "매우좋음"
    elif value <= th.get("good", [0, 0])[1]:
        return "좋음"
    elif value <= th.get("normal", [0, 0])[1]:
        return "보통"
    elif value <= th.get("bad", [0, 0])[1]:
        return "나쁨"
    else:
        return "매우나쁨"


def rule_status_and_action(aq: dict, cfg: dict, baseline: dict, future: dict = None, room_name: str = "조리실"):
    """
    현재 공기질 등급 판정 + 선행 예측
    - 가장 나쁜 항목을 기준으로 전체 등급 결정 (안전 우선)
    - 나쁜 항목들을 구체적으로 표시
    """
    th = cfg.get("thresholds", {})
    actions = cfg.get("actions", {"step_warn": 10, "step_bad": 15})
    
    # 각 측정값과 등급 판정
    metrics = {
        "PM2.5": (aq.get("pm25") or 0, "pm25"),
        "PM10": (aq.get("pm10") or 0, "pm10"),
        "CO2": (aq.get("co2") or 0, "co2"),
        "VOC": (aq.get("tvoc") or 0, "voc"),
        "포름알데히드": ((aq.get("formaldehyde") or 0) / 10, "formaldehyde"),
        "CO": (aq.get("co") or 0, "co")
    }
    
    # 각 항목별 등급 판정
    levels = {}
    worst_level = "매우좋음"
    worst_metrics = []
    
    level_priority = {"매우나쁨": 5, "나쁨": 4, "보통": 3, "좋음": 2, "매우좋음": 1}
    
    for name, (value, key) in metrics.items():
        if value > 0:  # 0이 아닌 값만 판정
            level = get_air_quality_level(value, key, th)
            levels[name] = (level, value)
            
            if level_priority.get(level, 0) > level_priority.get(worst_level, 0):
                worst_level = level
                worst_metrics = [(name, value)]
            elif level_priority.get(level, 0) == level_priority.get(worst_level, 0):
                worst_metrics.append((name, value))
    
    step_warn = int(actions.get("step_warn", 10))
    step_bad = int(actions.get("step_bad", 15))
    
    # 🔮 선행 예측: 미래 데이터 분석
    future_warning = ""
    if future and future.get("samples", 0) >= 20:
        fut_co2 = future.get("co2_avg")
        fut_pm25 = future.get("pm25_avg")
        cur_co2 = aq.get("co2") or 0
        cur_pm25 = aq.get("pm25") or 0
        
        if fut_co2 and fut_co2 > cur_co2 + 300 and fut_co2 > 1200:
            future_warning = "[예측] 곧 CO2 상승 예상"
        elif fut_pm25 and fut_pm25 > cur_pm25 + 20 and fut_pm25 > 50:
            future_warning = "[예측] 곧 PM2.5 상승 예상"
    
    # 상태 메시지 생성 (최악 등급 기준)
    if worst_level == "매우나쁨":
        bad_items = []
        for m, v in worst_metrics:
            if m == "포름알데히드":
                bad_items.append(f"{m} {v:.1f}")
            else:
                bad_items.append(f"{m} {int(v)}")
        bad_list = ", ".join(bad_items)
        status_line = f"{room_name}: 매우나쁨 ({bad_list})"
        action_line = "급기 배기 강화하세요"
        return "매우나쁨", status_line, action_line, future_warning
    
    elif worst_level == "나쁨":
        bad_items = []
        for m, v in worst_metrics:
            if m == "포름알데히드":
                bad_items.append(f"{m} {v:.1f}")
            else:
                bad_items.append(f"{m} {int(v)}")
        bad_list = ", ".join(bad_items)
        status_line = f"{room_name}: 나쁨 ({bad_list})"
        action_line = "급기 배기 올리세요"
        return "나쁨", status_line, action_line, future_warning
    
    elif worst_level == "보통":
        samples = baseline.get("samples", 0)
        # 보통 수준 항목들 표시
        bad_items = []
        for m, v in worst_metrics:
            if m == "포름알데히드":
                bad_items.append(f"{m} {v:.1f}")
            else:
                bad_items.append(f"{m} {int(v)}")
        if bad_items:
            status_line = f"{room_name}: 보통 ({', '.join(bad_items)})"
        else:
            status_line = f"{room_name}: 보통"
        
        if samples >= 30:
            if future_warning:
                action_line = "환기 시작하세요 (악화 예상)"
            else:
                action_line = "환기 시작하세요"
        else:
            action_line = "현재 상태 유지하세요"
        return "보통", status_line, action_line, future_warning
    
    elif worst_level == "좋음":
        status_line = f"{room_name}: 좋음"
        if future_warning:
            action_line = "현재 유지, 환기 준비하세요"
        else:
            action_line = "현재 상태 유지하세요"
        return "좋음", status_line, action_line, future_warning
    
    else:  # 매우좋음
        status_line = f"{room_name}: 매우좋음"
        if future_warning:
            action_line = "쾌적합니다, 환기 준비하세요"
        else:
            action_line = "쾌적합니다, 현재 유지하세요"
        return "매우좋음", status_line, action_line, future_warning


async def ollama_generate_alert(cfg: dict, aq: dict, prophet_analysis_result: dict, rule_lines: tuple[str, str, str], level: str):
    """
    ✅ Prophet 분석 결과를 LLM으로 자연스러운 문장으로 변환
    - Prophet이 모든 분석 수행 (시계열 예측, 위험도 판단)
    - LLM은 분석 결과를 조리사가 이해하기 쉬운 자연스러운 문장으로만 변환
    - LLM은 절대 분석하지 않음!
    """
    oll = cfg.get("ollama", {})
    url = oll.get("url", "http://127.0.0.1:11434/api/generate")
    model = oll.get("model", "qwen2.5:1.5b")
    timeout = float(oll.get("timeout_sec", 25))

    rule_line1, rule_line2, future_warning = rule_lines
    
    # ✅ Prophet 분석 결과 가져오기
    co2_analysis = prophet_analysis_result.get("co2", {})
    pm25_analysis = prophet_analysis_result.get("pm25", {})
    overall_risk = prophet_analysis_result.get("overall_risk", "safe")
    alert_messages = prophet_analysis_result.get("alert_messages", [])
    
    # 현재값
    co2_now = aq.get("co2") or 0
    pm25_now = aq.get("pm25") or 0
    
    # Prophet 예측값
    co2_predicted = co2_analysis.get("predicted")
    pm25_predicted = pm25_analysis.get("predicted")
    
    # Prophet 위험도
    co2_risk = co2_analysis.get("risk", "unknown")
    pm25_risk = pm25_analysis.get("risk", "unknown")
    
    # ✅ Prophet 분석 결과를 구조화된 데이터로 정리
    analysis_summary = {
        "현재상태": rule_line1,
        "권장조치": rule_line2,
        "현재측정값": {
            "CO2": f"{co2_now}ppm",
            "PM2.5": f"{pm25_now}㎍/m³"
        },
        "예측값": {
            "CO2": f"{int(co2_predicted)}ppm" if co2_predicted else "데이터부족",
            "PM2.5": f"{int(pm25_predicted)}㎍/m³" if pm25_predicted else "데이터부족"
        },
        "위험도": {
            "전체": overall_risk,
            "CO2": co2_risk,
            "PM2.5": pm25_risk
        },
        "선제알람": alert_messages if alert_messages else ["없음"]
    }
    
    # ✅ LLM에게 전달: Prophet 예보를 급배기 조치 중심으로 전달 (근거 포함)
    
    # 앞으로의 시간대 확인 (예보 시점 기준)
    future_time = datetime.now() + timedelta(minutes=10)
    future_hour = future_time.hour
    time_context = ""
    if 7 <= future_hour < 10:
        time_context = "과거 패턴 기준"
    elif 10 <= future_hour < 11:
        time_context = "동시간대 분석"
    elif 11 <= future_hour < 15:
        time_context = "과거 동시간대 패턴"
    elif 15 <= future_hour < 17:
        time_context = "동시간대 분석"
    elif 17 <= future_hour < 20:
        time_context = "과거 패턴 기준"
    elif 20 <= future_hour < 22:
        time_context = "동시간대 분석"
    else:
        time_context = "과거 패턴 기준"
    
    # 방 이름 추출
    room_display = rule_lines[0].split(':')[0] if ':' in rule_lines[0] else "조리실"
    
    prompt = f"""당신은 {room_display} 환기 시스템 관리 전문가입니다.

7일간의 과거 데이터를 Prophet 시계열 모델로 분석한 결과를 바탕으로,
급배기 시스템 조치를 예보하세요.

[Prophet 분석 결과]
{analysis_summary}

[현재 상태]
{rule_line1}

[현재 시간대]
{time_context}

**중요 규칙**:
1. emoji, 특수문자를 절대 사용하지 마세요 (한글, 숫자, 기본 기호만 사용)
2. Prophet 분석 결과의 "예측값"과 "위험도"를 기준으로 예보하세요
3. CO2 예측값이 현재보다 높으면 "CO2 상승 예상"
4. PM2.5 예측값이 현재보다 높으면 "PM2.5 상승 예상"
5. 예측값이 현재보다 낮으면 "개선 예상" 또는 "정상 유지 예상"
6. 시간 표현: "곧", "잠시 후" 등 자연스러운 표현 사용 (구체적 시간 금지)

출력 형식 (정확히 2줄, emoji 금지):
1줄: [AI예보] + 예측되는 변화 (상승/하강/유지) + (시간대 근거)
2줄: 급배기 시스템 조치 권장사항

예시:
[AI예보] 곧 CO2 상승 예상 (과거 패턴 기준)
급기 증가 및 배기 강화를 권장합니다

[AI예보] 잠시 후 PM2.5 개선 예상 (동시간대 분석)
현재 급배기 설정을 유지하세요

지금 예보를 작성하세요:"""

    max_retries = 2
    for attempt in range(max_retries):
        try:
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,  # 창의성 최소화 - 전달만
                    "top_k": 10,
                    "top_p": 0.8
                },
            }

            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                data = r.json()
                text = (data.get("response") or "").strip()

            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            if not lines:
                if attempt < max_retries - 1:
                    print(f"[LLM] 빈 응답 - 재시도 {attempt + 1}/{max_retries}")
                    continue
                return None
            
            # 마크다운 태그 및 emoji 제거
            cleaned_lines = []
            for line in lines:
                line = line.replace("**", "").replace("__", "").replace("*", "").replace("_", "")
                # emoji 및 특수 유니코드 제거 (Windows cp949 인코딩 오류 방지)
                line = ''.join(char for char in line if ord(char) < 0x10000)
                line = line.strip()
                if line and not line.startswith("#"):
                    cleaned_lines.append(line)
            
            # ✅ Prophet 예보 메시지 (2줄 형식)
            if len(cleaned_lines) >= 2:
                return "\n".join(cleaned_lines[:2])  # 정확히 2줄
            elif len(cleaned_lines) == 1:
                # 1줄만 있으면 기본 조치 추가
                return f"{cleaned_lines[0]}\n현재 급배기 설정을 유지하세요"
            
            if attempt < max_retries - 1:
                print(f"[LLM] 형식 오류 - 재시도 {attempt + 1}/{max_retries}")
                continue
            
            # Fallback
            break
        
        except httpx.TimeoutException:
            print(f"[LLM] 타임아웃 ({timeout}초) - {'재시도' if attempt < max_retries - 1 else '최종 실패'}")
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
        except httpx.HTTPError as e:
            print(f"[LLM] HTTP 에러: {type(e).__name__}: {e}")
            break
        except Exception as e:
            print(f"[LLM] 메시지 변환 실패: {type(e).__name__}: {e}")
            break
    
    # Fallback: Prophet 결과 기반 간단한 예보
    time_expressions = ["곧", "잠시 후", "조금 있으면"]
    time_expr = random.choice(time_expressions)
    
    result = f"🔮 {time_expr} "
    if alert_messages:
        result += f"{alert_messages[0]}\n"
        result += "급기 증가 및 배기 강화를 권장합니다"
    else:
        result += "공기질 정상 유지 예상\n"
        result += "현재 급배기 설정을 유지하세요"
    return result


def judge_status_simple(level: str):
    if level == "매우나쁨":
        return Status(level="매우나쁨", message="즉시 환기/점검")
    if level == "나쁨":
        return Status(level="나쁨", message="환기 가동률 상향 권장")
    if level == "보통":
        return Status(level="보통", message="선제 환기 고려")
    return Status(level="좋음", message="공기질 양호")


# =========================
# Poll loop (Modbus Input Registers)
# =========================
async def poll_loop(cfg):
    global _sample_count

    plc = cfg["plc"]
    poll = cfg["poll"]
    blk = cfg["read_block"]
    scale = cfg.get("scale", {})
    storage = cfg.get("storage", {})
    learning = cfg.get("learning", {})

    ip = plc["ip"]
    port = int(plc.get("port", 502))
    unit_id = int(plc.get("unit_id", 1))

    start = int(blk["start"])
    count = int(blk["count"])

    temp_div = float(scale.get("temp_div", 1.0))
    hum_div = float(scale.get("hum_div", 1.0))

    db_path = storage.get("sqlite_path", "airq.db")
    log_every = int(storage.get("log_every_n_samples", 5))
    bucket_min = int(learning.get("bucket_min", 15))

    interval = float(poll.get("interval_sec", 1.0))
    client = None
    reconnect_attempts = 0
    max_reconnect_delay = 60  # 최대 재연결 대기 시간 (초)
    
    while True:
        try:
            # 연결이 없거나 끊어진 경우 재연결
            if client is None or not client.connected:
                # 지수 백오프: 재연결 실패 시 대기 시간 증가
                if reconnect_attempts > 0:
                    delay = min(2 ** reconnect_attempts, max_reconnect_delay)
                    print(f"[PLC] 재연결 대기 중... ({delay}초)")
                    await asyncio.sleep(delay)
                
                print(f"[PLC] {ip}:{port} 연결 시도... (시도 {reconnect_attempts + 1}회)")
                client = AsyncModbusTcpClient(host=ip, port=port, timeout=5)
                await asyncio.wait_for(client.connect(), timeout=5)
                print(f"[PLC] {ip}:{port} 연결 성공!")
                reconnect_attempts = 0  # 연결 성공 시 카운터 리셋

            # ✅ INPUT REGISTER (FC04) - 타임아웃 추가
            rr = await asyncio.wait_for(
                client.read_input_registers(address=start, count=count, slave=unit_id),
                timeout=3.0
            )

            if rr.isError():
                print(f"[PLC] Modbus 읽기 에러 - 재연결 시도")
                reconnect_attempts += 1
                try:
                    await client.close()
                except:
                    pass
                client = None
                continue

            regs = list(rr.registers)
            mem = {start + i: regs[i] for i in range(len(regs))}

            # ===== 조리실 Modbus 주소 매핑 =====
            kitchen_co = mem.get(10)                 # %MW10 - 일산화탄소
            kitchen_co2 = mem.get(20)                # %MW20 - 이산화탄소
            kitchen_tvoc = mem.get(21)               # %MW21 - VOC
            kitchen_hum_raw = mem.get(23)            # %MW23 - 습도
            kitchen_temp_raw = mem.get(24)           # %MW24 - 온도
            kitchen_pm25 = mem.get(26)               # %MW26 - PM2.5
            kitchen_pm10 = mem.get(27)               # %MW27 - PM10
            kitchen_formaldehyde_raw = mem.get(30)   # %MW30 - 포름알데히드

            # 조리실 스케일
            kitchen_temperature = (kitchen_temp_raw / temp_div) if (kitchen_temp_raw is not None and temp_div != 0) else None
            kitchen_humidity = (kitchen_hum_raw / hum_div) if (kitchen_hum_raw is not None and hum_div != 0) else None
            kitchen_formaldehyde = kitchen_formaldehyde_raw if kitchen_formaldehyde_raw is not None else None

            kitchen_aq = AirQuality(
                timestamp_local=now_local_iso(),
                co2=int(kitchen_co2) if kitchen_co2 is not None else None,
                tvoc=int(kitchen_tvoc) if kitchen_tvoc is not None else None,
                pm25=int(kitchen_pm25) if kitchen_pm25 is not None else None,
                pm10=int(kitchen_pm10) if kitchen_pm10 is not None else None,
                formaldehyde=int(kitchen_formaldehyde) if kitchen_formaldehyde is not None else None,
                co=int(kitchen_co) if kitchen_co is not None else None,
                temperature=float(kitchen_temperature) if kitchen_temperature is not None else None,
                humidity=float(kitchen_humidity) if kitchen_humidity is not None else None,
            )

            # ===== 세척실 Modbus 주소 매핑 =====
            washing_co = mem.get(40)                 # %MW40 - 일산화탄소
            washing_co2 = mem.get(50)                # %MW50 - 이산화탄소
            washing_tvoc = mem.get(51)               # %MW51 - VOC
            washing_hum_raw = mem.get(53)            # %MW53 - 습도
            washing_temp_raw = mem.get(54)           # %MW54 - 온도
            washing_pm25 = mem.get(56)               # %MW56 - PM2.5
            washing_pm10 = mem.get(57)               # %MW57 - PM10
            washing_formaldehyde_raw = mem.get(60)   # %MW60 - 포름알데히드

            # 세척실 스케일
            washing_temperature = (washing_temp_raw / temp_div) if (washing_temp_raw is not None and temp_div != 0) else None
            washing_humidity = (washing_hum_raw / hum_div) if (washing_hum_raw is not None and hum_div != 0) else None
            washing_formaldehyde = washing_formaldehyde_raw if washing_formaldehyde_raw is not None else None

            washing_aq = AirQuality(
                timestamp_local=now_local_iso(),
                co2=int(washing_co2) if washing_co2 is not None else None,
                tvoc=int(washing_tvoc) if washing_tvoc is not None else None,
                pm25=int(washing_pm25) if washing_pm25 is not None else None,
                pm10=int(washing_pm10) if washing_pm10 is not None else None,
                formaldehyde=int(washing_formaldehyde) if washing_formaldehyde is not None else None,
                co=int(washing_co) if washing_co is not None else None,
                temperature=float(washing_temperature) if washing_temperature is not None else None,
                humidity=float(washing_humidity) if washing_humidity is not None else None,
            )

            # 조리실 데이터를 _recent에 저장
            kitchen_aq_dict = kitchen_aq.model_dump()
            _recent.append(kitchen_aq_dict)
            
            # 세척실 데이터를 _recent_washing에 저장
            washing_aq_dict = washing_aq.model_dump()
            _recent_washing.append(washing_aq_dict)
            
            # 데이터 축적 로그 (30분마다 = 360개마다로 감소)
            if _sample_count % 360 == 0:
                print(f"[데이터 축적] _recent: {len(_recent)}개, _recent_washing: {len(_recent_washing)}개")

            _sample_count += 1
            if log_every > 0 and (_sample_count % log_every == 0):
                # 조리실 데이터 DB 저장
                db_insert(db_path, kitchen_aq_dict, bucket_min=bucket_min, room="kitchen")
                # 세척실 데이터 DB 저장
                db_insert(db_path, washing_aq_dict, bucket_min=bucket_min, room="washing")

            # ✅ 최우선: PLC 데이터를 즉시 WebSocket으로 전송 (대시보드 출력)
            # 현재 공기질 등급 간단 판단 (조리실 기준)
            co2_val = kitchen_aq.co2 or 0
            pm25_val = kitchen_aq.pm25 or 0
            
            # 간단한 상태 판단 (빠른 응답)
            if co2_val > 2200 or pm25_val > 110:
                quick_status = "매우나쁨"
            elif co2_val > 2000 or pm25_val > 100:
                quick_status = "나쁨"
            elif co2_val > 1500 or pm25_val > 76:
                quick_status = "보통"
            elif co2_val > 1000 or pm25_val > 36:
                quick_status = "좋음"
            else:
                quick_status = "매우좋음"
            
            # 조리실 + 세척실 데이터를 함께 전송
            room_data = RoomData(
                kitchen=kitchen_aq,
                washing=washing_aq
            )
            
            payload = Payload(
                data=room_data,
                status=judge_status_simple(quick_status),
                alert=_last_alert_text,  # 이전 AI 알람 유지
            )
            
            
            await publish(payload)
            
            # 로그 출력 (5분마다로 감소: 12→60)
            if _sample_count % 60 == 0:
                washing_co2_val = washing_aq.co2 or 0
                washing_pm25_val = washing_aq.pm25 or 0
                print(f"[센서] 조리실 CO2:{co2_val} PM2.5:{pm25_val} | 세척실 CO2:{washing_co2_val} PM2.5:{washing_pm25_val}")

        except asyncio.TimeoutError:
            print(f"[PLC] 읽기 타임아웃 - 재연결 시도")
            reconnect_attempts += 1
            if client:
                try:
                    await client.close()
                except:
                    pass
                client = None
        except Exception as e:
            print(f"[PLC] 폴링 에러: {type(e).__name__}: {e} - 재연결 시도")
            reconnect_attempts += 1
            if client:
                try:
                    await client.close()
                except:
                    pass
                client = None
        
        await asyncio.sleep(interval)


# =========================
# 실시간 알림 루프 (빠른 응답)
# =========================
async def realtime_alert_loop(cfg):
    """
    실시간 AI 알람 생성 (Prophet 없이, 빠른 응답)
    - 5초마다 실행
    - 룰 기반 판정만 사용
    - 조리실/세척실 번갈아가며 표시
    - Prophet 예보 표시 중에는 실시간 알림 전송 안 함
    """
    global _last_prophet_time, _prophet_display_duration, _realtime_alert_room
    
    learning = cfg.get("learning", {})
    storage = cfg.get("storage", {})
    days = int(learning.get("days", 14))
    bucket_min = int(learning.get("bucket_min", 15))
    db_path = storage.get("sqlite_path", "airq.db")

    oll = cfg.get("ollama", {})
    interval = int(oll.get("alert_interval_sec", 5))
    
    print(f"[실시간 AI 알람] Loop started - interval: {interval}초 (조리실/세척실 번갈아 표시)")
    print(f"[실시간 AI 알람] Prophet 예보 표시 중에는 실시간 알림 전송 안 함 (예보 표시 시간: {_prophet_display_duration}초)")

    # 시작 즉시 초기 메시지 전송 (2초 대기 후 - WebSocket 연결 대기)
    await asyncio.sleep(2)
    await publish_alert("실시간 공기질 모니터링 시작\n센서 데이터 수집 중입니다")
    print(f"[실시간 AI 알람] 초기 메시지 전송 완료")

    alert_count = 0  # 실시간 알림 카운터
    first_run = True  # 첫 실행 플래그
    while True:
        if not first_run:
            await asyncio.sleep(interval)
        first_run = False
        alert_count += 1

        # 데이터 상태 로그 (10분마다로 감소: 12→120)
        if alert_count % 120 == 0:
            print(f"[AI 알람] 버퍼: {len(_recent) if _recent else 0}개/{len(_recent_washing) if _recent_washing else 0}개")
        
        # 데이터가 없으면 대기 (하지만 메시지는 계속 업데이트)
        if not _recent and not _recent_washing:
            await publish_alert("센서 연결 대기 중...\nPLC 데이터를 기다리고 있습니다")
            print(f"[실시간 AI 알람] 센서 연결 대기 중 (데이터 없음)")
            continue
        elif not _recent:
            await publish_alert("조리실 센서 연결 중...\n세척실 데이터는 정상 수신 중")
            print(f"[실시간 AI 알람] 조리실 데이터만 없음")
            continue
        elif not _recent_washing:
            await publish_alert("세척실 센서 연결 중...\n조리실 데이터는 정상 수신 중")
            print(f"[실시간 AI 알람] 세척실 데이터만 없음")
            continue
        

        # ✅ Prophet 예보 표시 중이면 실시간 알림 전송 안 함
        current_time = time.time()
        if _last_prophet_time > 0 and (current_time - _last_prophet_time) < _prophet_display_duration:
            remaining = int(_prophet_display_duration - (current_time - _last_prophet_time))
            print(f"[실시간 AI 알람] Prophet 예보 표시 중... (남은 시간: {remaining}초)")
            continue
        elif _last_prophet_time > 0:
            print(f"[실시간 AI 알람] Prophet 예보 종료 - 실시간 알림 재개")

        # 조리실/세척실 번갈아가며 표시
        if _realtime_alert_room == "kitchen":
            cur = _recent[-1]
            room_name = "조리실"
            _realtime_alert_room = "washing"  # 다음은 세척실
        else:
            cur = _recent_washing[-1]
            room_name = "세척실"
            _realtime_alert_room = "kitchen"  # 다음은 조리실
        
        co2_now = cur.get("co2") or 0
        pm25_now = cur.get("pm25") or 0
        
        
        # 기존 baseline (참고용, 해당 방 데이터만)
        room_db = "kitchen" if room_name == "조리실" else "washing"
        baseline = db_baseline_for_now(db_path, days=days, bucket_min=bucket_min, room=room_db)
        future = db_baseline_future(db_path, minutes_ahead=30, days=days, bucket_min=bucket_min, room=room_db)
        
        # 룰 기반 등급 판정
        level, line1, line2, future_warning = rule_status_and_action(cur, cfg, baseline, future, room_name)
        
        # 간단한 알림 생성 (LLM 없이)
        if future_warning:
            text = f"{line1}\n{line2}\n{future_warning}"
        else:
            text = f"{line1}\n{line2}"
        
        # 실시간 알림 전송
        await publish_alert(text)
        
        # 로그 제거 (불필요한 출력 최소화)
        # if alert_count % 12 == 0:
        #     print(f"[AI 알람] {room_name}: {level}")

        # latest payload 업데이트
        try:
            if _latest is not None:
                updated = Payload(
                    data=_latest.data,
                    status=judge_status_simple(level),
                    alert=text,
                )
                await publish(updated)
        except Exception:
            pass


# =========================
# 시계열 분석 루프 (백그라운드)
# =========================
async def prophet_analysis_loop(cfg):
    """
    Prophet 시계열 분석 (백그라운드, 느린 주기)
    - 60초마다 실행
    - 과거 데이터 기반 예측
    - 조리실/세척실 번갈아가며 예보
    """
    global _prophet_alert_room, _last_prophet_time
    
    learning = cfg.get("learning", {})
    storage = cfg.get("storage", {})
    days = int(learning.get("days", 14))
    bucket_min = int(learning.get("bucket_min", 15))
    db_path = storage.get("sqlite_path", "airq.db")

    oll = cfg.get("ollama", {})
    interval = int(oll.get("prophet_interval_sec", 60))
    
    print(f"[Prophet 시계열 분석] Loop started - interval: {interval}초 (조리실/세척실 번갈아 예보)")

    while True:
        await asyncio.sleep(interval)

        if not _recent or not _recent_washing:
            continue

        # 조리실/세척실 번갈아가며 예보
        if _prophet_alert_room == "kitchen":
            cur = _recent[-1]
            room_name = "조리실"
            _prophet_alert_room = "washing"  # 다음은 세척실
        else:
            cur = _recent_washing[-1]
            room_name = "세척실"
            _prophet_alert_room = "kitchen"  # 다음은 조리실
        
        co2_now = cur.get("co2") or 0
        pm25_now = cur.get("pm25") or 0
        
        print(f"\n[Prophet] {room_name} 분석 시작 (CO2:{co2_now}, PM2.5:{pm25_now})", flush=True)
        
        # ✅ DB에서 과거 7일 데이터 확인 (해당 방만)
        room_db = "kitchen" if room_name == "조리실" else "washing"
        try:
            conn = sqlite3.connect(db_path, timeout=5.0)
            cur_check = conn.cursor()
            cur_check.execute("SELECT COUNT(*) FROM airq_log WHERE room = ? AND ts_local >= datetime('now', '-7 days')", (room_db,))
            db_count = cur_check.fetchone()[0]
            conn.close()
            print(f"[Prophet] {room_name} DB에서 과거 7일 데이터 확인: {db_count}개", flush=True)
        except Exception as e:
            print(f"[Prophet] DB 확인 실패: {e}", flush=True)
            db_count = 0
        
        # ✅ Prophet 시계열 분석 수행
        prophet_result = {
            "co2": {"risk": "unknown", "predicted": None, "message": "", "current": co2_now},
            "pm25": {"risk": "unknown", "predicted": None, "message": "", "current": pm25_now},
            "overall_risk": "safe",
            "alert_messages": []
        }
        
        # DB에 최소 100개 이상의 데이터가 있어야 Prophet 분석 가능 (약 8분치)
        try:
            if db_count >= 100:
                print(f"[Prophet] {room_name} 시계열 분석 시작... (DB 데이터: {db_count}개)", flush=True)
                prophet_result = prophet_analysis(db_path, cur, cfg, room=room_db)
                
                print(f"[Prophet] 분석 완료 - 위험도: {prophet_result['overall_risk']}", flush=True)
                if prophet_result["alert_messages"]:
                    print(f"[Prophet] 선제 알람: {prophet_result['alert_messages'][0]}", flush=True)
            else:
                # DB 데이터 부족 시 Prophet 예보 건너뛰기
                needed_count = 100 - db_count
                needed_minutes = (needed_count * 5) // 60 + 1  # 5초마다 1개, 분으로 변환
                print(f"[Prophet] {room_name} DB 데이터 축적 중... ({db_count}/100개)", flush=True)
                print(f"[Prophet] 예측을 위해 약 {needed_minutes}분 더 필요합니다", flush=True)
                print(f"[Prophet] 실시간 알림은 계속 작동합니다", flush=True)
                print(f"{'='*60}\n", flush=True)
                continue  # Prophet 예보 건너뛰고 다음 주기까지 대기 (실시간 알림은 계속 작동)
        except Exception as e:
            print(f"[Prophet] 분석 실패 (무시): {str(e)[:80]}", flush=True)
            # Prophet 실패해도 기본 알림은 계속 전송
        
        # 기존 baseline (참고용, 해당 방 데이터만)
        baseline = db_baseline_for_now(db_path, days=days, bucket_min=bucket_min, room=room_db)
        future = db_baseline_future(db_path, minutes_ahead=30, days=days, bucket_min=bucket_min, room=room_db)
        
        # 룰 기반 등급 판정
        level, line1, line2, future_warning = rule_status_and_action(cur, cfg, baseline, future, room_name)
        
        print(f"[Prophet 예보] 급배기 조치 예보 생성 중...", flush=True)
        
        # ✅ 과거 동시간대 비교 + 기준표 기반 상세 예보 (항상 실행)
        # LLM 대신 정확한 데이터 기반 예보 사용 (사용자 요청)
        forecast_text = None
        if True:  # 항상 Fallback 로직 사용
            thresholds = cfg.get("thresholds", {})
            
            # 6가지 센서 값 추출
            metrics_data = {
                "CO2": {"value": cur.get("co2", 0), "key": "co2", "unit": "ppm", "baseline_key": "co2_avg"},
                "PM2.5": {"value": cur.get("pm25", 0), "key": "pm25", "unit": "㎍/㎥", "baseline_key": "pm25_avg"},
                "PM10": {"value": cur.get("pm10", 0), "key": "pm10", "unit": "㎍/㎥", "baseline_key": "pm10_avg"},
                "VOC": {"value": cur.get("tvoc", 0), "key": "voc", "unit": "ppb", "baseline_key": "tvoc_avg"},
                "포름알데히드": {"value": cur.get("formaldehyde", 0) / 10, "key": "formaldehyde", "unit": "㎍/㎥", "baseline_key": "formaldehyde_avg"},
                "CO": {"value": cur.get("co", 0), "key": "co", "unit": "ppm", "baseline_key": "co_avg"}
            }
            
            # 각 센서별 등급 판정 + 과거 동시간대 평균과 비교
            sensor_status = []
            above_normal_count = 0  # 보통 이상 개수
            rising_count = 0  # 과거보다 상승한 센서 개수
            
            for name, data in metrics_data.items():
                value = data["value"]
                key = data["key"]
                unit = data["unit"]
                baseline_key = data["baseline_key"]
                
                if value == 0:
                    continue
                
                level = get_air_quality_level(value, key, thresholds)
                
                # "매우좋음", "좋음"이면 "정상범위", 나머지는 "보통이상"
                if level in ["매우좋음", "좋음"]:
                    status = "정상범위"
                else:
                    status = "보통이상"
                    above_normal_count += 1
                
                # 과거 동시간대 평균값 가져오기
                past_avg = baseline.get(baseline_key, 0) if baseline.get("samples", 0) >= 10 else 0
                
                # 과거값과 비교 (과거값이 있을 때만)
                trend = ""
                if past_avg > 0:
                    diff_percent = ((value - past_avg) / past_avg) * 100
                    if diff_percent > 10:  # 10% 이상 상승
                        trend = "↑"
                        rising_count += 1
                    elif diff_percent < -10:  # 10% 이상 하락
                        trend = "↓"
                    else:  # 비슷한 수준
                        trend = "→"
                
                # 포름알데히드는 소수점 표시
                if name == "포름알데히드":
                    if past_avg > 0:
                        sensor_status.append(f"{name}:{value:.1f}{unit}({status}{trend} 과거:{past_avg/10:.1f})")
                    else:
                        sensor_status.append(f"{name}:{value:.1f}{unit}({status})")
                else:
                    if past_avg > 0:
                        sensor_status.append(f"{name}:{int(value)}{unit}({status}{trend} 과거:{int(past_avg)})")
                    else:
                        sensor_status.append(f"{name}:{int(value)}{unit}({status})")
            
            # 과거 동시간대 데이터 분석
            now = datetime.now()
            current_hour = now.hour
            
            time_reason = "과거 동시간대 분석"
            
            print(f"[Prophet 예보] 현재: {current_hour}시, 과거 샘플: {baseline.get('samples', 0)}개", flush=True)
            print(f"[Prophet 예보] 보통이상: {above_normal_count}개, 상승추세: {rising_count}개", flush=True)
            
            # 예보 메시지 생성 (간결하고 명확하게)
            forecast_text = f"[{room_name} AI 예보]\n\n"
            
            # 판정 및 조치사항만 표시 (센서 값 나열 제거)
            if above_normal_count >= 2:
                # 2개 이상이 보통 이상 → 급배기 강화
                forecast_text += "판정: 보통 이상 (주의 필요)\n\n"
                forecast_text += "조치:\n"
                forecast_text += "  급기+배기 강화 권장\n"
                forecast_text += "  환기 시스템 즉시 가동"
            elif above_normal_count == 1:
                # 1개가 보통 이상 → 모니터링
                if rising_count >= 2:
                    forecast_text += "판정: 일부 보통 이상 + 상승 추세\n\n"
                    forecast_text += "조치:\n"
                    forecast_text += "  환기 시스템 준비\n"
                    forecast_text += "  모니터링 강화"
                else:
                    forecast_text += "판정: 일부 보통 이상\n\n"
                    forecast_text += "조치:\n"
                    forecast_text += "  현 설정 유지\n"
                    forecast_text += "  지속 모니터링"
            else:
                # 모두 정상 범위
                if rising_count >= 2:
                    forecast_text += "판정: 정상 (상승 추세 감지)\n\n"
                    forecast_text += "조치:\n"
                    forecast_text += "  예방 환기 권장\n"
                    forecast_text += "  현 설정 유지 가능"
                else:
                    forecast_text += "판정: 모두 정상 범위\n\n"
                    forecast_text += "조치:\n"
                    forecast_text += "  현 급배기 설정 유지\n"
                    forecast_text += "  정상 운영 지속"
            
            print(f"[Prophet 예보] 메시지 생성 완료", flush=True)
        
        # ✨ Prophet 예보 전송 (AI 알림창) - 항상 60초마다 전송
        global _last_prophet_time
        _last_prophet_time = time.time()  # 예보 전송 시간 기록
        
        await publish_alert(forecast_text)
        print(f"[Prophet 예보 전송] {room_name} 완료 (표시 시간: {_prophet_display_duration}초)", flush=True)
        # 로그 간소화
        print(f"[Prophet] {room_name} 완료\n", flush=True)


# =========================
# Main
# =========================
# Google Sheets 업로드
# =========================
async def google_sheets_upload_loop(cfg):
    """
    주기적으로 SQLite 데이터를 Google Sheets에 업로드
    """
    gs_cfg = cfg.get("google_sheets", {})
    
    if not gs_cfg.get("enabled", False):
        print("[Google Sheets] 비활성화 상태 - 업로드 안 함")
        return
    
    credentials_file = gs_cfg.get("credentials_file", "credentials.json")
    spreadsheet_id = gs_cfg.get("spreadsheet_id", "")
    sheet_name = gs_cfg.get("sheet_name", "공기질데이터")
    upload_interval = int(gs_cfg.get("upload_interval_min", 60)) * 60  # 분 → 초
    
    if not spreadsheet_id:
        print("[Google Sheets] ❌ spreadsheet_id가 설정되지 않음 - 업로드 비활성화")
        return
    
    print(f"[Google Sheets] 업로드 시작 - 간격: {upload_interval//60}분")
    
    try:
        import gspread
        from oauth2client.service_account import ServiceAccountCredentials
    except ImportError:
        print("[Google Sheets] ❌ gspread 또는 oauth2client가 설치되지 않음")
        print("설치: pip install gspread oauth2client")
        return
    
    while True:
        await asyncio.sleep(upload_interval)
        
        try:
            print(f"\n[Google Sheets] 업로드 시작...")
            
            # Google Sheets 인증
            scope = ['https://spreadsheets.google.com/feeds',
                     'https://www.googleapis.com/auth/drive']
            creds = ServiceAccountCredentials.from_json_keyfile_name(credentials_file, scope)
            client = gspread.authorize(creds)
            
            # 스프레드시트 열기
            spreadsheet = client.open_by_key(spreadsheet_id)
            
            # 워크시트 가져오기 또는 생성
            try:
                worksheet = spreadsheet.worksheet(sheet_name)
            except gspread.WorksheetNotFound:
                worksheet = spreadsheet.add_worksheet(title=sheet_name, rows=1000, cols=20)
                # 헤더 추가
                worksheet.append_row([
                    "시간", "요일", "CO2(ppm)", "PM2.5(μg/m³)", "PM10(μg/m³)", 
                    "VOC(ppb)", "포름알데히드(μg/m³)", "CO(ppm)", 
                    "온도(°C)", "습도(%)"
                ])
            
            # DB에서 최근 데이터 가져오기 (마지막 업로드 이후 데이터)
            storage = cfg.get("storage", {})
            db_path = storage.get("sqlite_path", "airq.db")
            
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            
            # 마지막 업로드 시간 확인 (간단하게 최근 1시간 데이터만 업로드)
            query = """
                SELECT ts_local, wday, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity
                FROM airq_log
                WHERE ts_local >= datetime('now', '-1 hour')
                ORDER BY ts_local ASC
            """
            
            cur.execute(query)
            rows = cur.fetchall()
            conn.close()
            
            if not rows:
                print("[Google Sheets] 업로드할 새 데이터 없음")
                continue
            
            # 데이터 포맷팅
            요일_매핑 = {0: '월', 1: '화', 2: '수', 3: '목', 4: '금', 5: '토', 6: '일'}
            formatted_rows = []
            for row in rows:
                formatted_rows.append([
                    row[0],  # 시간
                    요일_매핑.get(row[1], '?'),  # 요일
                    row[2] if row[2] is not None else '',  # CO2
                    row[3] if row[3] is not None else '',  # PM2.5
                    row[4] if row[4] is not None else '',  # PM10
                    row[5] if row[5] is not None else '',  # VOC
                    row[6] if row[6] is not None else '',  # Formaldehyde
                    row[7] if row[7] is not None else '',  # CO
                    row[8] if row[8] is not None else '',  # Temperature
                    row[9] if row[9] is not None else ''   # Humidity
                ])
            
            # Google Sheets에 추가
            worksheet.append_rows(formatted_rows)
            
            print(f"[Google Sheets] 업로드 완료: {len(formatted_rows)}개 행")
            
        except FileNotFoundError:
            print(f"[Google Sheets] ❌ 인증 파일을 찾을 수 없음: {credentials_file}")
            print("Google Cloud Console에서 서비스 계정을 생성하고 JSON 키를 다운로드하세요")
            return
        except Exception as e:
            print(f"[Google Sheets] ❌ 업로드 실패: {e}")


# =========================
# 이메일 자동 발송
# =========================
async def email_report_loop(cfg):
    """
    주기적으로 공기질 리포트를 이메일로 발송
    """
    email_cfg = cfg.get("email", {})
    
    if not email_cfg.get("enabled", False):
        print("[이메일] 비활성화 상태")
        return
    
    smtp_server = email_cfg.get("smtp_server", "smtp.gmail.com")
    smtp_port = int(email_cfg.get("smtp_port", 587))
    sender_email = email_cfg.get("sender_email", "")
    sender_password = email_cfg.get("sender_password", "")
    receiver_emails = email_cfg.get("receiver_emails", [])
    daily_report_time = email_cfg.get("daily_report_time", "18:00")
    
    if not sender_email or not sender_password or not receiver_emails:
        print("[이메일] 오류: 발신자 또는 수신자 정보가 설정되지 않음")
        return
    
    print(f"[이메일] 자동 발송 시작 - 일일 리포트: {daily_report_time}")
    
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    last_report_date = None
    
    while True:
        await asyncio.sleep(60)  # 1분마다 확인
        
        try:
            now = datetime.now()
            current_time = now.strftime("%H:%M")
            current_date = now.date()
            
            # 일일 리포트 발송 시간 확인
            if current_time == daily_report_time and last_report_date != current_date:
                print(f"\n[이메일] 일일 리포트 생성 중...")
                
                # DB에서 오늘 데이터 가져오기
                storage = cfg.get("storage", {})
                db_path = storage.get("sqlite_path", "airq.db")
                
                conn = sqlite3.connect(db_path, timeout=10.0)
                cur = conn.cursor()
                
                # 오늘 데이터 조회
                query = """
                    SELECT 
                        COUNT(*) as 총데이터수,
                        AVG(co2) as 평균CO2,
                        MAX(co2) as 최대CO2,
                        AVG(pm25) as 평균PM25,
                        MAX(pm25) as 최대PM25,
                        AVG(temperature) as 평균온도,
                        AVG(humidity) as 평균습도
                    FROM airq_log
                    WHERE DATE(ts_local) = DATE('now', 'localtime')
                """
                cur.execute(query)
                stats = cur.fetchone()
                
                # 최근 데이터
                cur.execute("""
                    SELECT ts_local, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity
                    FROM airq_log
                    ORDER BY ts_local DESC
                    LIMIT 1
                """)
                latest = cur.fetchone()
                conn.close()
                
                if not stats or not latest:
                    print("[이메일] 발송할 데이터 없음")
                    continue
                
                # 학교 이름 가져오기
                school_name = email_cfg.get("school_name", "학교")
                
                # 이메일 본문 작성
                subject = f"[{school_name}] 조리실 공기질 일일 리포트 - {current_date}"
                
                body = f"""
<html>
<body style="font-family: 'Malgun Gothic', sans-serif; background-color: #f5f5f5; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h1 style="color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px;">
            🏫 {school_name} 조리실 공기질 일일 리포트
        </h1>
        
        <p style="color: #7f8c8d; font-size: 14px;">
            📅 {current_date.strftime('%Y년 %m월 %d일')} ({['월','화','수','목','금','토','일'][now.weekday()]}요일)
        </p>
        
        <h2 style="color: #34495e; margin-top: 30px;">📊 오늘의 통계</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr style="background-color: #ecf0f1;">
                <th style="padding: 12px; text-align: left; border: 1px solid #bdc3c7;">항목</th>
                <th style="padding: 12px; text-align: center; border: 1px solid #bdc3c7;">평균</th>
                <th style="padding: 12px; text-align: center; border: 1px solid #bdc3c7;">최대</th>
            </tr>
            <tr>
                <td style="padding: 10px; border: 1px solid #bdc3c7;">이산화탄소 (CO2)</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;">{int(stats[1] or 0)} ppm</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;">{int(stats[2] or 0)} ppm</td>
            </tr>
            <tr style="background-color: #f9f9f9;">
                <td style="padding: 10px; border: 1px solid #bdc3c7;">초미세먼지 (PM2.5)</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;">{int(stats[3] or 0)} μg/m³</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;">{int(stats[4] or 0)} μg/m³</td>
            </tr>
            <tr>
                <td style="padding: 10px; border: 1px solid #bdc3c7;">온도</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;" colspan="2">{stats[5]:.1f} °C</td>
            </tr>
            <tr style="background-color: #f9f9f9;">
                <td style="padding: 10px; border: 1px solid #bdc3c7;">습도</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #bdc3c7; font-weight: bold;" colspan="2">{stats[6]:.1f} %</td>
            </tr>
        </table>
        
        <h2 style="color: #34495e; margin-top: 30px;">🔍 현재 상태 (최근 측정값)</h2>
        <div style="background-color: #ecf0f1; padding: 15px; border-radius: 8px; margin-top: 15px;">
            <p style="margin: 5px 0;"><strong>측정 시간:</strong> {latest[0]}</p>
            <p style="margin: 5px 0;"><strong>CO2:</strong> {latest[1]} ppm</p>
            <p style="margin: 5px 0;"><strong>PM2.5:</strong> {latest[2]} μg/m³</p>
            <p style="margin: 5px 0;"><strong>PM10:</strong> {latest[3]} μg/m³</p>
            <p style="margin: 5px 0;"><strong>VOC:</strong> {latest[4]} ppb</p>
            <p style="margin: 5px 0;"><strong>포름알데히드:</strong> {latest[5]} μg/m³</p>
            <p style="margin: 5px 0;"><strong>CO:</strong> {latest[6]} ppm</p>
            <p style="margin: 5px 0;"><strong>온도:</strong> {latest[7]:.1f} °C</p>
            <p style="margin: 5px 0;"><strong>습도:</strong> {latest[8]:.1f} %</p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #bdc3c7; color: #95a5a6; font-size: 12px;">
            <p>이 메일은 VAQ1 공기질 모니터링 시스템에서 자동으로 발송되었습니다.</p>
            <p>새론환기시스템 | 문의: 1577-6706</p>
        </div>
    </div>
</body>
</html>
"""
                
                # 이메일 발송
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = sender_email
                msg['To'] = ', '.join(receiver_emails)
                
                html_part = MIMEText(body, 'html', 'utf-8')
                msg.attach(html_part)
                
                # SMTP 서버 연결 및 발송
                with smtplib.SMTP(smtp_server, smtp_port, timeout=30) as server:
                    server.starttls()
                    server.login(sender_email, sender_password)
                    server.send_message(msg)
                
                print(f"[이메일] 일일 리포트 발송 완료 - {len(receiver_emails)}명")
                last_report_date = current_date
                
        except Exception as e:
            print(f"[이메일] ❌ 발송 실패: {e}")


# =========================
# 엑셀 자동 기록 (5분 단위) - 조리실/세척실 분리
# =========================
async def excel_export_loop(cfg: dict):
    """
    5분마다 DB에서 최신 데이터를 가져와 엑셀 파일에 추가
    파일명: 조리실.xlsx, 세척실.xlsx
    """
    print("[엑셀 기록] Loop started - interval: 5분 (조리실/세척실 분리)")
    
    excel_file_kitchen = "조리실.xlsx"
    excel_file_washing = "세척실.xlsx"
    interval = 300  # 5분 = 300초
    
    # 엑셀 파일 초기화 함수
    def init_excel_file(file_path: str, room_name: str):
        if not Path(file_path).exists():
            print(f"[엑셀 기록] 새 파일 생성: {file_path}")
            wb = Workbook()
            ws = wb.active
            ws.title = f"{room_name} 공기질"
            
            # 헤더 스타일 설정
            header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
            header_font = Font(bold=True, color="FFFFFF", size=11)
            header_alignment = Alignment(horizontal="center", vertical="center")
            thin_border = Border(
                left=Side(style='thin'),
                right=Side(style='thin'),
                top=Side(style='thin'),
                bottom=Side(style='thin')
            )
            
            # 헤더 작성
            headers = [
                "측정일시", "이산화탄소\n(CO2, ppm)", "초미세먼지\n(PM2.5, μg/m³)", 
                "미세먼지\n(PM10, μg/m³)", "유기화합물\n(VOC, ppb)", 
                "포름알데히드\n(μg/m³)", "일산화탄소\n(CO, ppm)", 
                "온도(°C)", "습도(%)"
            ]
            
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = header_alignment
                cell.border = thin_border
            
            # 열 너비 설정
            ws.column_dimensions['A'].width = 20
            for col in ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']:
                ws.column_dimensions[col].width = 14
            
            # 행 높이 설정
            ws.row_dimensions[1].height = 35
            
            wb.save(file_path)
            print(f"[엑셀 기록] {room_name} 초기화 완료")
    
    # 조리실/세척실 파일 초기화
    init_excel_file(excel_file_kitchen, "조리실")
    init_excel_file(excel_file_washing, "세척실")
    
    # 마지막 기록 시간 (조리실/세척실 별도)
    last_record_time_kitchen = None
    last_record_time_washing = None
    
    while True:
        try:
            await asyncio.sleep(interval)
            
            db_path = cfg.get("storage", {}).get("sqlite_path", "airq.db")
            
            # ===== 조리실 데이터 처리 =====
            try:
                conn = sqlite3.connect(db_path, timeout=10.0)
                conn.execute("PRAGMA query_only = ON")
                cur = conn.cursor()
                
                # 조리실 최신 레코드 조회
                cur.execute("""
                    SELECT ts_local, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity
                    FROM airq_log
                    WHERE room = 'kitchen'
                    ORDER BY ts_local DESC
                    LIMIT 1
                """)
                
                row_kitchen = cur.fetchone()
                conn.close()
                
                if row_kitchen and row_kitchen[0] != last_record_time_kitchen:
                    ts_local, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity = row_kitchen
                    last_record_time_kitchen = ts_local
                    
                    # 엑셀 파일 열기
                    wb = load_workbook(excel_file_kitchen)
                    ws = wb.active
                    next_row = ws.max_row + 1
                    
                    # 데이터 스타일
                    data_alignment = Alignment(horizontal="center", vertical="center")
                    thin_border = Border(
                        left=Side(style='thin'),
                        right=Side(style='thin'),
                        top=Side(style='thin'),
                        bottom=Side(style='thin')
                    )
                    
                    # 데이터 쓰기
                    data_values = [
                        ts_local,
                        co2 if co2 is not None else "-",
                        pm25 if pm25 is not None else "-",
                        pm10 if pm10 is not None else "-",
                        tvoc if tvoc is not None else "-",
                        round(formaldehyde / 10, 1) if formaldehyde is not None else "-",
                        co if co is not None else "-",
                        round(temperature, 1) if temperature is not None else "-",
                        round(humidity, 1) if humidity is not None else "-"
                    ]
                    
                    for col_num, value in enumerate(data_values, 1):
                        cell = ws.cell(row=next_row, column=col_num)
                        cell.value = value
                        cell.alignment = data_alignment
                        cell.border = thin_border
                    
                    wb.save(excel_file_kitchen)
                    print(f"[엑셀 기록] ✅ 조리실 데이터 추가 (행: {next_row}, 시간: {ts_local})")
                    
            except Exception as e:
                print(f"[엑셀 기록] ❌ 조리실 오류: {e}")
            
            # ===== 세척실 데이터 처리 =====
            try:
                conn = sqlite3.connect(db_path, timeout=10.0)
                conn.execute("PRAGMA query_only = ON")
                cur = conn.cursor()
                
                # 세척실 최신 레코드 조회
                cur.execute("""
                    SELECT ts_local, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity
                    FROM airq_log
                    WHERE room = 'washing'
                    ORDER BY ts_local DESC
                    LIMIT 1
                """)
                
                row_washing = cur.fetchone()
                conn.close()
                
                if row_washing and row_washing[0] != last_record_time_washing:
                    ts_local, co2, pm25, pm10, tvoc, formaldehyde, co, temperature, humidity = row_washing
                    last_record_time_washing = ts_local
                    
                    # 엑셀 파일 열기
                    wb = load_workbook(excel_file_washing)
                    ws = wb.active
                    next_row = ws.max_row + 1
                    
                    # 데이터 스타일
                    data_alignment = Alignment(horizontal="center", vertical="center")
                    thin_border = Border(
                        left=Side(style='thin'),
                        right=Side(style='thin'),
                        top=Side(style='thin'),
                        bottom=Side(style='thin')
                    )
                    
                    # 데이터 쓰기
                    data_values = [
                        ts_local,
                        co2 if co2 is not None else "-",
                        pm25 if pm25 is not None else "-",
                        pm10 if pm10 is not None else "-",
                        tvoc if tvoc is not None else "-",
                        round(formaldehyde / 10, 1) if formaldehyde is not None else "-",
                        co if co is not None else "-",
                        round(temperature, 1) if temperature is not None else "-",
                        round(humidity, 1) if humidity is not None else "-"
                    ]
                    
                    for col_num, value in enumerate(data_values, 1):
                        cell = ws.cell(row=next_row, column=col_num)
                        cell.value = value
                        cell.alignment = data_alignment
                        cell.border = thin_border
                    
                    wb.save(excel_file_washing)
                    print(f"[엑셀 기록] ✅ 세척실 데이터 추가 (행: {next_row}, 시간: {ts_local})")
                    
            except Exception as e:
                print(f"[엑셀 기록] ❌ 세척실 오류: {e}")
                
        except Exception as e:
            print(f"[엑셀 기록] ❌ 루프 오류: {e}")
            await asyncio.sleep(60)  # 오류 시 1분 대기


# =========================
# 엑셀 파일 이메일 전송 (매일 오전 9시)
# =========================
async def excel_email_loop(cfg: dict):
    """
    매일 오전 9시에 엑셀 파일을 이메일로 전송
    """
    print("[엑셀 이메일] Loop started - 매일 오전 9시 전송")
    
    email_cfg = cfg.get("email", {})
    
    if not email_cfg.get("enabled", False):
        print("[엑셀 이메일] 이메일 기능이 비활성화되어 있습니다")
        return
    
    smtp_server = email_cfg.get("smtp_server", "smtp.gmail.com")
    smtp_port = int(email_cfg.get("smtp_port", 587))
    sender_email = email_cfg.get("sender_email", "")
    sender_password = email_cfg.get("sender_password", "")
    receiver_emails = ["m3n89t@gmail.com"]  # 고정 수신자
    school_name = email_cfg.get("school_name", "중앙여중")
    
    if not sender_email or not sender_password:
        print("[엑셀 이메일] 오류: 발신자 정보가 설정되지 않음")
        return
    
    print(f"[엑셀 이메일] 설정 완료 - 발신: {sender_email}, 수신: {receiver_emails}")
    
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.base import MIMEBase
    from email import encoders
    
    last_send_date = None
    check_count = 0
    
    while True:
        await asyncio.sleep(60)  # 1분마다 확인
        check_count += 1
        
        try:
            now = datetime.now()
            current_hour = now.hour
            current_minute = now.minute
            current_date = now.date()
            
            # 매 1분마다 상태 로그 출력 (9시 전후에는 더 자주)
            if current_hour == 8 or current_hour == 9:
                print(f"[엑셀 이메일] 대기 중... 현재: {now.strftime('%H:%M')}, 마지막 전송: {last_send_date}")
            elif check_count % 30 == 0:  # 그 외 시간대는 30분마다
                print(f"[엑셀 이메일] 대기 중... 현재: {now.strftime('%H:%M')}, 마지막 전송: {last_send_date}")
            
            # 테스트 모드 비활성화 (정상 운영)
            test_mode = False  # 테스트 완료 - 비활성화
            
            # 매일 오전 9시 0~10분 사이에 전송 (시간 범위 확대: 5분→10분)
            should_send = (current_hour == 9 and current_minute < 10 and last_send_date != current_date) or test_mode
            
            if should_send:
                print(f"\n[엑셀 이메일] ========================================")
                print(f"[엑셀 이메일] 전송 시작: {now.strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"[엑셀 이메일] ========================================")
                
                # 엑셀 파일 존재 여부 사전 확인
                excel_file_kitchen = "조리실.xlsx"
                excel_file_washing = "세척실.xlsx"
                kitchen_exists = Path(excel_file_kitchen).exists()
                washing_exists = Path(excel_file_washing).exists()
                
                print(f"[엑셀 이메일] 파일 확인:")
                print(f"  - 조리실: {'존재' if kitchen_exists else '없음'} ({excel_file_kitchen})")
                print(f"  - 세척실: {'존재' if washing_exists else '없음'} ({excel_file_washing})")
                
                if not kitchen_exists and not washing_exists:
                    print(f"[엑셀 이메일] ❌ 오류: 첨부할 엑셀 파일이 없습니다!")
                    print(f"[엑셀 이메일] 힌트: 시스템이 최소 5분 이상 실행되어야 엑셀 파일이 생성됩니다.")
                    continue
                
                # 이메일 작성
                msg = MIMEMultipart()
                msg['Subject'] = f"[{school_name}] 공기질 누적 데이터 - {current_date}"
                msg['From'] = sender_email
                msg['To'] = ', '.join(receiver_emails)
                
                # 본문
                body = f"""
안녕하세요,

{school_name} 공기질 모니터링 시스템입니다.

{current_date.strftime('%Y년 %m월 %d일')} 기준 누적 데이터를 첨부합니다.

- 조리실.xlsx: 조리실 공기질 데이터
- 세척실.xlsx: 세척실 공기질 데이터

감사합니다.

---
새론환기시스템 | 문의: 1577-6706
"""
                msg.attach(MIMEText(body, 'plain', 'utf-8'))
                
                attached_count = 0
                
                # 조리실 엑셀 파일 첨부
                if kitchen_exists:
                    with open(excel_file_kitchen, 'rb') as f:
                        part = MIMEBase('application', 'octet-stream')
                        part.set_payload(f.read())
                        encoders.encode_base64(part)
                        part.add_header('Content-Disposition', f'attachment; filename={excel_file_kitchen}')
                        msg.attach(part)
                        attached_count += 1
                        print(f"[엑셀 이메일] ✅ [1/2] 조리실 파일 첨부 완료")
                
                # 세척실 엑셀 파일 첨부
                if washing_exists:
                    with open(excel_file_washing, 'rb') as f:
                        part = MIMEBase('application', 'octet-stream')
                        part.set_payload(f.read())
                        encoders.encode_base64(part)
                        part.add_header('Content-Disposition', f'attachment; filename={excel_file_washing}')
                        msg.attach(part)
                        attached_count += 1
                        print(f"[엑셀 이메일] ✅ [2/2] 세척실 파일 첨부 완료")
                
                if attached_count > 0:
                    # SMTP 서버 연결 및 발송
                    print(f"[엑셀 이메일] SMTP 연결 중... ({smtp_server}:{smtp_port})")
                    with smtplib.SMTP(smtp_server, smtp_port, timeout=30) as server:
                        server.starttls()
                        print(f"[엑셀 이메일] 로그인 중... ({sender_email})")
                        server.login(sender_email, sender_password)
                        print(f"[엑셀 이메일] 메일 전송 중...")
                        server.send_message(msg)
                    
                    print(f"\n[엑셀 이메일] ========================================")
                    print(f"[엑셀 이메일] ✅ 전송 완료!")
                    print(f"[엑셀 이메일] 시간: {now.strftime('%Y-%m-%d %H:%M:%S')}")
                    print(f"[엑셀 이메일] 수신자: {receiver_emails}")
                    print(f"[엑셀 이메일] 첨부 파일: {attached_count}개")
                    if kitchen_exists:
                        print(f"[엑셀 이메일]   - {excel_file_kitchen}")
                    if washing_exists:
                        print(f"[엑셀 이메일]   - {excel_file_washing}")
                    print(f"[엑셀 이메일] ========================================\n")
                    
                    last_send_date = current_date
                else:
                    print(f"[엑셀 이메일] ❌ 첨부 파일이 없어서 전송하지 않음")
                
        except Exception as e:
            print(f"\n[엑셀 이메일] ========================================")
            print(f"[엑셀 이메일] ❌ 전송 실패!")
            print(f"[엑셀 이메일] 오류: {e}")
            print(f"[엑셀 이메일] ========================================\n")


# =========================
async def main():
    cfg = load_config()
    db_init(cfg.get("storage", {}).get("sqlite_path", "airq.db"))

    print("\n" + "="*70)
    print("[VAQ2] 시스템 시작 중...")
    print("="*70)

    # 7개의 독립적인 루프 실행
    print("[1/7] PLC 데이터 수신 루프 시작...")
    asyncio.create_task(poll_loop(cfg))                    # PLC 데이터 수신 (5초)
    
    print("[2/7] 실시간 AI 알람 루프 시작...")
    asyncio.create_task(realtime_alert_loop(cfg))          # 실시간 AI 알람 (5초)
    
    print("[3/7] Prophet 분석 루프 시작...")
    asyncio.create_task(prophet_analysis_loop(cfg))        # Prophet 분석 (60초, 백그라운드)
    
    print("[4/7] Google Sheets 업로드 루프 시작...")
    asyncio.create_task(google_sheets_upload_loop(cfg))    # Google Sheets 업로드 (60분)
    
    print("[5/7] 이메일 리포트 루프 시작...")
    asyncio.create_task(email_report_loop(cfg))            # 이메일 리포트 발송 (일일)
    
    print("[6/7] 엑셀 자동 기록 루프 시작...")
    asyncio.create_task(excel_export_loop(cfg))            # 엑셀 자동 기록 (5분)
    
    print("[7/7] 엑셀 이메일 전송 루프 시작...")
    asyncio.create_task(excel_email_loop(cfg))             # 엑셀 파일 이메일 전송 (매일 9시)
    
    print("\n[OK] 모든 백그라운드 작업이 시작되었습니다!")
    print("="*70 + "\n")

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
