# VAQ2 단일 설치 파일 만들기 가이드

## 📦 개요

VAQ2 시스템을 하나의 Windows 설치 프로그램(.exe)으로 패키징하는 방법입니다.

**결과물:**
- `VAQ2_Setup.exe` (약 500MB-1GB)
- 더블클릭만으로 전체 시스템 설치
- Python, Node.js 등 자동 설치 또는 내장

---

## 🎯 패키징 방법 비교

### 방법 1: PyInstaller + Inno Setup (권장) ⭐

**장점:**
- 상대적으로 간단
- Windows 설치 프로그램 표준
- 파일 크기 최적화 가능

**단점:**
- Ollama는 별도 설치 필요

### 방법 2: Electron 앱으로 변환

**장점:**
- 완전한 데스크톱 앱
- 크로스 플랫폼

**단점:**
- 구조 대폭 변경 필요
- 파일 크기 매우 큼 (1GB+)

### 방법 3: Docker + Portable 실행 파일

**장점:**
- 모든 것이 컨테이너화
- 환경 독립적

**단점:**
- Docker Desktop 필요
- Windows에서 설정 복잡

---

## 🔨 방법 1: PyInstaller + Inno Setup (상세 가이드)

### 사전 준비

**필요한 프로그램:**
1. Python 3.10+
2. Node.js 18+
3. [Inno Setup](https://jrsoftware.org/isinfo.php) (무료)
4. PyInstaller

---

## 단계 1: 프론트엔드 빌드

### 1-1. React 프로덕션 빌드

```powershell
cd C:\Users\SAERON02\Desktop\vaq2\vaq2\client
npm run build
```

**결과:** `dist` 폴더에 정적 파일 생성

### 1-2. 빌드 파일을 백엔드로 복사

```powershell
# vaq2/client/dist -> plc_modbus_bridge/static
xcopy /E /I dist ..\..\plc_modbus_bridge\static
```

---

## 단계 2: 백엔드를 단일 EXE로 패키징

### 2-1. PyInstaller 설치

```powershell
cd C:\Users\SAERON02\Desktop\vaq2\plc_modbus_bridge
pip install pyinstaller
```

### 2-2. main.py 수정 (정적 파일 서빙 추가)

**파일 생성:** `main_standalone.py`

```python
# main.py를 복사하고 다음 추가
from fastapi.staticfiles import StaticFiles
import os

# 기존 app 생성 후 추가:
# 정적 파일 서빙 (프론트엔드)
if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

# 나머지는 main.py와 동일
```

### 2-3. PyInstaller spec 파일 생성

**파일 생성:** `vaq2.spec`

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['main_standalone.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('config.yaml', '.'),
        ('static', 'static'),
        ('airq.db', '.'),  # 빈 DB 포함
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'prophet',
        'pymodbus',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='VAQ2_Server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # 콘솔 창 표시 (로그 확인용)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='logo.ico'  # 아이콘 파일 (선택사항)
)
```

### 2-4. EXE 빌드

```powershell
pyinstaller vaq2.spec
```

**결과:** `dist/VAQ2_Server.exe` 생성 (약 300-500MB)

**테스트:**
```powershell
cd dist
.\VAQ2_Server.exe
```

브라우저에서 `http://localhost:8000` 접속하여 확인

---

## 단계 3: Windows 설치 프로그램 만들기

### 3-1. Inno Setup 스크립트 작성

**파일 생성:** `vaq2_installer.iss`

```ini
; VAQ2 설치 스크립트

[Setup]
AppName=VAQ2 공기질 모니터링 시스템
AppVersion=1.0.0
AppPublisher=새론환기시스템
DefaultDirName={autopf}\VAQ2
DefaultGroupName=VAQ2
OutputDir=output
OutputBaseFilename=VAQ2_Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\VAQ2_Server.exe

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 아이콘 만들기"; GroupDescription: "추가 아이콘:"
Name: "startupicon"; Description: "Windows 시작 시 자동 실행"; GroupDescription: "시작 프로그램:"

[Files]
; 메인 실행 파일
Source: "dist\VAQ2_Server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.yaml"; DestDir: "{app}"; Flags: ignoreversion
Source: "airq.db"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist

; Ollama 설치 파일 (포함하는 경우)
; Source: "OllamaSetup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\VAQ2 실행"; Filename: "{app}\VAQ2_Server.exe"
Name: "{group}\VAQ2 종료"; Filename: "taskkill"; Parameters: "/F /IM VAQ2_Server.exe"
Name: "{group}\설정"; Filename: "notepad.exe"; Parameters: "{app}\config.yaml"
Name: "{autodesktop}\VAQ2"; Filename: "{app}\VAQ2_Server.exe"; Tasks: desktopicon

[Run]
; Ollama가 설치되어 있지 않으면 안내 메시지
Filename: "{app}\VAQ2_Server.exe"; Description: "VAQ2 서버 실행"; Flags: postinstall nowait skipifsilent

; Ollama 자동 설치 (선택사항)
; Filename: "{tmp}\OllamaSetup.exe"; Parameters: "/S"; StatusMsg: "Ollama 설치 중..."; Flags: runhidden

[Registry]
; 시작 프로그램 등록
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "VAQ2"; ValueData: "{app}\VAQ2_Server.exe"; Tasks: startupicon

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM VAQ2_Server.exe"; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  
  // Ollama 설치 확인
  if not FileExists(ExpandConstant('{autopf}\Ollama\ollama.exe')) then
  begin
    if MsgBox('Ollama가 설치되어 있지 않습니다. VAQ2 실행을 위해 Ollama가 필요합니다.' + #13#10 + 
              '설치를 계속하시겠습니까?' + #13#10#13#10 + 
              '(설치 후 https://ollama.com 에서 Ollama를 설치하세요)', 
              mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // 설치 완료 후 브라우저 실행
    Exec('rundll32.exe', 'url.dll,FileProtocolHandler http://localhost:8000', '', SW_SHOW, ewNoWait, ResultCode);
  end;
end;
```

### 3-2. Inno Setup 컴파일

1. Inno Setup Compiler 실행
2. `vaq2_installer.iss` 열기
3. Build → Compile 클릭
4. `output/VAQ2_Setup.exe` 생성

**결과:** 단일 설치 파일 완성! 🎉

---

## 단계 4: 배포 및 테스트

### 4-1. 새 컴퓨터에서 테스트

1. `VAQ2_Setup.exe`를 USB에 복사
2. 새 컴퓨터에서 실행
3. 설치 과정 따라하기
4. 설치 완료 후 자동으로 브라우저 열림

### 4-2. 설치 후 추가 작업

**Ollama 설치 (자동 안내):**
```powershell
# 설치 프로그램이 안내하거나
# 수동 설치: https://ollama.com/download
ollama pull qwen2.5:1.5b
```

**PLC IP 설정:**
1. 시작 메뉴 → VAQ2 → 설정
2. `config.yaml` 파일에서 PLC IP 수정
3. VAQ2 재시작

---

## 📦 간편 배치 파일 방법 (빠른 대안)

완전한 설치 파일이 아니더라도, 자동 설치 배치 파일로 간소화할 수 있습니다.

**파일 생성:** `자동설치.bat`

```batch
@echo off
echo ========================================
echo VAQ2 자동 설치 스크립트
echo ========================================
echo.

REM Python 확인
python --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo https://python.org 에서 Python 3.10 이상을 설치하세요.
    pause
    exit /b 1
)

REM Node.js 확인
node --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 Node.js를 설치하세요.
    pause
    exit /b 1
)

REM Ollama 확인
ollama --version >nul 2>&1
if errorlevel 1 (
    echo [경고] Ollama가 설치되어 있지 않습니다.
    echo https://ollama.com 에서 설치 후 다시 실행하세요.
    pause
    exit /b 1
)

echo [1/5] Ollama 모델 다운로드 중...
ollama pull qwen2.5:1.5b

echo [2/5] 백엔드 패키지 설치 중...
cd plc_modbus_bridge
pip install -r requirements.txt

echo [3/5] 프론트엔드 패키지 설치 중...
cd ..\vaq2\client
call npm install

echo [4/5] 시작 스크립트 생성 중...
cd ..\..\
echo @echo off > 실행.bat
echo start "VAQ2 Backend" cmd /k "cd /d %cd%\plc_modbus_bridge && python main.py" >> 실행.bat
echo timeout /t 3 /nobreak >> 실행.bat
echo start "VAQ2 Frontend" cmd /k "cd /d %cd%\vaq2\client && npm run dev" >> 실행.bat
echo timeout /t 5 /nobreak >> 실행.bat
echo start "" "http://localhost:5173" >> 실행.bat

echo [5/5] 바탕화면 바로가기 생성...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\VAQ2.lnk'); $s.TargetPath = '%cd%\실행.bat'; $s.WorkingDirectory = '%cd%'; $s.Save()"

echo.
echo ========================================
echo 설치 완료!
echo ========================================
echo.
echo 바탕화면의 'VAQ2' 아이콘을 더블클릭하여 실행하세요.
echo.
pause
```

이 방법은:
- ✅ 빠르게 구현 가능
- ✅ 수정이 쉬움
- ❌ Python/Node.js는 여전히 별도 설치 필요

---

## 🎯 권장 방법

### 프로젝트 규모별 추천

**소규모 배포 (1-10대):**
→ **자동설치.bat** 사용 (가장 빠름)

**중규모 배포 (10-50대):**
→ **PyInstaller + Inno Setup** (표준 설치 프로그램)

**대규모 배포 (50대+):**
→ **Docker 컨테이너** 또는 **중앙 서버 방식**

---

## 📝 파일 구조 (PyInstaller 방식)

```
vaq2/
├── plc_modbus_bridge/
│   ├── main_standalone.py
│   ├── config.yaml
│   ├── static/          (React 빌드 결과물)
│   ├── vaq2.spec
│   └── dist/
│       └── VAQ2_Server.exe
├── vaq2_installer.iss
└── output/
    └── VAQ2_Setup.exe   ← 최종 배포 파일
```

---

## ❗ 주의사항

1. **Ollama 포함 여부**
   - Ollama 용량 큼 (500MB+)
   - 별도 설치 권장 또는 설치 프로그램에 다운로드 링크 포함

2. **데이터베이스**
   - 빈 DB 포함하고, 사용자 데이터는 별도 폴더에 저장

3. **config.yaml**
   - 기본값 포함, 설치 후 사용자가 PLC IP 수정 필요

4. **라이선스**
   - 사용하는 라이브러리의 라이선스 확인 필요

5. **업데이트**
   - 자동 업데이트 기능 추가 고려
   - 또는 새 설치 파일 배포

---

## 🚀 빠른 시작 (PyInstaller 방식)

```powershell
# 1. 프론트엔드 빌드
cd vaq2/client
npm run build

# 2. 정적 파일 복사
xcopy /E /I dist ..\..\plc_modbus_bridge\static

# 3. PyInstaller 설치
cd ..\..\plc_modbus_bridge
pip install pyinstaller

# 4. vaq2.spec 파일 생성 (위 내용 참고)

# 5. 빌드
pyinstaller vaq2.spec

# 6. Inno Setup으로 설치 프로그램 생성
# (vaq2_installer.iss 컴파일)

# 7. 완성!
# output/VAQ2_Setup.exe
```

---

**설치 파일 완성! 🎉**

배포 및 사용이 훨씬 간편해집니다!
