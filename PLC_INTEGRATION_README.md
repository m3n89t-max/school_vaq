# PLC Modbus Bridge와 UI 연동 가이드

## 아키텍처

```
PLC (Modbus TCP)
    ↓
PLC Modbus Bridge (포트 8000)
    ↓ WebSocket
Backend Server (포트 3001)
    ↓ WebSocket
Frontend UI
```

## 실행 순서

### 1. PLC Modbus Bridge 실행

```bash
cd plc_modbus_bridge
python main.py
```

- PLC에서 실시간 데이터 수집
- 포트: 8000
- WebSocket: ws://localhost:8000/ws
- REST API: http://localhost:8000/api/latest

### 2. Backend Server 실행

```bash
cd vaq2/server
npm install
npm run dev
```

- PLC Bridge에서 데이터를 가져와 UI에 전달
- 포트: 3001
- WebSocket: ws://localhost:3001

### 3. Frontend 실행

```bash
cd vaq2/client
npm install
npm run dev
```

- UI 접속: http://localhost:5173

## 데이터 흐름

### PLC → Backend

1. PLC Modbus Bridge가 PLC의 %MW20~27 레지스터에서 데이터 읽기
2. Input Register (Function Code 4) 사용
3. Backend Server가 PLC Bridge의 WebSocket을 통해 실시간 데이터 수신
4. 조리실(kitchen) 센서 데이터로 사용

### 센서 매핑

| PLC 레지스터 | 센서 데이터 | 설명 |
|-------------|-----------|------|
| MW20 | CO2 | 이산화탄소 (ppm) |
| MW21 | TVOC | 총휘발성유기화합물 (ppb) |
| MW23 | 습도 | 상대습도 (% ÷ 10) |
| MW24 | 온도 | 온도 (°C ÷ 10) |
| MW26 | PM2.5 | 미세먼지 (㎍/m³) |
| MW27 | PM10 | 초미세먼지 (㎍/m³) |

### Backend 동작

- **PLC 연결 시**: 조리실 데이터를 PLC에서 가져옴
- **PLC 미연결 시**: 모의 데이터 자동 생성
- 세척실 데이터는 항상 모의 데이터 사용

## 설정 파일

### PLC 설정: `plc_modbus_bridge/config.yaml`

```yaml
plc:
  ip: "192.168.250.120"
  port: 502
  unit_id: 1

poll:
  interval_sec: 1.0

read_block:
  start: 20     # %MW20 시작
  count: 8      # MW20 ~ MW27 (8개)

scale:
  temp_div: 10.0
  hum_div:  10.0
```

## 트러블슈팅

### PLC 연결 실패

1. PLC IP 주소 확인: `192.168.250.120`
2. 네트워크 연결 확인
3. PLC Modbus TCP 설정 확인
4. Firewall 설정 확인

### Backend에서 PLC 데이터를 받지 못함

1. PLC Bridge가 실행 중인지 확인
2. http://localhost:8000/api/latest 접속하여 데이터 확인
3. Backend 로그에서 "PLC 데이터 업데이트" 메시지 확인

### UI에 데이터가 표시되지 않음

1. Backend Server가 실행 중인지 확인 (포트 3001)
2. 브라우저 콘솔에서 WebSocket 연결 확인
3. Network 탭에서 WebSocket 메시지 확인

## 포트 정리

- **8000**: PLC Modbus Bridge
- **3001**: Backend Server
- **5173**: Frontend (개발 모드)

모든 서비스가 정상적으로 실행되면 UI에서 PLC의 실시간 데이터를 확인할 수 있습니다! 🎉







