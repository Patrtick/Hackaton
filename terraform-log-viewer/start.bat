@echo off
cd /d %~dp0
echo ==============================
echo Rebuilding and starting Terraform Log Viewer...
echo ==============================

REM docker compose build --no-cache
docker compose up -d

echo ==============================
echo Site is running at: http://localhost:8080
echo ==============================
pause
