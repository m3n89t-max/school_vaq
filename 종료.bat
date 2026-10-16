@echo off
chcp 65001 >nul
color 0C
echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║                                                                ║
echo ║        🛑 시스템 종료                                          ║
echo ║                                                                ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo 🔌 모든 프로세스 종료 중...
echo.

echo [1/3] Frontend UI 종료 중...
taskkill /F /FI "WindowTitle eq Frontend UI*" 2>nul
if %errorlevel%==0 (
    echo       ✓ Frontend 종료됨
) else (
    echo       - Frontend가 실행 중이지 않음
)
echo.

echo [2/3] Backend + AI 서버 종료 중...
taskkill /F /FI "WindowTitle eq Backend*" 2>nul
if %errorlevel%==0 (
    echo       ✓ Backend 종료됨
) else (
    echo       - Backend가 실행 중이지 않음
)
echo.

echo [3/3] PLC Bridge 종료 중...
taskkill /F /FI "WindowTitle eq PLC Bridge*" 2>nul
if %errorlevel%==0 (
    echo       ✓ PLC Bridge 종료됨
) else (
    echo       - PLC Bridge가 실행 중이지 않음
)
echo.

REM 추가로 남아있을 수 있는 Node.js 프로세스 정리
taskkill /F /IM node.exe 2>nul >nul
taskkill /F /IM python.exe /FI "WindowTitle eq *main.py*" 2>nul >nul

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo ✅ 모든 시스템이 종료되었습니다!
echo.
echo 다시 시작하려면 "시작.bat"를 실행하세요.
echo.
pause



