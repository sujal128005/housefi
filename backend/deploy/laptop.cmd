@echo off
rem Runs deploy\laptop.ps1 without changing Windows' script policy. From the backend folder: deploy\laptop start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0laptop.ps1" %*
