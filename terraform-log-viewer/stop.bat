@echo off
cd /d %~dp0
echo ==============================
echo Stopping Terraform Log Viewer...
echo ==============================

docker compose down

echo ==============================
echo Containers stopped.
echo ==============================
pause
