from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base

class Voter(Base):
    __tablename__ = "voters"
    
    id = Column(Integer, primary_key=True, index=True)
    voter_id = Column(String, unique=True, index=True)
    name = Column(String)
    fathers_name = Column(String)
    phone = Column(String)
    face_encoding = Column(Text)  # Store face encoding as JSON string
    face_image_path = Column(String)
    is_verified = Column(Boolean, default=False)
    has_voted = Column(Boolean, default=False)
    registered_at = Column(DateTime, default=datetime.utcnow)
    
    votes = relationship("Vote", back_populates="voter")

class Candidate(Base):
    __tablename__ = "candidates"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    party = Column(String)
    symbol = Column(String)
    description = Column(Text)
    image_path = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    votes = relationship("Vote", back_populates="candidate")

class Vote(Base):
    __tablename__ = "votes"
    
    id = Column(Integer, primary_key=True, index=True)
    voter_id = Column(Integer, ForeignKey("voters.id"))
    candidate_id = Column(Integer, ForeignKey("candidates.id"))
    election_id = Column(Integer, ForeignKey("elections.id"), nullable=True)
    voted_at = Column(DateTime, default=datetime.utcnow)
    
    voter = relationship("Voter", back_populates="votes")
    candidate = relationship("Candidate", back_populates="votes")
    election = relationship("Election")

class Admin(Base):
    __tablename__ = "admins"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    security_question = Column(String)
    security_answer = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class Election(Base):
    __tablename__ = "elections"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(Text)
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    is_active = Column(Boolean, default=False)
    lot_winner_name = Column(String, nullable=True)  # winner name after drawing lots in a tie
    created_at = Column(DateTime, default=datetime.utcnow)
