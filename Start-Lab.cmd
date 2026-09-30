@echo off
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" src\lab.js %*
) else (
  node src\lab.js %*
)
pause
