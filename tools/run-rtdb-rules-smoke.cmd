@echo off
setlocal
"%~dp0..\.deploy-tools\node-v22.23.1-win-x64\node.exe" "%~dp0rtdb-rules-smoke-test.mjs"
if errorlevel 1 exit /b %errorlevel%
"%~dp0..\.deploy-tools\node-v22.23.1-win-x64\node.exe" "%~dp0ai-agent-rules.test.mjs"
