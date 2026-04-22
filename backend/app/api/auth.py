from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.models import Voter, Admin, Vote, Election
from app.schemas.schemas import VoterCreate, VoterResponse, Token, AdminLogin, AdminCreate, AdminResetPassword
from app.services.auth_service import get_password_hash, verify_password, create_access_token
from app.services.face_recognition_service import face_service
from app.services.liveness_service import get_liveness_service
from app.services.id_verification_service import verify_voter_id_document, extract_text_from_image, validate_voter_card_format
from datetime import timedelta, datetime
from app.core.config import settings
import json
import os
import shutil
from typing import Optional

router = APIRouter()
liveness_service = get_liveness_service(settings.SECRET_KEY)


_ALLOWED_VOTER_PROOF_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/jfif",
}


def _ensure_voter_proof_image(upload: UploadFile) -> None:
    ctype = (upload.content_type or "").lower()
    if ctype not in _ALLOWED_VOTER_PROOF_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid voter ID proof file type. "
                "Please upload only an image file (JPG, PNG, WEBP, AVIF, HEIC)."
            ),
        )


@router.post("/liveness/verify")
async def verify_liveness(
    voter_id: str = Form(...),
    purpose: str = Form(...),
    blink_count: int = Form(...),
    live_image: UploadFile = File(...),
):
    """Issue short-lived liveness proof token after blink + face-presence validation."""
    allowed_purposes = {"register", "update-face", "vote-verify"}
    purpose = purpose.strip().lower()
    if purpose not in allowed_purposes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid liveness purpose"
        )

    if blink_count < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Blink not detected. Please blink at least once."
        )

    image_data = await live_image.read()
    if not face_service.detect_face_in_image(image_data):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected for liveness proof"
        )

    token = liveness_service.create_liveness_token(voter_id=voter_id, purpose=purpose, ttl_seconds=180)
    return {
        "liveness_token": token,
        "expires_in": 180,
        "purpose": purpose,
    }

@router.post("/debug-ocr")
async def debug_ocr(voter_id_proof: UploadFile = File(...)):
    """Debug endpoint: returns raw OCR text extracted from uploaded image."""
    data = await voter_id_proof.read()
    text = await extract_text_from_image(data)
    return {"ocr_text": text}


@router.post("/validate-voter-card")
async def validate_voter_card(voter_id_proof: UploadFile = File(...)):
    """Validate voter-card format/style only (size + approved background + EPIC markers)."""
    _ensure_voter_proof_image(voter_id_proof)
    data = await voter_id_proof.read()
    ok, message, _ = await validate_voter_card_format(data)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )
    return {
        "success": True,
        "message": "Voter card format validated.",
    }

@router.post("/verify-details")
async def verify_details(
    name: str = Form(...),
    fathers_name: str = Form(...),
    voter_id: str = Form(...),
    voter_id_proof: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Step 1: Verify only the text details (name, father's name, voter ID number)
    against the uploaded document using OCR.
    Also checks if the voter is already registered in the database.
    Returns per-field results so the frontend can show exactly which field failed.
    """
    # Block only when ALL three fields match a registered voter (case-insensitive)
    existing_voter = db.query(Voter).filter(
        func.lower(Voter.voter_id) == voter_id.strip().lower(),
        func.lower(Voter.name) == name.strip().lower(),
        func.lower(Voter.fathers_name) == fathers_name.strip().lower()
    ).first()

    if existing_voter:
        return {
            "success": False,
            "already_registered": True,
            "message": "You are already registered in the system. Duplicate registration is not allowed.",
            "name_matched": False,
            "voter_id_matched": False,
            "fathers_name_matched": False,
        }

    _ensure_voter_proof_image(voter_id_proof)
    proof_data = await voter_id_proof.read()
    verification = await verify_voter_id_document(
        image_bytes=proof_data,
        entered_name=name,
        entered_voter_id=voter_id,
        entered_fathers_name=fathers_name,
    )
    return {
        "success": verification["success"],
        "already_registered": False,
        "message": verification["message"],
        "name_matched": verification["name_matched"],
        "voter_id_matched": verification["voter_id_matched"],
        "fathers_name_matched": verification["fathers_name_matched"],
    }

@router.post("/check-face-match")
async def check_face_match(
    face_image: UploadFile = File(...),
    voter_id_proof: UploadFile = File(...),
):
    """
    Check whether the face in a live photo matches the face printed
    on the voter ID proof document.
    Returns: { match, confidence, distance, message }
    """
    live_data = await face_image.read()
    _ensure_voter_proof_image(voter_id_proof)
    proof_data = await voter_id_proof.read()
    result = face_service.compare_id_face_with_live(proof_data, live_data)
    return result

@router.post("/register", response_model=VoterResponse)
async def register_voter(
    name: str = Form(...),
    fathers_name: str = Form(...),
    phone: str = Form(...),
    voter_id: str = Form(...),
    liveness_token: str = Form(...),
    face_image: UploadFile = File(...),
    voter_id_proof: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Register a new voter with face recognition and voter ID proof verification"""
    
    # Check if voter already exists
    existing_voter = db.query(Voter).filter(
        Voter.voter_id == voter_id
    ).first()
    
    if existing_voter:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Voter with this voter ID already exists"
        )

    ok, msg, _ = liveness_service.verify_liveness_token(
        token=liveness_token,
        voter_id=voter_id,
        purpose="register",
        consume=True,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Liveness verification required: {msg}"
        )

    # ── 1. Verify voter ID proof document ────────────────────────────────────
    _ensure_voter_proof_image(voter_id_proof)
    proof_data = await voter_id_proof.read()
    verification = await verify_voter_id_document(
        image_bytes=proof_data,
        entered_name=name,
        entered_voter_id=voter_id,
        entered_fathers_name=fathers_name,
    )

    if not verification["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{verification['message']} "
                f"(name_matched={verification['name_matched']}, "
                f"voter_id_matched={verification['voter_id_matched']}, "
                f"fathers_name_matched={verification['fathers_name_matched']})"
            ),
        )
    
    # Read image file
    image_data = await face_image.read()

    # ── 2. Face-match: live photo MUST match the face on the ID document ────────
    face_match = face_service.compare_id_face_with_live(proof_data, image_data)
    print(f"Face match result: {face_match}")

    if not face_match["match"]:
        if not face_match.get("id_face_found", True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Face verification failed: could not detect a face in the voter ID "
                    "document photo. Please upload a clearer, well-lit, flat image of your "
                    "Voter ID card where the face photo is clearly visible."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Face verification failed: your live photo does not match the face on "
                f"your Voter ID document (similarity={face_match['confidence']}%). "
                "Please retake your live photo in good lighting, facing the camera directly."
            ),
        )

    # Extract face encoding
    face_encoding = face_service.extract_face_encoding(image_data)
    
    if face_encoding is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected in the image. Please upload a clear face photo."
        )
    
    # Check if face already registered (prevent duplicate registrations)
    # Uses strict tolerance (0.45) to avoid false positives between different people
    all_voters = db.query(Voter).all()
    for voter in all_voters:
        if voter.face_encoding:
            if face_service.is_duplicate_face(face_encoding, voter.face_encoding):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"This face is already registered. If you're {voter.name}, please login instead of registering again."
                )
    
    # Save face image
    image_filename = f"{voter_id}_{face_image.filename}"
    image_path = f"uploads/voters/{image_filename}"
    
    with open(image_path, "wb") as buffer:
        buffer.write(image_data)
    
    # Create voter
    new_voter = Voter(
        voter_id=voter_id,
        name=name,
        fathers_name=fathers_name,
        phone=phone,
        face_encoding=json.dumps(face_encoding),
        face_image_path=image_path,
        is_verified=True
    )
    
    db.add(new_voter)
    db.commit()
    db.refresh(new_voter)
    
    return new_voter

@router.post("/verify-face")
async def verify_face(
    voter_id: str = Form(...),
    liveness_token: str = Form(...),
    live_image: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Verify voter's face for voting"""
    
    # Get voter from database
    voter = db.query(Voter).filter(Voter.voter_id == voter_id).first()
    
    if not voter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voter not found"
        )

    ok, msg, _ = liveness_service.verify_liveness_token(
        token=liveness_token,
        voter_id=voter_id,
        purpose="vote-verify",
        consume=True,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Liveness verification required: {msg}"
        )
    
    # Check if voter has already voted in the current active election
    active_election = db.query(Election).filter(Election.is_active == True).first()
    if active_election:
        now = datetime.now()
        if active_election.start_date <= now <= active_election.end_date:
            existing_vote = db.query(Vote).filter(
                Vote.voter_id == voter.id,
                Vote.election_id == active_election.id
            ).first()
            if existing_vote:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="You have already voted in this election"
                )
    
    # Read live image
    live_image_data = await live_image.read()
    
    # Extract face encoding from live image
    live_encoding = face_service.extract_face_encoding(live_image_data)
    
    if live_encoding is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected in the live image"
        )
    
    # Verify face
    is_match = face_service.verify_face(live_encoding, voter.face_encoding)
    
    if not is_match:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Face verification failed. Please try again."
        )

    # Allow vote-casting only for voters with a recent, successful liveness-backed verify-face.
    liveness_service.mark_recent_session(voter_id=voter.voter_id, purpose="vote-cast", ttl_seconds=300)
    
    # Generate access token for voting
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": voter.voter_id, "voter_id": voter.id},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "voter": {
            "id": voter.id,
            "name": voter.name,
            "voter_id": voter.voter_id
        }
    }

@router.post("/update-face")
async def update_voter_face(
    voter_id: str = Form(...),
    liveness_token: str = Form(...),
    face_image: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Update a voter's stored face photo.
    The submitted face image must match the face already stored in the database.
    If it matches, that same image replaces the existing one.
    """

    # Retrieve voter
    voter = db.query(Voter).filter(Voter.voter_id == voter_id).first()
    if not voter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voter not found"
        )

    if not voter.face_encoding:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face data on record for this voter"
        )

    ok, msg, _ = liveness_service.verify_liveness_token(
        token=liveness_token,
        voter_id=voter_id,
        purpose="update-face",
        consume=True,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Liveness verification required: {msg}"
        )

    # --- Step 1: extract encoding from submitted image ---
    image_data = await face_image.read()
    encoding = face_service.extract_face_encoding(image_data)

    if encoding is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected in the image. Please use a clear, well-lit photo."
        )

    # --- Step 2: verify it matches the stored face ---
    if not face_service.verify_face(encoding, voter.face_encoding):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Face does not match the face on record. Update denied."
        )

    # --- Step 3: delete old image file and save the new capture ---
    if voter.face_image_path and os.path.exists(voter.face_image_path):
        try:
            os.remove(voter.face_image_path)
        except OSError:
            pass  # Non-critical; continue

    new_filename = f"{voter_id}_updated_{face_image.filename}"
    new_image_path = f"uploads/voters/{new_filename}"
    with open(new_image_path, "wb") as buffer:
        buffer.write(image_data)

    # --- Step 4: persist updated encoding + path ---
    voter.face_encoding = json.dumps(encoding)
    voter.face_image_path = new_image_path
    db.commit()
    db.refresh(voter)

    return {
        "message": "Face updated successfully.",
        "voter_id": voter.voter_id,
        "name": voter.name
    }


@router.post("/admin/login", response_model=Token)
async def admin_login(credentials: AdminLogin, db: Session = Depends(get_db)):
    """Admin login"""
    
    admin = db.query(Admin).filter(Admin.username == credentials.username).first()
    
    if not admin or not verify_password(credentials.password, admin.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": admin.username, "role": "admin"},
        expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/admin/create")
async def create_admin(
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    """Create admin account (only for initial setup)"""
    
    # Check if admin already exists
    existing_admin = db.query(Admin).filter(Admin.username == username).first()
    
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin already exists"
        )
    
    hashed_password = get_password_hash(password)
    
    new_admin = Admin(
        username=username,
        hashed_password=hashed_password
    )
    
    db.add(new_admin)
    db.commit()
    
    return {"message": "Admin created successfully"}

@router.post("/admin/signup")
async def admin_signup(admin_data: AdminCreate, db: Session = Depends(get_db)):
    """Sign up a new admin account with security question for password recovery"""
    
    # Check if username already exists
    existing_admin = db.query(Admin).filter(Admin.username == admin_data.username).first()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Check if email already exists
    existing_email = db.query(Admin).filter(Admin.email == admin_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    hashed_password = get_password_hash(admin_data.password)
    hashed_answer = get_password_hash(admin_data.security_answer.lower().strip())
    
    new_admin = Admin(
        username=admin_data.username,
        email=admin_data.email,
        hashed_password=hashed_password,
        security_question=admin_data.security_question,
        security_answer=hashed_answer
    )
    
    db.add(new_admin)
    db.commit()
    
    return {"message": "Admin account created successfully. You can now log in."}

@router.post("/admin/forgot-password")
async def admin_forgot_password(reset_data: AdminResetPassword, db: Session = Depends(get_db)):
    """Reset admin password using security question verification"""
    
    admin = db.query(Admin).filter(Admin.username == reset_data.username).first()
    
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No admin account found with that username"
        )
    
    if not admin.email or admin.email != reset_data.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email does not match the account"
        )
    
    if not admin.security_answer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No security question set for this account. Contact system administrator."
        )
    
    if not verify_password(reset_data.security_answer.lower().strip(), admin.security_answer):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security answer is incorrect"
        )
    
    admin.hashed_password = get_password_hash(reset_data.new_password)
    db.commit()
    
    return {"message": "Password reset successfully. You can now log in with your new password."}

@router.get("/admin/security-question")
async def get_security_question(username: str, db: Session = Depends(get_db)):
    """Get the security question for an admin account"""
    
    admin = db.query(Admin).filter(Admin.username == username).first()
    
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No admin account found with that username"
        )
    
    if not admin.security_question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No security question set for this account"
        )
    
    return {"security_question": admin.security_question}
