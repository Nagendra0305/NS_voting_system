from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.models import Voter, Candidate, Vote, Election
from app.schemas.schemas import CandidateResponse, VoteCreate, VoteResponse
from app.services.auth_service import decode_token
from app.services.liveness_service import get_liveness_service
from app.core.config import settings
from typing import List, Optional
from datetime import datetime

router = APIRouter()
liveness_service = get_liveness_service(settings.SECRET_KEY)

def get_current_voter(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """Get current authenticated voter"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    
    voter_id = payload.get("voter_id")
    voter = db.query(Voter).filter(Voter.id == voter_id).first()
    
    if not voter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voter not found"
        )
    
    return voter

@router.get("/candidates", response_model=List[CandidateResponse])
async def get_candidates(db: Session = Depends(get_db)):
    """Get all candidates"""
    candidates = db.query(Candidate).all()
    return candidates

@router.get("/election-status")
async def get_election_status(db: Session = Depends(get_db)):
    """Check if election is active"""
    election = db.query(Election).filter(Election.is_active == True).first()
    
    if not election:
        return {"is_active": False, "message": "No active election"}
    
    now = datetime.now()
    
    if now < election.start_date:
        return {
            "is_active": False,
            "message": "Election has not started yet",
            "election": {
                "title": election.title,
                "start_date": election.start_date,
                "end_date": election.end_date
            }
        }
    
    if now > election.end_date:
        return {
            "is_active": False,
            "has_ended": True,
            "message": "Election has ended",
            "election": {
                "id": election.id,
                "title": election.title,
                "start_date": election.start_date,
                "end_date": election.end_date
            }
        }
    
    return {
        "is_active": True,
        "message": "Election is active",
        "election": {
            "id": election.id,
            "title": election.title,
            "description": election.description,
            "start_date": election.start_date,
            "end_date": election.end_date
        }
    }

@router.post("/vote", response_model=VoteResponse)
async def cast_vote(
    vote_data: VoteCreate,
    current_voter: Voter = Depends(get_current_voter),
    db: Session = Depends(get_db)
):
    """Cast a vote"""

    if not liveness_service.has_recent_session(current_voter.voter_id, "vote-cast"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Recent blink liveness verification required before casting vote"
        )
    
    # Check if election is active
    election = db.query(Election).filter(Election.is_active == True).first()
    
    if not election:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active election"
        )
    
    now = datetime.now()
    
    if now < election.start_date or now > election.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election is not currently active"
        )
    
    # Check if voter has already voted IN THIS ELECTION
    existing_vote = db.query(Vote).filter(
        Vote.voter_id == current_voter.id,
        Vote.election_id == election.id
    ).first()

    if existing_vote:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already voted in this election"
        )
    
    # Check if candidate exists
    candidate = db.query(Candidate).filter(Candidate.id == vote_data.candidate_id).first()
    
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found"
        )
    
    # Create vote linked to this election
    new_vote = Vote(
        voter_id=current_voter.id,
        candidate_id=vote_data.candidate_id,
        election_id=election.id
    )
    
    db.add(new_vote)
    db.commit()
    db.refresh(new_vote)

    # One vote per election already applies; consume session after successful cast.
    liveness_service.consume_recent_session(current_voter.voter_id, "vote-cast")
    
    return new_vote

@router.get("/public-results")
async def get_public_results(db: Session = Depends(get_db)):
    """Public endpoint: results for the most recently ended active election"""
    now = datetime.now()
    election = db.query(Election).filter(Election.is_active == True).first()

    if not election:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No election found")

    if now <= election.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Election is still ongoing")

    total_votes = db.query(func.count(Vote.id)).filter(Vote.election_id == election.id).scalar()

    votes_subquery = (
        db.query(Vote.candidate_id, func.count(Vote.id).label('vote_count'))
        .filter(Vote.election_id == election.id)
        .group_by(Vote.candidate_id)
        .subquery()
    )

    rows = db.query(
        Candidate.name,
        Candidate.party,
        func.coalesce(votes_subquery.c.vote_count, 0).label('vote_count')
    ).outerjoin(votes_subquery, Candidate.id == votes_subquery.c.candidate_id).all()

    results_data = []
    for r in rows:
        pct = (r.vote_count / total_votes * 100) if total_votes > 0 else 0
        results_data.append({
            "candidate_name": r.name,
            "party": r.party,
            "vote_count": r.vote_count,
            "percentage": round(pct, 2)
        })
    results_data.sort(key=lambda x: x['vote_count'], reverse=True)

    return {
        "election_title": election.title,
        "total_votes": total_votes,
        "results": results_data,
        "lot_winner_name": election.lot_winner_name,
    }

@router.get("/my-status")
async def get_my_status(
    current_voter: Voter = Depends(get_current_voter),
    db: Session = Depends(get_db)
):
    """Get current voter's voting status for the active election"""
    active_election = db.query(Election).filter(Election.is_active == True).first()
    has_voted_in_current = False
    if active_election:
        existing_vote = db.query(Vote).filter(
            Vote.voter_id == current_voter.id,
            Vote.election_id == active_election.id
        ).first()
        has_voted_in_current = existing_vote is not None
    return {
        "name": current_voter.name,
        "voter_id": current_voter.voter_id,
        "has_voted": has_voted_in_current,
        "is_verified": current_voter.is_verified
    }
