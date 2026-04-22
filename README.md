# Smart Online Voting System with Face Recognition

A secure and modern online voting system that uses facial recognition technology to verify voter identity and prevent fraud.

## Features

- **Face Recognition Authentication**: Uses Dlib and face_recognition library for accurate voter verification
- **Secure Voting**: One person can vote only once, verified through facial recognition
- **Real-time Results**: Automatic result generation and visualization
- **Admin Dashboard**: Comprehensive admin panel for managing elections, candidates, and voters
- **Modern UI**: Built with React for a responsive and intuitive user experience
- **RESTful API**: FastAPI backend with proper authentication and authorization

## Technology Stack

### Backend
- FastAPI (Python web framework)
- SQLAlchemy (ORM)
- face_recognition library (Face recognition using Dlib)
- OpenCV (Image processing)
- JWT (Authentication)
- SQLite (Database)

### Frontend
- React 18
- React Router (Navigation)
- Axios (API calls)
- react-webcam (Camera access)
- Recharts (Data visualization)
- Vite (Build tool)

## Project Structure

```
voting_system/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py          # Authentication endpoints
│   │   │   ├── voting.py        # Voting endpoints
│   │   │   └── admin.py         # Admin endpoints
│   │   ├── core/
│   │   │   ├── config.py        # Configuration
│   │   │   └── database.py      # Database setup
│   │   ├── models/
│   │   │   └── models.py        # Database models
│   │   ├── schemas/
│   │   │   └── schemas.py       # Pydantic schemas
│   │   └── services/
│   │       ├── auth_service.py           # Authentication logic
│   │       └── face_recognition_service.py  # Face recognition logic
│   ├── uploads/                 # File uploads directory
│   ├── main.py                  # FastAPI application
│   └── requirements.txt         # Python dependencies
│
└── frontend/
    ├── src/
    │   ├── components/          # React components
    │   ├── pages/
    │   │   ├── HomePage.jsx
    │   │   ├── RegisterPage.jsx
    │   │   ├── VotingPage.jsx
    │   │   ├── AdminLoginPage.jsx
    │   │   ├── AdminDashboard.jsx
    │   │   └── ThankYouPage.jsx
    │   ├── services/
    │   │   └── api.js           # API service
    │   ├── App.jsx              # Main app component
    │   ├── App.css              # Global styles
    │   └── main.jsx             # Entry point
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## Installation

### Prerequisites
- Python 3.8 or higher
- Node.js 16 or higher
- npm or yarn
- Webcam (for face recognition)

### Backend Setup

1. Navigate to the backend directory:
```bash
cd voting_system/backend
```

2. Create a virtual environment:
```bash
python -m venv venv

# On Windows
venv\Scripts\activate

# On macOS/Linux
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

Note: Installing `dlib` might require cmake and other build tools. 
- On Ubuntu/Debian: `sudo apt-get install cmake`
- On macOS: `brew install cmake`
- On Windows: Install Visual Studio Build Tools

4. Create the database and start the server:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`
API documentation: `http://localhost:8000/docs`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd voting_system/frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Deploying To A Website

This project is set up for a Vercel + Render deployment:

1. Deploy the backend from the repo root on Render using [render.yaml](render.yaml).
2. Deploy the frontend from [frontend/vercel.json](frontend/vercel.json) on Vercel.
3. Set the frontend environment variables in Vercel:

```bash
VITE_API_BASE_URL=https://your-backend.onrender.com/api
VITE_API_ORIGIN=https://your-backend.onrender.com
```

4. Set the backend CORS origins in Render:

```bash
CORS_ORIGINS=https://your-frontend.vercel.app,https://your-custom-domain.com
```

5. Build the frontend before deploying:

```bash
cd frontend
npm run build
```

The backend now reads `DATABASE_URL` from the environment, so Render can provide PostgreSQL while local development still uses SQLite.

If you want a single-domain deployment later, serve the built frontend from the backend and keep `VITE_API_BASE_URL=/api`.

## Usage Guide

### 1. Create Admin Account

Before using the system, create an admin account using the API:

```bash
curl -X POST "http://localhost:8000/api/auth/admin/create" \
  -H "Content-Type: multipart/form-data" \
  -F "username=admin" \
  -F "password=admin123"
```

Or use the Swagger UI at `http://localhost:8000/docs`

### 2. Admin Login and Setup

1. Go to Admin Login page
2. Login with your credentials
3. Create an election:
   - Set title and description
   - Set start and end dates
   - Activate the election
4. Add candidates:
   - Enter candidate details
   - Upload photo (optional)
   - Set party and symbol

### 3. Voter Registration

1. Go to Register page
2. Fill in personal details:
   - Full name
   - Email address
   - Phone number
   - Voter ID
3. Capture face photo using webcam
4. Submit registration

### 4. Voting Process

1. Go to Vote Now page
2. Enter your Voter ID
3. Capture live face photo for verification
4. System verifies your identity
5. Select your preferred candidate
6. Submit vote
7. Receive confirmation

### 5. View Results

Admins can view real-time results in the Admin Dashboard:
- Total votes cast
- Vote distribution by candidate
- Voter turnout percentage
- Visual charts and graphs

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new voter
- `POST /api/auth/verify-face` - Verify face for voting
- `POST /api/auth/admin/login` - Admin login
- `POST /api/auth/admin/create` - Create admin account

### Voting
- `GET /api/voting/candidates` - Get all candidates
- `GET /api/voting/election-status` - Check election status
- `POST /api/voting/vote` - Cast vote
- `GET /api/voting/my-status` - Get voter status

### Admin
- `POST /admin/candidates` - Create candidate
- `GET /admin/candidates` - Get all candidates
- `DELETE /admin/candidates/{id}` - Delete candidate
- `GET /admin/voters` - Get all voters
- `POST /admin/elections` - Create election
- `GET /admin/elections` - Get all elections
- `PUT /admin/elections/{id}/toggle` - Toggle election status
- `GET /admin/results` - Get voting results
- `GET /admin/statistics` - Get system statistics

## Security Features

1. **Face Recognition**: Uses 128-dimensional face encoding for accurate verification
2. **JWT Authentication**: Secure token-based authentication
3. **One Vote Per Person**: System prevents multiple votes from same person
4. **Anonymous Voting**: Votes are not linked to voter identity in results
5. **Secure File Upload**: Validates and stores face images securely
6. **CORS Protection**: Configured for specific origins
7. **Input Validation**: Pydantic schemas validate all inputs

## Database Schema

### Voters Table
- id (Primary Key)
- voter_id (Unique)
- name
- email (Unique)
- phone
- face_encoding (JSON)
- face_image_path
- is_verified
- has_voted
- registered_at

### Candidates Table
- id (Primary Key)
- name
- party
- symbol
- description
- image_path
- created_at

### Votes Table
- id (Primary Key)
- voter_id (Foreign Key)
- candidate_id (Foreign Key)
- voted_at

### Elections Table
- id (Primary Key)
- title
- description
- start_date
- end_date
- is_active
- created_at

### Admins Table
- id (Primary Key)
- username (Unique)
- hashed_password
- created_at

## Troubleshooting

### Face Recognition Issues
- Ensure good lighting conditions
- Face should be clearly visible
- Camera permissions must be granted
- Try different camera angles

### Installation Issues
- If dlib installation fails, install cmake first
- On Windows, install Visual Studio Build Tools
- Update pip: `pip install --upgrade pip`

### Camera Not Working
- Check browser permissions
- Use HTTPS or localhost
- Try different browsers (Chrome/Firefox recommended)

## Future Enhancements

- [ ] Multi-factor authentication
- [ ] Live video streaming for verification
- [ ] Mobile app version
- [ ] Blockchain integration for vote records
- [ ] Email notifications
- [ ] SMS OTP verification
- [ ] Multi-language support
- [ ] Accessibility improvements
- [ ] Advanced analytics dashboard
- [ ] Export results to PDF/Excel

## Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is created for educational purposes.

## Support

For issues and questions:
- Create an issue in the repository
- Check the API documentation at `/docs`
- Review the troubleshooting section

## Authors

Created as a demonstration of secure online voting using face recognition technology.

---

**Note**: This system is designed for demonstration purposes. For production use, additional security measures, scalability considerations, and compliance with electoral regulations should be implemented.
