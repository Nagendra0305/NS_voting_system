# Quick Setup Guide

## For Windows Users

### Backend Setup
1. Open Command Prompt or PowerShell
2. Navigate to the project directory
3. Run:
```
cd voting_system\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

4. Start the backend:
```
cd ..
start_backend.bat
```

Or manually:
```
cd backend
venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup
1. Open a new Command Prompt
2. Navigate to the project directory
3. Run:
```
cd voting_system
start_frontend.bat
```

Or manually:
```
cd frontend
npm install
npm run dev
```

## For Linux/Mac Users

### Backend Setup
1. Open Terminal
2. Navigate to the project directory
3. Run:
```
cd voting_system/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

4. Make script executable and start:
```
cd ..
chmod +x start_backend.sh
./start_backend.sh
```

Or manually:
```
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup
1. Open a new Terminal
2. Navigate to the project directory
3. Run:
```
cd voting_system
chmod +x start_frontend.sh
./start_frontend.sh
```

Or manually:
```
cd frontend
npm install
npm run dev
```

## First Time Setup

### 1. Create Admin Account
Use one of these methods:

**Using curl:**
```bash
curl -X POST "http://localhost:8000/api/auth/admin/create" \
  -H "Content-Type: multipart/form-data" \
  -F "username=admin" \
  -F "password=admin123"
```

**Using Postman or API client:**
- URL: POST http://localhost:8000/api/auth/admin/create
- Body (form-data):
  - username: admin
  - password: admin123

**Using Swagger UI:**
- Open http://localhost:8000/docs
- Find POST /api/auth/admin/create
- Click "Try it out"
- Enter username and password
- Click "Execute"

### 2. Access the Application
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

### 3. Initial Configuration
1. Login to admin panel with your credentials
2. Create an election
3. Add candidates
4. Activate the election

### 4. Test the System
1. Register as a voter (use a webcam)
2. Verify and vote
3. Check results in admin panel

## Troubleshooting

### dlib Installation Issues
If you encounter issues installing dlib:

**Windows:**
1. Install Visual Studio Build Tools from: https://visualstudio.microsoft.com/downloads/
2. Install cmake: `pip install cmake`
3. Then: `pip install dlib`

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install build-essential cmake
sudo apt-get install libopenblas-dev liblapack-dev
sudo apt-get install libx11-dev libgtk-3-dev
pip install dlib
```

**macOS:**
```bash
brew install cmake
pip install dlib
```

### Camera Access Issues
- Make sure you're using HTTPS or localhost
- Grant camera permissions in browser settings
- Try Chrome or Firefox (recommended)
- Check if another application is using the camera

### Port Already in Use
If port 8000 or 3000 is already in use:

**Backend (change port 8000):**
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

**Frontend:** Edit `vite.config.js` and change the port number

### Database Issues
If you encounter database errors:
```bash
cd backend
rm voting_system.db  # Delete old database
# Restart the server - it will create a new database
```

## System Requirements

### Minimum:
- Python 3.8+
- Node.js 16+
- 4GB RAM
- Webcam
- Modern browser (Chrome, Firefox, Edge)

### Recommended:
- Python 3.10+
- Node.js 18+
- 8GB RAM
- Good lighting for face recognition
- Fast internet connection

## Need Help?

- Check the main README.md for detailed documentation
- Visit http://localhost:8000/docs for API documentation
- Ensure all dependencies are properly installed
- Check console logs for error messages

## Important Notes

1. **Security**: Change the SECRET_KEY in backend/app/core/config.py for production
2. **Face Recognition**: Requires good lighting and clear face visibility
3. **Browser Support**: Chrome and Firefox work best with webcam features
4. **Production**: This setup is for development. Use production-ready servers (Gunicorn, Nginx) for deployment
