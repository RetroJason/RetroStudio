@echo off
REM update-version.bat
REM Updates version.json with current git commit information (Windows version)

for /f %%i in ('git rev-parse HEAD') do set COMMIT_HASH=%%i
for /f %%i in ('git rev-parse --short HEAD') do set SHORT_HASH=%%i
for /f %%i in ('git branch --show-current') do set BRANCH=%%i

REM Get current timestamp in UTC
for /f %%i in ('powershell -Command "Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ' -AsUTC"') do set TIMESTAMP=%%i

REM Create version.json
(
echo {
echo   "commit": "%COMMIT_HASH%",
echo   "shortCommit": "%SHORT_HASH%",
echo   "timestamp": "%TIMESTAMP%",
echo   "branch": "%BRANCH%",
echo   "version": "development"
echo }
) > version.json

echo Updated version.json with commit %SHORT_HASH%
