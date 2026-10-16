# VAQ2 대시보드

React 기반 실시간 공기질 모니터링 대시보드 (24인치 키오스크용)

## 기술 스택

- **Frontend**: React + Vite + TypeScript
- **Backend**: Express + SQLite
- **실시간 통신**: WebSocket (ws)
- **AI**: Ollama (로컬)

## 기능

- 실시간 센서 데이터 모니터링 (5초마다 갱신)
- 조리실/세척실 각 8개 지표 카드 표시
- 상태별 색상 표시 (좋음/주의/위험)
- 미니 라인 차트 (최근 30분)
- 팬 제어 패널 (급기/배기)
- 냉장고 온도 모니터링
- AI 자동 브리핑 (1분마다)
- AI 채팅 기능

## 설치

### 1. 전체 의존성 설치

```bash
npm run install:all
```

또는 개별 설치:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

### 2. 환경 변수 설정

`.env.example`을 참고하여 `server/.env` 파일을 생성하세요:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma2:2b
PORT=3001
```

### 3. Ollama 설치 및 실행

Ollama가 설치되어 있고 실행 중이어야 합니다:

```bash
# Ollama 설치 (https://ollama.ai)

# 빠른 응답을 위한 경량 모델 (권장)
ollama pull qwen2.5:0.5b

# 또는 기본 모델
ollama pull gemma2:2b
```

**모델 비교**:
- `qwen2.5:0.5b`: 매우 빠름 (약 400MB, 1-2초 응답)
- `gemma2:2b`: 중간 (약 1.6GB, 3-5초 응답)
- `llama3.2:latest`: 느림 (약 2GB, 5-10초 응답)

## 실행

### 개발 모드 (FE/BE 동시 실행)

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- WebSocket: ws://localhost:3001

### 개별 실행

```bash
# 서버만
npm run dev:server

# 클라이언트만
npm run dev:client
```

## 전체화면 모드

키오스크 모드로 사용하려면:

1. 브라우저에서 **F11** 키를 누르거나
2. 대시보드 상단의 **"전체화면 (F11)"** 버튼 클릭

## 프로젝트 구조

```
vaq2/
├── server/           # Express 백엔드
│   ├── index.ts      # 서버 진입점
│   ├── db.ts         # SQLite 데이터베이스
│   ├── sensors.ts    # 모의 센서 데이터 생성
│   ├── websocket.ts # WebSocket 서버
│   └── ai.ts         # Ollama AI 통합
├── client/           # React 프론트엔드
│   └── src/
│       ├── components/  # UI 컴포넌트
│       ├── hooks/       # React 훅
│       ├── thresholds.ts # 임계치 정의
│       └── theme.ts     # 색상 테마
└── package.json      # 루트 스크립트
```

## 주요 설정 파일

- `client/src/thresholds.ts`: 지표별 임계치 및 상태 계산
- `client/src/theme.ts`: 색상 및 스타일 테마
- `server/.env`: 환경 변수 (Ollama URL, 모델 등)

## 데이터베이스

SQLite 데이터베이스는 `server/data.db`에 자동 생성됩니다.

## 주의사항

- Ollama가 실행 중이어야 AI 기능이 동작합니다
- 모든 기능은 로컬에서 동작하도록 설계되었습니다
- 인터넷 연결 없이 사용 가능합니다

