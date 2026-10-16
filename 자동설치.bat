@echo off
chcp 65001 >nul
echo ========================================
echo VAQ1 공기질 모니터링 시스템 자동 설치
echo ========================================
echo.

REM 관리자 권한 확인
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [정보] 관리자 권한으로 다시 실행합니다...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

REM Python 확인
echo [1/7] Python 확인 중...
python --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo.
    echo Python 3.10 이상을 설치해주세요:
    echo https://www.python.org/downloads/
    echo.
    echo 설치 시 "Add Python to PATH" 옵션을 체크하세요!
    pause
    exit /b 1
) else (
    python --version
)

REM Node.js 확인
echo [2/7] Node.js 확인 중...
node --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo.
    echo Node.js LTS 버전을 설치해주세요:
    echo https://nodejs.org/
    pause
    exit /b 1
) else (
    node --version
)

REM Ollama 확인
echo [3/7] Ollama 확인 중...
ollama --version >nul 2>&1
if errorlevel 1 (
    echo [경고] Ollama가 설치되어 있지 않습니다.
    echo.
    echo Ollama를 설치해주세요:
    echo https://ollama.com/download
    echo.
    set /p continue="설치 없이 계속하시겠습니까? (Y/N): "
    if /i not "%continue%"=="Y" exit /b 1
) else (
    ollama --version
    echo.
    echo Ollama 모델 다운로드 중...
    ollama pull qwen2.5:1.5b
)

REM 백엔드 패키지 설치
echo.
echo [4/7] 백엔드 Python 패키지 설치 중...
cd plc_modbus_bridge
pip install -r requirements.txt
if errorlevel 1 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)

REM 프론트엔드 패키지 설치
echo.
echo [5/7] 프론트엔드 패키지 설치 중...
cd ..\vaq1\client
call npm install
if errorlevel 1 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)

REM 시작 스크립트 생성
echo.
echo [6/7] 실행 스크립트 생성 중...
cd ..\..
(
echo @echo off
echo chcp 65001 ^>nul
echo echo ========================================
echo echo VAQ1 시스템 시작 중...
echo echo ========================================
echo echo.
echo.
echo REM Ollama 실행 확인
echo ollama serve ^>nul 2^>^&1 ^&
echo.
echo REM 백엔드 서버 실행
echo echo [1/2] 백엔드 서버 시작 중...
echo start "VAQ1 Backend" cmd /k "cd /d %~dp0plc_modbus_bridge && python main.py"
echo.
echo REM 3초 대기
echo timeout /t 3 /nobreak ^>nul
echo.
echo REM 프론트엔드 서버 실행
echo echo [2/2] 프론트엔드 서버 시작 중...
echo start "VAQ1 Frontend" cmd /k "cd /d %~dp0vaq1\client && npm run dev"
echo.
echo REM 5초 대기
echo echo.
echo echo 서버 시작 중... 잠시만 기다려주세요...
echo timeout /t 5 /nobreak ^>nul
echo.
echo REM 브라우저 자동 실행
echo echo 브라우저를 실행합니다...
echo start "" "http://localhost:5173"
echo.
echo echo ========================================
echo echo VAQ1 시스템이 실행되었습니다!
echo echo ========================================
echo echo.
echo echo 브라우저: http://localhost:5173
echo echo.
echo echo 종료하려면 터미널 창을 닫으세요.
echo echo ========================================
) > 실행.bat

REM 바탕화면 바로가기 생성
echo [7/7] 바탕화면 바로가기 생성 중...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\VAQ1 공기질 모니터링.lnk'); $s.TargetPath = '%cd%\실행.bat'; $s.WorkingDirectory = '%cd%'; $s.IconLocation = '%SystemRoot%\System32\shell32.dll,277'; $s.Description = 'VAQ1 공기질 모니터링 시스템'; $s.Save()"

echo.
echo ========================================
echo 설치 완료!
echo ========================================
echo.
echo 다음 파일이 생성되었습니다:
echo - 실행.bat (프로그램 실행)
echo - 바탕화면 바로가기
echo.
echo 바탕화면의 'VAQ1 공기질 모니터링' 아이콘을
echo 더블클릭하여 실행하세요!
echo.
echo ========================================
echo 선택적 기능 설정 (필요 시):
echo ========================================
echo.
echo 1. 이메일 자동 발송 (일일 리포트)
echo    - plc_modbus_bridge\EMAIL_SETUP.md 참고
echo    - config.yaml에서 이메일 설정
echo.
echo 2. Google Sheets 자동 저장
echo    - plc_modbus_bridge\GOOGLE_SHEETS_SETUP.md 참고
echo    - Google API 인증 필요
echo.
echo ========================================
pause
