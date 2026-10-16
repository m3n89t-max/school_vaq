# VAQ1 공기질 모니터링 시스템 설치 가이드

## 📋 시스템 구성

- **백엔드**: Python FastAPI (PLC Modbus Bridge)
- **프론트엔드**: React + Vite
- **AI 모델**: Ollama (Qwen 2.5 1.5B)
- **데이터베이스**: SQLite
- **시계열 분석**: Prophet

---

## 💻 사전 준비 (새 컴퓨터에 필요한 프로그램)

### 1. Python 3.10 이상 설치

**다운로드:** https://www.python.org/downloads/

**설치 시 주의사항:**
- ✅ "Add Python to PATH" 체크 필수!
- ✅ "Install for all users" 권장

**설치 확인:**
```powershell
python --version
# Python 3.10.x 이상이어야 함
```

### 2. Node.js 18 이상 설치

**다운로드:** https://nodejs.org/ (LTS 버전)

**설치 확인:**
```powershell
node --version
# v18.x.x 이상

npm --version
# 9.x.x 이상
```

### 3. Git 설치 (선택사항)

**다운로드:** https://git-scm.com/download/win

또는 USB/네트워크로 프로젝트 폴더 복사 가능

### 4. Ollama 설치

**다운로드:** https://ollama.com/download

**설치 후 모델 다운로드:**
```powershell
ollama pull qwen2.5:1.5b
```

**설치 확인:**
```powershell
ollama list
# qwen2.5:1.5b가 보여야 함
```

---

## 📁 프로젝트 파일 복사

### 방법 1: USB로 복사 (추천)

1. 기존 컴퓨터에서 `vaq1` 폴더 전체를 USB에 복사
2. 새 컴퓨터의 원하는 위치에 붙여넣기
   - 예: `C:\Users\사용자명\Desktop\vaq1`

### 방법 2: 네트워크 공유

1. 기존 컴퓨터에서 `vaq1` 폴더를 네트워크 공유
2. 새 컴퓨터에서 네트워크 드라이브로 연결 후 복사

### 방법 3: Git (Git 사용 시)

```powershell
git clone [저장소 URL]
```

---

## 🔧 백엔드 설치 (PLC Modbus Bridge)

### 1. Python 가상환경 생성 (선택사항이지만 권장)

```powershell
cd C:\Users\사용자명\Desktop\vaq1\plc_modbus_bridge
python -m venv venv
venv\Scripts\activate
```

### 2. 필수 라이브러리 설치

```powershell
cd C:\Users\사용자명\Desktop\vaq1\plc_modbus_bridge
pip install -r requirements.txt
```

**설치되는 패키지:**
- FastAPI
- Uvicorn
- PyModbus
- Prophet
- Pandas, NumPy
- 기타 의존성

**설치 시간:** 약 3-5분 (인터넷 속도에 따라 다름)

### 3. 설정 파일 확인 및 수정

**파일:** `config.yaml`

**중요 설정:**
```yaml
plc:
  ip: "192.168.0.120"  # PLC IP 주소 확인 필요
  port: 502
  unit_id: 1

poll:
  interval_sec: 5.0

storage:
  sqlite_path: "airq.db"
  log_every_n_samples: 60  # 5분마다 저장

ollama:
  url: "http://127.0.0.1:11434/api/generate"
  model: "qwen2.5:1.5b"
```

**PLC IP 주소 확인 방법:**
- 네트워크 관리자에게 문의
- 또는 기존 시스템 설정 확인

### 4. 데이터베이스 초기화 (자동)

첫 실행 시 자동으로 `airq.db` 파일이 생성됩니다.

---

## 🎨 프론트엔드 설치

### 1. 의존성 패키지 설치

```powershell
cd C:\Users\사용자명\Desktop\vaq1\vaq1\client
npm install
```

**설치 시간:** 약 2-5분

### 2. 환경 변수 확인 (필요시)

프론트엔드는 `localhost:8000` (백엔드)에 자동으로 연결됩니다.

다른 서버를 사용하는 경우, 다음 파일 수정:
- `src/hooks/useWebSocket.ts`
- `src/hooks/usePLCAlert.ts`
- `src/components/MetricChartModal.tsx`

---

## 🚀 시스템 실행

### 1. Ollama 실행 (자동 시작되지 않은 경우)

```powershell
ollama serve
```

**확인:**
```powershell
ollama list
```

### 2. 백엔드 서버 실행

**새 PowerShell 창 열기:**
```powershell
cd C:\Users\사용자명\Desktop\vaq1\plc_modbus_bridge
python main.py
```

**정상 실행 시 로그:**
```
[PLC] 192.168.0.120:502 연결 시도...
[PLC] 192.168.0.120:502 연결 성공!
[실시간 AI 알람] Loop started - interval: 5초
[Prophet 시계열 분석] Loop started - interval: 60초
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**PLC 연결 실패 시:**
- PLC IP 주소 확인
- 네트워크 연결 확인
- 방화벽 설정 확인

### 3. 프론트엔드 서버 실행

**새 PowerShell 창 열기:**
```powershell
cd C:\Users\사용자명\Desktop\vaq1\vaq1\client
npm run dev
```

**정상 실행 시:**
```
VITE v5.x.x ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.x.x:5173/
```

### 4. 브라우저에서 접속

**주소:** http://localhost:5173

---

## ✅ 설치 확인 체크리스트

- [ ] Python 3.10 이상 설치됨
- [ ] Node.js 18 이상 설치됨
- [ ] Ollama 설치 및 qwen2.5:1.5b 모델 다운로드됨
- [ ] 프로젝트 폴더 복사됨
- [ ] 백엔드 패키지 설치됨 (`pip install -r requirements.txt`)
- [ ] 프론트엔드 패키지 설치됨 (`npm install`)
- [ ] PLC IP 주소 설정됨 (`config.yaml`)
- [ ] Ollama 실행 중
- [ ] 백엔드 서버 실행 중 (포트 8000)
- [ ] 프론트엔드 서버 실행 중 (포트 5173)
- [ ] 브라우저에서 대시보드 접속 가능
- [ ] PLC 데이터 수신 확인

---

## 🔥 자동 시작 설정 (선택사항)

Windows 시작 시 자동으로 실행하려면:

### 1. 배치 파일 생성

**파일명:** `C:\Users\사용자명\Desktop\vaq1\시작.bat`

```batch
@echo off
echo VAQ1 시스템 시작 중...

REM Ollama 실행 (이미 실행 중이면 무시)
start "" "C:\Users\사용자명\AppData\Local\Programs\Ollama\ollama.exe" serve

REM 백엔드 서버 실행
start "VAQ1 Backend" cmd /k "cd /d C:\Users\사용자명\Desktop\vaq1\plc_modbus_bridge && python main.py"

REM 3초 대기
timeout /t 3 /nobreak

REM 프론트엔드 서버 실행
start "VAQ1 Frontend" cmd /k "cd /d C:\Users\사용자명\Desktop\vaq1\vaq1\client && npm run dev"

REM 5초 대기
timeout /t 5 /nobreak

REM 브라우저 자동 실행
start "" "http://localhost:5173"

echo 모든 서비스가 시작되었습니다.
```

### 2. 시작 프로그램에 등록

1. `Win + R` → `shell:startup`
2. 열린 폴더에 `시작.bat` 바로가기 복사

---

## ❗ 자주 발생하는 문제 해결

### 1. `pip` 명령어를 찾을 수 없음

**원인:** Python이 PATH에 등록되지 않음

**해결:**
- Python 재설치 (Add to PATH 체크)
- 또는 수동으로 PATH 추가

### 2. `npm` 명령어를 찾을 수 없음

**원인:** Node.js가 PATH에 등록되지 않음

**해결:**
- Node.js 재설치
- PowerShell 재시작

### 3. 포트 8000 또는 5173이 이미 사용 중

**해결:**
```powershell
# 포트 사용 중인 프로세스 확인
netstat -ano | findstr :8000
netstat -ano | findstr :5173

# 프로세스 종료 (PID 확인 후)
taskkill /PID [프로세스ID] /F
```

### 4. PLC 연결 실패

**확인사항:**
- PLC 전원 켜져 있는지
- 네트워크 케이블 연결 확인
- IP 주소 정확한지 (`config.yaml`)
- 방화벽에서 포트 502 허용

**테스트:**
```powershell
ping 192.168.0.120
```

### 5. Prophet 설치 오류 (Windows)

**원인:** C++ 컴파일러 필요

**해결:**
- Microsoft C++ Build Tools 설치
- 또는 Miniconda 사용

### 6. 대시보드가 검정 화면

**원인:** WebSocket 연결 실패

**해결:**
- 백엔드 서버 실행 확인
- 브라우저 콘솔(F12) 에러 확인
- 강력 새로고침 (Ctrl+Shift+R)

### 7. Ollama 모델 응답 없음

**확인:**
```powershell
ollama list
ollama run qwen2.5:1.5b "테스트"
```

**해결:**
- Ollama 재시작
- 모델 재다운로드

---

## 📞 지원 및 문의

설치 중 문제가 발생하면:
1. 에러 메시지 전체를 복사
2. 어느 단계에서 발생했는지 기록
3. 시스템 환경 정보 (Windows 버전, Python 버전 등)

---

## 📝 업데이트 방법

기존 시스템을 업데이트하려면:

1. 백엔드 및 프론트엔드 서버 중지
2. 새 파일로 교체
3. 변경된 패키지 설치:
```powershell
# 백엔드
cd plc_modbus_bridge
pip install -r requirements.txt --upgrade

# 프론트엔드
cd vaq1/client
npm install
```
4. 서버 재시작

---

## 📧 이메일 자동 발송 설정 (선택사항)

공기질 데이터를 이메일로 자동 발송할 수 있습니다.

### 기능
- ✅ 일일 공기질 리포트
- ✅ HTML 형식의 보기 좋은 리포트
- ✅ 평균/최대값 통계 포함

### 설정 방법

**1. Gmail 앱 비밀번호 생성**
- Google 계정 → 보안 → 2단계 인증 활성화
- 앱 비밀번호 생성 (16자리)

**2. config.yaml 수정**

```yaml
email:
  enabled: true
  smtp_server: "smtp.gmail.com"
  smtp_port: 587
  sender_email: "your_email@gmail.com"
  sender_password: "your_app_password"  # 앱 비밀번호
  receiver_emails:
    - "manager@company.com"
    - "admin@company.com"
  daily_report_time: "18:00"  # 매일 오후 6시
```

**3. 서버 재시작**

**자세한 설정 방법:**
- `plc_modbus_bridge/EMAIL_SETUP.md` 참고

---

## 🎯 빠른 시작 요약

```powershell
# 1. 필수 프로그램 설치
# - Python 3.10+
# - Node.js 18+
# - Ollama

# 2. Ollama 모델 다운로드
ollama pull qwen2.5:1.5b

# 3. 백엔드 설치
cd plc_modbus_bridge
pip install -r requirements.txt

# 4. 프론트엔드 설치
cd ..\vaq1\client
npm install

# 5. 실행 (3개의 별도 터미널)
# 터미널 1: Ollama (보통 자동 실행됨)
ollama serve

# 터미널 2: 백엔드
cd plc_modbus_bridge
python main.py

# 터미널 3: 프론트엔드
cd vaq1\client
npm run dev

# 6. 브라우저 접속
# http://localhost:5173
```

---

**설치 완료! 🎉**
