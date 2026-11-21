@echo off
setlocal
rem Execution policy may block loading .ps1 files ("not digitally signed").
rem Run the script CONTENT as an in-memory scriptblock instead: no file loading, no policy block.
powershell -NoProfile -Command "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 '%~dp0sign-anchors.ps1')))"
set RC=%errorlevel%
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
