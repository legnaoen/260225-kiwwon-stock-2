@echo off
echo ============================================
echo  Kiwoom Crawler Proxy - Environment Setup
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Creating Python virtual environment...
python -m venv venv
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python 3.10+ first.
    pause
    exit /b 1
)

echo [2/3] Installing dependencies...
venv\Scripts\pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo [3/3] Installing Playwright Chromium browser...
venv\Scripts\python -m playwright install chromium
if errorlevel 1 (
    echo ERROR: Failed to install Playwright Chromium.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Setup Complete!
echo  Server can be started with:
echo    venv\Scripts\python crawler_server.py
echo ============================================
pause
