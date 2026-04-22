import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import { API_ORIGIN, verifyFace, getCandidates, castVote, getVoterStatus, verifyLivenessProof } from '../services/api';
import useBlinkLiveness from '../utils/useBlinkLiveness';

function VotingPage() {
  const navigate = useNavigate();
  const webcamRef = useRef(null);
  
  const [step, setStep] = useState(1);
  const [voterId, setVoterId] = useState('');
  const [capturedImage, setCapturedImage] = useState(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [voterInfo, setVoterInfo] = useState(null);
  const liveness = useBlinkLiveness(webcamRef, showWebcam);

  useEffect(() => {
    if (step === 2) fetchCandidates();
  }, [step]);

  const fetchCandidates = async () => {
    try { setCandidates(await getCandidates()); }
    catch { setError('Failed to load candidates'); }
  };

  const capturePhoto = () => {
    if (!liveness.livenessPassed) {
      setError('Please look at the camera and blink once before capturing your verification photo.');
      return;
    }
    const imageSrc = webcamRef.current.getScreenshot();
    setCapturedImage(imageSrc);
    setShowWebcam(false);
    setError('');
  };

  const handleFaceVerification = async (e) => {
    e.preventDefault(); setError('');
    if (!capturedImage) { setError('Please capture your face photo'); return; }
    setLoading(true);
    try {
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      const livenessProof = await verifyLivenessProof({
        voterId,
        purpose: 'vote-verify',
        blinkCount: Math.max(1, liveness.blinkCount),
        imageBlob: blob,
      });
      const formData = new FormData();
      formData.append('voter_id', voterId);
      formData.append('liveness_token', livenessProof.liveness_token);
      formData.append('live_image', blob, 'face.jpg');
      const result = await verifyFace(formData);
      localStorage.setItem('token', result.access_token);
      setVoterInfo(result.voter);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.detail || 'Face verification failed. Please try again.');
    } finally { setLoading(false); }
  };

  const handleVote = async () => {
    if (!selectedCandidate) { setError('Please select a candidate'); return; }
    const confirmed = window.confirm(
      `Are you sure you want to vote for ${candidates.find(c => c.id === selectedCandidate)?.name}? This action cannot be undone.`
    );
    if (!confirmed) return;
    setLoading(true); setError('');
    try {
      await castVote(selectedCandidate);
      navigate('/thank-you');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cast vote. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="site-header">
        <div className="site-header-inner">
          <div className="site-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <div className="site-logo-icon">🗳️</div>
            <div><h1>VoteSecure</h1><p>Online Voting System</p></div>
          </div>
          <button className="btn btn-outline" onClick={() => navigate('/')}>← Back to Home</button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          {/* Step Indicator */}
          <div className="step-indicator" style={{ marginBottom: 28, marginTop: 8 }}>
            <div className="step-item">
              <div className={`step-circle ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>1</div>
              <span className="step-label">Verify Identity</span>
            </div>
            <div className="step-line" style={{ background: step >= 2 ? '#1a56db' : '#d1d5db' }} />
            <div className="step-item">
              <div className={`step-circle ${step >= 2 ? 'active' : ''}`}>2</div>
              <span className="step-label">Cast Vote</span>
            </div>
          </div>

          {step === 1 ? (
            /* ── STEP 1: Face Verification ── */
            <div className="card" style={{ maxWidth: 560, margin: '0 auto', padding: '32px 28px' }}>
              <h2 className="page-title" style={{ marginBottom: 4 }}>Identity Verification</h2>
              <p className="page-subtitle" style={{ marginBottom: 24 }}>Enter your Voter ID and verify your identity with a live photo.</p>

              {error && <div className="error-message">{error}</div>}

              <form onSubmit={handleFaceVerification}>
                <div className="form-group">
                  <label>Voter ID <span style={{ color: '#dc2626' }}>*</span></label>
                  <input type="text" value={voterId} onChange={(e) => setVoterId(e.target.value)}
                    required placeholder="Enter your voter ID number" />
                </div>

                <div className="form-group">
                  <label>Live Face Verification <span style={{ color: '#dc2626' }}>*</span></label>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, marginTop: -4 }}>
                    Take a clear, front-facing photo for identity matching.
                  </p>

                  {!capturedImage && !showWebcam && (
                    <button type="button" className="btn btn-primary" onClick={() => setShowWebcam(true)}
                      style={{ width: '100%', padding: 14 }}>
                      📷 Open Camera for Verification
                    </button>
                  )}

                  {showWebcam && (
                    <div style={{
                      background: '#f9fafb', borderRadius: 8, padding: 16,
                      border: '1px solid #e5e7eb', textAlign: 'center',
                    }}>
                      <div style={{
                        marginBottom: 12,
                        borderRadius: 8,
                        padding: '10px 12px',
                        background: liveness.livenessPassed ? '#ecfdf5' : '#eff6ff',
                        border: `1px solid ${liveness.livenessPassed ? '#86efac' : '#bfdbfe'}`,
                        color: liveness.livenessPassed ? '#065f46' : '#1e40af',
                        fontSize: 13,
                        textAlign: 'left',
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Liveness Check (Required)</div>
                        <div>{liveness.statusMessage}</div>
                        <div style={{ marginTop: 6 }}>
                          Blink count: <strong>{liveness.blinkCount}</strong> | Face detected: <strong>{liveness.isFaceDetected ? 'Yes' : 'No'}</strong> | Looking at camera: <strong>{liveness.isLookingAtCamera ? 'Yes' : 'No'}</strong>
                        </div>
                      </div>
                      <div style={{ borderRadius: 8, overflow: 'hidden', display: 'inline-block', border: '2px solid #d1d5db' }}>
                        <Webcam ref={webcamRef} screenshotFormat="image/jpeg" width={340} height={255}
                          videoConstraints={{ width: 1280, height: 720, facingMode: "user" }} />
                      </div>
                      <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-success"
                          onClick={capturePhoto}
                          disabled={!liveness.livenessPassed}
                          title={!liveness.livenessPassed ? 'Blink once while looking at camera to enable capture' : ''}
                          style={{ opacity: liveness.livenessPassed ? 1 : 0.55 }}
                        >
                          📸 Capture
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowWebcam(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {capturedImage && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        display: 'inline-block', borderRadius: 8, overflow: 'hidden',
                        border: '2px solid #059669', marginBottom: 12,
                      }}>
                        <img src={capturedImage} alt="Captured" style={{ maxWidth: 260, display: 'block' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                        ✓ Photo captured
                      </div>
                      <button type="button" className="btn btn-secondary"
                        onClick={() => { setCapturedImage(null); setShowWebcam(true); }}
                        style={{ fontSize: 13 }}>
                        Retake Photo
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, padding: 14 }}>
                    {loading ? 'Verifying...' : 'Verify & Continue →'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => navigate('/')} disabled={loading}
                    style={{ padding: '14px 24px' }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* ── STEP 2: Cast Vote ── */
            <div style={{ maxWidth: 900, margin: '0 auto' }}>
              <h2 className="page-title" style={{ marginBottom: 4 }}>Cast Your Vote</h2>
              <p className="page-subtitle" style={{ marginBottom: 24 }}>
                Welcome, <strong>{voterInfo?.name}</strong>. Select your preferred candidate and submit your vote.
              </p>

              {error && <div className="error-message">{error}</div>}

              <div className="alert-info" style={{ marginBottom: 20 }}>
                <strong>Important:</strong> You can only vote once. Please review your selection carefully before submitting.
              </div>

              <div className="candidate-grid">
                {candidates.map((candidate) => (
                  <div key={candidate.id}
                    className={`candidate-card ${selectedCandidate === candidate.id ? 'selected' : ''}`}
                    onClick={() => setSelectedCandidate(candidate.id)}>
                    {candidate.image_path && (
                      <img src={`${API_ORIGIN}/${candidate.image_path}`}
                        alt={candidate.name} className="candidate-image" />
                    )}
                    <h3 style={{ marginBottom: 6, fontSize: 17, fontWeight: 700, color: '#111827' }}>{candidate.name}</h3>
                    <p style={{ color: '#1a56db', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>{candidate.party}</p>
                    <p style={{ fontSize: 26, marginBottom: 8 }}>{candidate.symbol}</p>
                    <p style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.5 }}>{candidate.description}</p>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 32, textAlign: 'center' }}>
                <button className="btn btn-success btn-lg" onClick={handleVote}
                  disabled={loading || !selectedCandidate}
                  style={{ padding: '14px 48px', fontSize: 16, opacity: !selectedCandidate ? 0.5 : 1 }}>
                  {loading ? 'Submitting...' : '✓ Submit Vote'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="site-footer">
        VoteSecure © {new Date().getFullYear()} — Smart Digital Voting Platform Using Facial Recognition
      </div>
    </div>
  );
}

export default VotingPage;
