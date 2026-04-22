import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import { updateVoterFace, verifyLivenessProof } from '../services/api';
import useBlinkLiveness from '../utils/useBlinkLiveness';

function UpdateFacePage() {
  const navigate = useNavigate();
  const webcamRef = useRef(null);

  const [voterId, setVoterId] = useState('');
  const [capturedImage, setCapturedImage] = useState(null);
  const [showCam, setShowCam] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [faceError, setFaceError] = useState(false);
  const [success, setSuccess] = useState('');
  const liveness = useBlinkLiveness(webcamRef, showCam);

  const capturePhoto = () => {
    if (!liveness.livenessPassed) {
      setError('Please look at the camera and blink once before capturing your photo.');
      return;
    }
    const img = webcamRef.current.getScreenshot();
    setCapturedImage(img);
    setShowCam(false);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!voterId.trim()) { setError('Please enter your Voter ID.'); return; }
    if (!capturedImage) { setError('Please capture your face photo.'); return; }

    setLoading(true);
    try {
      const blob = await fetch(capturedImage).then((r) => r.blob());
      const livenessProof = await verifyLivenessProof({
        voterId: voterId.trim(),
        purpose: 'update-face',
        blinkCount: Math.max(1, liveness.blinkCount),
        imageBlob: blob,
      });
      const formData = new FormData();
      formData.append('voter_id', voterId.trim());
      formData.append('liveness_token', livenessProof.liveness_token);
      formData.append('face_image', blob, 'face.jpg');

      const data = await updateVoterFace(formData);
      setSuccess(`Face updated successfully for ${data.name}. You can now use this face to verify when voting.`);
      setFaceError(false);
      setVoterId('');
      setCapturedImage(null);
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || '';
      if (status === 401 || detail.toLowerCase().includes('does not match') || detail.toLowerCase().includes('face')) {
        setFaceError(true);
        setError('');
      } else {
        setFaceError(false);
        setError(detail || 'Failed to update face. Please try again.');
      }
    } finally {
      setLoading(false);
    }
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

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div className="container" style={{ maxWidth: 580 }}>
          <div style={{ marginBottom: 24, marginTop: 8 }}>
            <h2 className="page-title">Update Face Photo</h2>
            <p className="page-subtitle">
              Enter your Voter ID and capture your face. If it matches the face stored in our
              system, your face data will be refreshed with this new capture.
            </p>
          </div>

          <div className="card" style={{ padding: '32px 28px' }}>
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <form onSubmit={handleSubmit}>
              {/* Voter ID */}
              <div className="form-group">
                <label>Voter ID <span style={{ color: '#dc2626' }}>*</span></label>
                <input
                  type="text"
                  value={voterId}
                  onChange={(e) => setVoterId(e.target.value)}
                  placeholder="Enter your Voter ID number"
                  required
                />
              </div>

              {/* Info banner */}
              <div style={{
                margin: '20px 0 16px', padding: '10px 14px', background: '#eff6ff',
                borderRadius: 6, border: '1px solid #bfdbfe', fontSize: 13, color: '#1e40af',
              }}>
                <strong>How it works:</strong> Capture your face below. The system verifies it
                matches your registered photo and then updates the stored image with this capture.
              </div>

              {/* Single camera field */}
              <div className="form-group">
                <label>Face Photo <span style={{ color: '#dc2626' }}>*</span></label>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, marginTop: -4 }}>
                  Look straight into the camera in good lighting for best results.
                </p>

                {!capturedImage && !showCam && (
                  <button type="button" className="btn btn-primary"
                    onClick={() => setShowCam(true)} style={{ width: '100%', padding: 14 }}>
                    📷 Open Camera
                  </button>
                )}

                {showCam && (
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
                        videoConstraints={{ width: 1280, height: 720, facingMode: 'user' }} />
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
                      <button type="button" className="btn btn-secondary" onClick={() => setShowCam(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                {capturedImage && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      display: 'inline-block', borderRadius: 8, overflow: 'hidden',
                      border: '2px solid #059669', marginBottom: 12,
                    }}>
                      <img src={capturedImage} alt="Captured face" style={{ maxWidth: 260, display: 'block' }} />
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 8, color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 8,
                    }}>
                      ✓ Photo captured successfully
                    </div>
                    {faceError && (
                      <div style={{
                        margin: '0 auto 14px', maxWidth: 300,
                        padding: '12px 16px', background: '#fef2f2',
                        borderRadius: 8, border: '2px solid #fca5a5',
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                      }}>
                        <span style={{ fontSize: 22, lineHeight: 1 }}>❌</span>
                        <div>
                          <div style={{ fontWeight: 700, color: '#b91c1c', fontSize: 14, marginBottom: 3 }}>
                            Face Not Matched
                          </div>
                          <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.5 }}>
                            The captured face does not match the face registered for this Voter ID.
                            Please retake and ensure you are the registered voter.
                          </div>
                        </div>
                      </div>
                    )}
                    <button type="button" className="btn btn-secondary"
                      onClick={() => { setCapturedImage(null); setFaceError(false); setShowCam(true); }}
                      style={{ fontSize: 13 }}>
                      Retake Photo
                    </button>
                  </div>
                )}
              </div>

              {/* Warning */}
              <div style={{
                marginTop: 16, padding: '10px 14px', background: '#fffbeb',
                borderRadius: 6, border: '1px solid #fcd34d', fontSize: 12, color: '#92400e',
              }}>
                ⚠️ <strong>Note:</strong> Your face must match the one already registered in our
                system. If verification fails, the update will be rejected.
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
                <button type="submit" className="btn btn-primary" disabled={loading}
                  style={{ flex: 1, padding: 14 }}>
                  {loading ? 'Updating...' : '🔄 Update Face Photo'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}
                  disabled={loading} style={{ padding: '14px 24px' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="site-footer">
        VoteSecure © {new Date().getFullYear()} — Smart Digital Voting Platform Using Facial Recognition
      </div>
    </div>
  );
}

export default UpdateFacePage;
