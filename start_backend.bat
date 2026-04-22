@echo off
echo Starting Online Voting System Backend...
echo.

cd backend

echo Activating virtual environment...
call venv\Scripts\activate

echo.
echo Starting FastAPI server...
uvicorn main:app --reload --host 0.0.0.0 --port 8000

pause
