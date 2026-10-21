@echo off
rem Dev servers: dev start ^| stop ^| restart ^| status ^| logs
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*
