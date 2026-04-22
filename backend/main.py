from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import auth, voting, admin
from app.core.database import engine, Base
from sqlalchemy import text
import os
import threading

# Create database tables
Base.metadata.create_all(bind=engine)

# Run schema migrations for existing databases
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE votes ADD COLUMN election_id INTEGER REFERENCES elections(id)"))
        _conn.commit()
    except Exception:
        pass  # Column already exists
    try:
        _conn.execute(text("ALTER TABLE elections ADD COLUMN lot_winner_name TEXT"))
        _conn.commit()
    except Exception:
        pass  # Column already exists


def _warmup_easyocr():
    """Pre-load the EasyOCR model in a background thread so it's ready for the
    first document verification request instead of blocking it."""
    try:
        from app.services.id_verification_service import _easyocr_extract
        from PIL import Image
        import numpy as np
        dummy = Image.fromarray(np.zeros((64, 64, 3), dtype=np.uint8))
        _easyocr_extract(dummy)  # initialises _EASYOCR_READER
        print("=== EasyOCR pre-warm complete ===")
    except Exception as exc:
        print(f"=== EasyOCR pre-warm failed (non-fatal): {exc} ===")


threading.Thread(target=_warmup_easyocr, daemon=True).start()

app = FastAPI(title="Smart Online Voting System Using Face Recognition")

# CORS middleware
default_cors_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:5173",
]

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or default_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads directory
os.makedirs("uploads/voters", exist_ok=True)
os.makedirs("uploads/temp", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(voting.router, prefix="/api/voting", tags=["Voting"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])

@app.get("/")
def read_root():
    return {"message": "Smart Online Voting System API", "status": "active"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
