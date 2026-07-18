@echo off
cd /d "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0BridgeControl.ps1"
