@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 이상이 필요합니다. https://nodejs.org/ 에서 LTS를 설치하고 다시 실행하세요.
  pause
  exit /b 1
)
node bridge.mjs
pause
