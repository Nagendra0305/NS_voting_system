from fastapi import APIRouter, Depends, HTTPException, status, Header, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.models import Voter, Candidate, Vote, Election, Admin
from app.schemas.schemas import (
    CandidateCreate, CandidateResponse, VoterResponse, 
    ElectionCreate, ElectionResponse, VotingResults, SetLotWinner
)
from app.services.auth_service import decode_token
from typing import List, Optional
from datetime import datetime
import os

router = APIRouter()

def get_current_admin(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """Verify admin authentication"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    
    if payload is None or payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authorized"
        )
    
    return payload

@router.post("/candidates", response_model=CandidateResponse)
async def create_candidate(
    name: str = Form(...),
    party: str = Form(...),
    symbol: str = Form(...),
    description: str = Form(...),
    image: Optional[UploadFile] = File(None),
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Create a new candidate"""
    
    image_path = None
    
    if image:
        # Save candidate image
        image_filename = f"candidate_{name.replace(' ', '_')}_{image.filename}"
        image_path = f"uploads/voters/{image_filename}"
        
        with open(image_path, "wb") as buffer:
            content = await image.read()
            buffer.write(content)
    
    new_candidate = Candidate(
        name=name,
        party=party,
        symbol=symbol,
        description=description,
        image_path=image_path
    )
    
    db.add(new_candidate)
    db.commit()
    db.refresh(new_candidate)
    
    return new_candidate

@router.get("/candidates", response_model=List[CandidateResponse])
async def get_all_candidates(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get all candidates"""
    candidates = db.query(Candidate).all()
    return candidates

@router.delete("/candidates/{candidate_id}")
async def delete_candidate(
    candidate_id: int,
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Delete a candidate"""
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found"
        )
    
    db.delete(candidate)
    db.commit()
    
    return {"message": "Candidate deleted successfully"}

@router.get("/voters")
async def get_all_voters(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get all registered voters with per-election voting status"""
    voters = db.query(Voter).all()
    active_election = db.query(Election).filter(Election.is_active == True).first()

    result = []
    for voter in voters:
        has_voted = False
        if active_election:
            has_voted = db.query(Vote).filter(
                Vote.voter_id == voter.id,
                Vote.election_id == active_election.id
            ).first() is not None
        result.append({
            "id": voter.id,
            "voter_id": voter.voter_id,
            "name": voter.name,
            "fathers_name": voter.fathers_name,
            "phone": voter.phone,
            "is_verified": voter.is_verified,
            "has_voted": has_voted,
            "registered_at": voter.registered_at,
        })
    return result

@router.post("/elections", response_model=ElectionResponse)
async def create_election(
    election_data: ElectionCreate,
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Create a new election"""
    
    # Deactivate all other elections
    db.query(Election).update({"is_active": False})
    
    new_election = Election(
        title=election_data.title,
        description=election_data.description,
        start_date=election_data.start_date,
        end_date=election_data.end_date,
        is_active=True
    )
    
    db.add(new_election)
    db.commit()
    db.refresh(new_election)
    
    return new_election

@router.get("/elections", response_model=List[ElectionResponse])
async def get_all_elections(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get all elections"""
    elections = db.query(Election).all()
    return elections

@router.put("/elections/{election_id}/toggle")
async def toggle_election(
    election_id: int,
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Toggle election active status"""
    election = db.query(Election).filter(Election.id == election_id).first()
    
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )
    
    if not election.is_active:
        # Deactivate all other elections
        db.query(Election).update({"is_active": False})
        election.is_active = True
    else:
        election.is_active = False
    
    db.commit()
    
    return {"message": "Election status updated", "is_active": election.is_active}

@router.delete("/elections/{election_id}")
async def delete_election(
    election_id: int,
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Delete an election and all votes recorded for it"""
    election = db.query(Election).filter(Election.id == election_id).first()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    if election.is_active and election.end_date and election.end_date > datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an active ongoing election"
        )

    db.query(Vote).filter(Vote.election_id == election_id).delete()
    db.delete(election)
    db.commit()

    return {"message": "Election history deleted successfully"}

@router.post("/elections/{election_id}/set-lot-winner")
async def set_lot_winner(
    election_id: int,
    data: SetLotWinner,
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Persist the lot-draw winner for a tied election"""
    election = db.query(Election).filter(Election.id == election_id).first()
    if not election:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Election not found")
    election.lot_winner_name = data.winner_name
    db.commit()
    return {"message": "Lot winner saved", "winner_name": data.winner_name}

@router.get("/results")
async def get_voting_results(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get voting results"""
    
    # Get the active election
    active_election = db.query(Election).filter(Election.is_active == True).first()
    election_id = active_election.id if active_election else None

    # Get total votes for the active election only
    total_votes_query = db.query(func.count(Vote.id))
    if election_id is not None:
        total_votes_query = total_votes_query.filter(Vote.election_id == election_id)
    total_votes = total_votes_query.scalar()
    
    # Get votes per candidate for the active election only
    votes_subquery = db.query(Vote.candidate_id, func.count(Vote.id).label('vote_count'))
    if election_id is not None:
        votes_subquery = votes_subquery.filter(Vote.election_id == election_id)
    votes_subquery = votes_subquery.group_by(Vote.candidate_id).subquery()

    results = db.query(
        Candidate.name,
        Candidate.party,
        func.coalesce(votes_subquery.c.vote_count, 0).label('vote_count')
    ).outerjoin(votes_subquery, Candidate.id == votes_subquery.c.candidate_id).all()
    
    results_data = []
    
    for result in results:
        percentage = (result.vote_count / total_votes * 100) if total_votes > 0 else 0
        results_data.append({
            "candidate_name": result.name,
            "party": result.party,
            "vote_count": result.vote_count,
            "percentage": round(percentage, 2)
        })
    
    # Sort by vote count
    results_data.sort(key=lambda x: x['vote_count'], reverse=True)
    
    return {
        "election_id": election_id,
        "total_votes": total_votes,
        "results": results_data,
        "lot_winner_name": active_election.lot_winner_name if active_election else None,
    }

@router.get("/statistics")
async def get_statistics(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get system statistics"""
    
    total_voters = db.query(func.count(Voter.id)).scalar()
    # Count distinct voters who have cast a vote in the current active election
    active_election = db.query(Election).filter(Election.is_active == True).first()
    if active_election:
        voted_count = db.query(func.count(func.distinct(Vote.voter_id))).filter(
            Vote.election_id == active_election.id
        ).scalar()
    else:
        voted_count = 0
    total_candidates = db.query(func.count(Candidate.id)).scalar()
    
    return {
        "total_voters": total_voters,
        "voted_count": voted_count,
        "pending_votes": total_voters - voted_count,
        "total_candidates": total_candidates,
        "turnout_percentage": round((voted_count / total_voters * 100) if total_voters > 0 else 0, 2)
    }

@router.post("/reset-votes")
async def reset_all_votes(
    current_admin = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Reset all votes (use with caution)"""
    
    # Delete all votes
    db.query(Vote).delete()
    
    db.commit()
    
    return {"message": "All votes have been reset"}
