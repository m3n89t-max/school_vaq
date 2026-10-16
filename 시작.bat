@echo off
echo.
echo ================================================================
echo          PLC Air Quality Monitoring System v2.0
echo ================================================================
echo.

REM Kill existing processes
echo Stopping existing processes...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
echo.

REM Start PLC Bridge
echo [1/3] Starting PLC Bridge...
if exist "%~dp0plc_modbus_bridge" (
    start "PLC Bridge" cmd /k "cd /d %~dp0plc_modbus_bridge && python main.py"
    timeout /t 3 /nobreak >nul
    echo       OK: PLC Bridge started (port 8000)
) else (
    echo       ERROR: plc_modbus_bridge folder not found!
)
echo.

REM Start Backend
echo [2/3] Starting Backend Server...
if exist "%~dp0vaq2\server" (
    start "Backend Server" cmd /k "cd /d %~dp0vaq2\server && npm run dev"
    timeout /t 5 /nobreak >nul
    echo       OK: Backend started (port 3001)
) else (
    echo       ERROR: vaq2\server folder not found!
)
echo.

REM Start Frontend
echo [3/3] Starting Frontend UI...
if exist "%~dp0vaq2\client" (
    start "Frontend UI" cmd /k "cd /d %~dp0vaq2\client && npm run dev"
    timeout /t 4 /nobreak >nul
    echo       OK: Frontend started (port 5173)
) else (
    echo       ERROR: vaq2\client folder not found!
)
echo.

echo ================================================================
echo   System Started Successfully!
echo ================================================================
echo.
echo Access URL: http://localhost:5173
echo.
echo Opening browser in 5 seconds...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo Do not close this window!
echo.
pause
