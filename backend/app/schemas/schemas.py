from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class VoterCreate(BaseModel):
    name: str
    fathers_name: str
    phone: str
    voter_id: str

class VoterResponse(BaseModel):
    id: int
    voter_id: str
    name: str
    fathers_name: str
    phone: str
    is_verified: bool
    has_voted: bool
    registered_at: datetime
    
    class Config:
        from_attributes = True

class CandidateCreate(BaseModel):
    name: str
    party: str
    symbol: str
    description: str

class CandidateResponse(BaseModel):
    id: int
    name: str
    party: str
    symbol: str
    description: str
    image_path: Optional[str] = None
    
    class Config:
        from_attributes = True

class VoteCreate(BaseModel):
    candidate_id: int

class VoteResponse(BaseModel):
    id: int
    candidate_id: int
    voted_at: datetime
    
    class Config:
        from_attributes = True

class AdminLogin(BaseModel):
    username: str
    password: str

class AdminCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    security_question: str
    security_answer: str

class AdminResetPassword(BaseModel):
    username: str
    email: str
    security_answer: str
    new_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class FaceVerification(BaseModel):
    voter_id: str

class ElectionCreate(BaseModel):
    title: str
    description: str
    start_date: datetime
    end_date: datetime

class ElectionResponse(BaseModel):
    id: int
    title: str
    description: str
    start_date: datetime
    end_date: datetime
    is_active: bool
    
    class Config:
        from_attributes = True

class VotingResults(BaseModel):
    candidate_name: str
    party: str
    vote_count: int
    percentage: float

class SetLotWinner(BaseModel):
    winner_name: str
