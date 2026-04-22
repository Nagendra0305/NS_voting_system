@echo off
echo Starting Online Voting System Frontend...
echo.

cd frontend

echo Installing dependencies (if needed)...
call npm install

echo.
echo Starting React development server...
call npm run dev

pause
