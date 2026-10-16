@echo off
chcp 65001 >nul
color 0E
echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║                                                                ║
echo ║        🔧 문제 해결 스크립트                                   ║
echo ║        (PC 재부팅 후 PLC 연결 안 될 때)                       ║
echo ║                                                                ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo [1/4] 기존 프로세스 종료 중...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM node.exe 2>nul
echo       ✓ 완료
echo.

echo [2/4] 네트워크 어댑터 초기화 중...
ipconfig /release >nul 2>&1
ipconfig /renew >nul 2>&1
echo       ✓ 완료
echo.

echo [3/4] PLC 연결 테스트 중...
ping -n 2 192.168.250.120 >nul 2>&1
if %errorlevel%==0 (
    echo       ✓ PLC 연결 정상
) else (
    echo       ✗ PLC 연결 실패 - PLC 전원 확인 필요
    pause
    exit /b 1
)
echo.

echo [4/4] 시스템 시작 중...
timeout /t 2 /nobreak >nul
start "" "%~dp0시작.bat"
echo       ✓ 완료
echo.

echo ╔════════════════════════════════════════════════════════════════╗
echo ║  ✅ 문제가 해결되었습니다!                                     ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo 잠시 후 시스템이 시작됩니다...
timeout /t 3 /nobreak >nul


