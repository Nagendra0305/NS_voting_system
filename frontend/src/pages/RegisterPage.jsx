import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import { registerVoter, verifyDetails, checkFaceMatch, verifyLivenessProof, validateVoterCard } from '../services/api';
import useBlinkLiveness from '../utils/useBlinkLiveness';

const REQUIRED_CARD_WIDTH = 1136;
const REQUIRED_CARD_HEIGHT = 768;

const normalizeVoterCardImage = async (file) => {
  const supportedMimeTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/jfif',
  ]);
  if (!supportedMimeTypes.has((file.type || '').toLowerCase())) {
    throw new Error('Only voter card image files (JPG, PNG, WEBP, AVIF, HEIC) are allowed.');
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read image file.'));
      image.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = REQUIRED_CARD_WIDTH;
    canvas.height = REQUIRED_CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, REQUIRED_CARD_WIDTH, REQUIRED_CARD_HEIGHT);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
    if (!blob) {
      throw new Error('Could not process image file.');
    }

    const baseName = (file.name || 'voter-card').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}-1136x768.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

function RegisterPage() {
  const navigate = useNavigate();
  const webcamRef = useRef(null);
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState({ name: '', fathers_name: '', phone: '', voter_id: '' });
  const [voterIdProof, setVoterIdProof] = useState(null);
  const [voterIdProofPreview, setVoterIdProofPreview] = useState(null);

  // Step 1 — details verification
  const [detailsVerifying, setDetailsVerifying] = useState(false);
  const [detailsResult, setDetailsResult] = useState(null); // null | { success, name_matched, voter_id_matched, fathers_name_matched, message }

  // Step 2 — face match
  const [capturedImage, setCapturedImage] = useState(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [faceMatchChecking, setFaceMatchChecking] = useState(false);
  const [faceMatchResult, setFaceMatchResult] = useState(null); // null | { match, confidence, message }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const liveness = useBlinkLiveness(webcamRef, showWebcam);

  // Reset downstream state whenever inputs change
  const resetVerification = () => {
    setDetailsResult(null);
    setFaceMatchResult(null);
    setCapturedImage(null);
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    resetVerification();
  };

  const handleProofFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');

    try {
      const normalizedFile = await normalizeVoterCardImage(file);
      await validateVoterCard(normalizedFile);
      setVoterIdProof(normalizedFile);
      const reader = new FileReader();
      reader.onloadend = () => setVoterIdProofPreview(reader.result);
      reader.readAsDataURL(normalizedFile);
      resetVerification();
    } catch (err) {
      setVoterIdProof(null);
      setVoterIdProofPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError(err.response?.data?.detail || err.message || 'Invalid voter card image.');
    }
  };

  // ── Step 1: verify text details ──────────────────────────────────────────
  const handleVerifyDetails = async () => {
    setError('');
    if (!formData.name || !formData.fathers_name || !formData.voter_id) {
      setError('Please fill in Name, Father\'s Name, and Voter ID Number before verifying.');
      return;
    }
    if (!voterIdProof) {
      setError('Please upload your Voter ID proof document before verifying.');
      return;
    }
    setDetailsVerifying(true);
    setDetailsResult(null);
    setFaceMatchResult(null);
    try {
      const result = await verifyDetails(formData.name, formData.fathers_name, formData.voter_id, voterIdProof);
      setDetailsResult(result);
    } catch (err) {
      setDetailsResult({
        success: false,
        already_registered: false,
        name_matched: false,
        voter_id_matched: false,
        fathers_name_matched: false,
        message: err.response?.data?.detail || 'Verification failed. Please try again.',
      });
    } finally {
      setDetailsVerifying(false);
    }
  };

  // ── Step 2: capture + face match ─────────────────────────────────────────
  const capturePhoto = () => {
    if (!liveness.livenessPassed) {
      setError('Please look at the camera and blink once before capturing your photo.');
      return;
    }
    const imageSrc = webcamRef.current.getScreenshot();
    setCapturedImage(imageSrc);
    setShowWebcam(false);
    setFaceMatchResult(null);
    setError('');
  };

  const handleVerifyFaceMatch = async () => {
    if (!capturedImage || !voterIdProof) return;
    setFaceMatchChecking(true);
    setFaceMatchResult(null);
    try {
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      const result = await checkFaceMatch(blob, voterIdProof);
      setFaceMatchResult(result);
    } catch (err) {
      setFaceMatchResult({
        match: false,
        confidence: 0,
        message: err.response?.data?.detail || 'Face match check failed. Please try again.',
      });
    } finally {
      setFaceMatchChecking(false);
    }
  };

  // ── Final submit ─────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!detailsResult?.success) { setError('Please complete Step 1: verify your details first.'); return; }
    if (!capturedImage) { setError('Please capture your live face photo.'); return; }
    if (!faceMatchResult?.match) { setError('Please complete Step 2: face match must pass before submitting.'); return; }
    setLoading(true);
    try {
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      const livenessProof = await verifyLivenessProof({
        voterId: formData.voter_id,
        purpose: 'register',
        blinkCount: Math.max(1, liveness.blinkCount),
        imageBlob: blob,
      });
      const submitData = new FormData();
      submitData.append('name', formData.name);
      submitData.append('fathers_name', formData.fathers_name);
      submitData.append('phone', formData.phone);
      submitData.append('voter_id', formData.voter_id);
      submitData.append('liveness_token', livenessProof.liveness_token);
      submitData.append('face_image', blob, 'face.jpg');
      submitData.append('voter_id_proof', voterIdProof, voterIdProof.name);
      await registerVoter(submitData);
      setSuccess('Registration successful! Your ID was verified. You can now vote.');
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { name: 'name', label: 'Full Name', type: 'text', placeholder: 'Enter your full name exactly as on Voter ID', hint: 'Must match the English name printed on your Voter ID card.' },
    { name: 'fathers_name', label: "Father's Name", type: 'text', placeholder: "Enter father's full name exactly as on Voter ID", hint: "Must match the Father's Name printed on your Voter ID card." },
    { name: 'phone', label: 'Phone Number', type: 'tel', placeholder: 'Enter your phone number' },
    { name: 'voter_id', label: 'Voter ID Number', type: 'text', placeholder: 'e.g. SOZ1791169', hint: '10-character ID printed on your Voter ID card (3 letters + 7 digits).' },
  ];

  const allDetailsReady = formData.name && formData.fathers_name && formData.voter_id && voterIdProof;
  const step2Unlocked = detailsResult?.success === true;
  const faceStepPassed = faceMatchResult?.match === true;
  const submitEnabled = step2Unlocked && faceStepPassed;

  const FieldBadge = ({ matched }) => (
    <span style={{
      marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: matched ? '#dcfce7' : '#fee2e2',
      color: matched ? '#15803d' : '#991b1b',
    }}>
      {matched ? '✓ Matched' : '✗ Not Found'}
    </span>
  );

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
        <div className="container" style={{ maxWidth: 620 }}>
          <div style={{ marginBottom: 24, marginTop: 8 }}>
            <h2 className="page-title">Voter Registration</h2>
            <p className="page-subtitle">Complete both verification steps to register.</p>
          </div>

          {/* Progress indicator */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
            {[
              { n: 1, label: 'Verify Details', done: detailsResult?.success },
              { n: 2, label: 'Face Match', done: faceMatchResult?.match },
            ].map((step, i) => (
              <div key={step.n} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                  padding: '10px 16px', borderRadius: i === 0 ? '8px 0 0 8px' : '0 8px 8px 0',
                  background: step.done ? '#dcfce7' : (i === 0 || detailsResult?.success) ? '#eff6ff' : '#f3f4f6',
                  border: `2px solid ${step.done ? '#059669' : (i === 0 || detailsResult?.success) ? '#3b82f6' : '#d1d5db'}`,
                  borderRight: i === 0 ? 'none' : undefined,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13,
                    flexShrink: 0,
                    background: step.done ? '#059669' : (i === 0 || detailsResult?.success) ? '#3b82f6' : '#9ca3af',
                    color: '#fff',
                  }}>
                    {step.done ? '✓' : step.n}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: step.done ? '#059669' : '#374151' }}>
                    {step.label}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: '32px 28px' }}>
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <form onSubmit={handleSubmit}>

              {/* ════════════════════════ STEP 1 ════════════════════════ */}
              <div style={{
                padding: '18px 20px', borderRadius: 10, marginBottom: 24,
                border: `2px solid ${detailsResult?.success ? '#059669' : '#3b82f6'}`,
                background: detailsResult?.success ? '#f0fdf4' : '#f8faff',
              }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1e40af', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', background: detailsResult?.success ? '#059669' : '#3b82f6',
                    color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
                  }}>{detailsResult?.success ? '✓' : '1'}</span>
                  Step 1 — Verify Details Against Document
                </div>

                {fields.map((f) => (
                  <div className="form-group" key={f.name}>
                    <label>{f.label} <span style={{ color: '#dc2626' }}>*</span></label>
                    <input type={f.type} name={f.name} value={formData[f.name]}
                      onChange={handleInputChange} required placeholder={f.placeholder} />
                    {f.hint && <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0 2px' }}>{f.hint}</p>}
                  </div>
                ))}

                {/* Voter ID Proof Upload */}
                <div className="form-group">
                  <label>Voter ID Proof <span style={{ color: '#dc2626' }}>*</span></label>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, marginTop: -4 }}>
                    Upload only Election Commission voter card image in 1136x768 size.
                  </p>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/avif,image/heic,image/heif,image/jfif"
                    style={{ display: 'none' }} onChange={handleProofFileChange} />
                  {!voterIdProof ? (
                    <button type="button" className="btn btn-primary"
                      onClick={() => fileInputRef.current.click()} style={{ width: '100%', padding: 14 }}>
                      📄 Upload Voter ID Proof
                    </button>
                  ) : (
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 16, border: '2px solid #059669', textAlign: 'center' }}>
                      {voterIdProofPreview && (
                        <img src={voterIdProofPreview} alt="ID Proof Preview"
                          style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 6, marginBottom: 10, objectFit: 'contain' }} />
                      )}
                      <div style={{ color: '#059669', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>✓ {voterIdProof.name}</div>
                      <button type="button" className="btn btn-secondary"
                        onClick={() => { setVoterIdProof(null); setVoterIdProofPreview(null); fileInputRef.current.value = ''; resetVerification(); }}
                        style={{ fontSize: 13 }}>
                        Change File
                      </button>
                    </div>
                  )}
                </div>

                {/* Verify Details Button */}
                {!detailsResult?.success && (
                  <div>
                    <button type="button" className="btn btn-primary"
                      onClick={handleVerifyDetails}
                      disabled={detailsVerifying || !allDetailsReady}
                      style={{ width: '100%', padding: 14, marginTop: 4, opacity: !allDetailsReady ? 0.5 : 1 }}>
                      {detailsVerifying ? '⏳ Scanning document...' : '🔍 Verify Details with Document'}
                    </button>
                    {detailsVerifying && (
                      <div style={{
                        marginTop: 12, padding: '12px 16px', borderRadius: 8,
                        background: '#eff6ff', border: '1px solid #bfdbfe',
                        fontSize: 13, color: '#1e40af', textAlign: 'center',
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>📄 Analysing your Voter ID document…</div>
                        <div style={{ color: '#3b82f6' }}>This may take 5–15 seconds. Please wait.</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Details Result */}
                {detailsResult && (
                  <div style={{
                    marginTop: 14, borderRadius: 8, padding: '14px 16px',
                    border: `2px solid ${detailsResult.success ? '#059669' : '#dc2626'}`,
                    background: detailsResult.success ? '#f0fdf4' : '#fef2f2',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12,
                      color: detailsResult.success ? '#059669' : '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{detailsResult.success ? '✅' : '❌'}</span>
                      {detailsResult.success ? 'All details verified — proceed to Step 2' : (detailsResult.already_registered ? 'Registration Blocked — Already Registered' : 'Details verification failed')}
                    </div>
                    {detailsResult.already_registered ? (
                      <div style={{ marginTop: 4, fontSize: 13, color: '#991b1b', background: '#fee2e2', borderRadius: 6, padding: '10px 14px', lineHeight: 1.6 }}>
                        🚫 <strong>Duplicate registration detected.</strong> The details you entered (Name, Father's Name, or Voter ID) already exist in our system.<br />
                        Each voter can only register once. If you believe this is an error, please contact the election authority.
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[
                            { label: 'Full Name', matched: detailsResult.name_matched },
                            { label: "Father's Name", matched: detailsResult.fathers_name_matched },
                            { label: 'Voter ID Number', matched: detailsResult.voter_id_matched },
                          ].map(({ label, matched }) => (
                            <div key={label} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '7px 12px', borderRadius: 6,
                              background: matched ? '#dcfce7' : '#fee2e2',
                              border: `1px solid ${matched ? '#86efac' : '#fca5a5'}`,
                            }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</span>
                              <FieldBadge matched={matched} />
                            </div>
                          ))}
                        </div>
                        {!detailsResult.success && (
                          <div style={{ marginTop: 10, fontSize: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 6, padding: '8px 12px' }}>
                            ⛔ Registration is blocked. Correct the highlighted fields to match your Voter ID document and re-verify.
                          </div>
                        )}
                        {!detailsResult.success && (
                          <button type="button" className="btn btn-secondary"
                            onClick={handleVerifyDetails} disabled={detailsVerifying}
                            style={{ marginTop: 10, fontSize: 12 }}>
                            🔄 Re-verify Details
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ════════════════════════ STEP 2 ════════════════════════ */}
              <div style={{
                padding: '18px 20px', borderRadius: 10, marginBottom: 24,
                border: `2px solid ${faceMatchResult?.match ? '#059669' : step2Unlocked ? '#3b82f6' : '#d1d5db'}`,
                background: faceMatchResult?.match ? '#f0fdf4' : step2Unlocked ? '#f8faff' : '#f9fafb',
                opacity: step2Unlocked ? 1 : 0.55,
                pointerEvents: step2Unlocked ? 'auto' : 'none',
              }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: step2Unlocked ? '#1e40af' : '#9ca3af', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: faceMatchResult?.match ? '#059669' : step2Unlocked ? '#3b82f6' : '#9ca3af',
                    color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
                  }}>{faceMatchResult?.match ? '✓' : '2'}</span>
                  Step 2 — Verify Live Face with Document
                  {!step2Unlocked && <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>(unlocks after Step 1 passes)</span>}
                </div>

                {/* Live photo capture */}
                <div className="form-group">
                  <label>Live Face Photo <span style={{ color: '#dc2626' }}>*</span></label>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, marginTop: -4 }}>
                    Capture a clear, front-facing photo. It will be compared with the face on your Voter ID card.
                  </p>

                  {!capturedImage && !showWebcam && (
                    <button type="button" className="btn btn-primary"
                      onClick={() => setShowWebcam(true)} style={{ width: '100%', padding: 14 }}>
                      📷 Open Camera
                    </button>
                  )}

                  {showWebcam && (
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb', textAlign: 'center' }}>
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
                      <div style={{ display: 'inline-block', borderRadius: 8, overflow: 'hidden', border: '2px solid #059669', marginBottom: 12 }}>
                        <img src={capturedImage} alt="Captured" style={{ maxWidth: 260, display: 'block' }} />
                      </div>
                      <div style={{ color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>✓ Photo captured</div>
                      <button type="button" className="btn btn-secondary"
                        onClick={() => { setCapturedImage(null); setFaceMatchResult(null); setShowWebcam(true); }}
                        style={{ fontSize: 13 }}>
                        Retake Photo
                      </button>
                    </div>
                  )}
                </div>

                {/* Face Match Button */}
                {capturedImage && !faceMatchResult && (
                  <button type="button" className="btn btn-primary"
                    onClick={handleVerifyFaceMatch} disabled={faceMatchChecking}
                    style={{ width: '100%', padding: 14 }}>
                    {faceMatchChecking ? '🔄 Comparing faces...' : '🔍 Verify Face Match with ID'}
                  </button>
                )}

                {/* Face Match Result */}
                {faceMatchResult && (
                  <div style={{
                    borderRadius: 8, padding: '14px 16px',
                    border: `2px solid ${faceMatchResult.match ? '#059669' : '#dc2626'}`,
                    background: faceMatchResult.match ? '#f0fdf4' : '#fef2f2',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 15,
                      color: faceMatchResult.match ? '#059669' : '#dc2626', marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{faceMatchResult.match ? '✅' : '❌'}</span>
                      {faceMatchResult.match
                        ? 'Face Matched — Verified'
                        : faceMatchResult.id_face_found === false
                          ? 'Face Not Detected in ID Document'
                          : 'Live Face Does Not Match Document Face'}
                    </div>

                    {/* Specific message body */}
                    {faceMatchResult.match ? (
                      <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                        Your live photo matches the face on your Voter ID document.
                      </p>
                    ) : faceMatchResult.id_face_found === false ? (
                      <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                        Could not detect a face in the uploaded Voter ID card photo. Please
                        upload a <strong>clearer, well-lit, flat scan</strong> of your ID card
                        where the face photo is fully visible, then re-verify.
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                        Your <strong>live face does not match</strong> the face photo on your
                        Voter ID document. Please retake your photo in good lighting, look
                        directly at the camera, and try again.
                      </p>
                    )}

                    {faceMatchResult.confidence > 0 && (
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>
                        Similarity: <strong>{faceMatchResult.confidence}%</strong>
                        {!faceMatchResult.match && ' (minimum 40% required)'}
                      </p>
                    )}

                    {!faceMatchResult.match && (
                      <button type="button" className="btn btn-secondary"
                        onClick={handleVerifyFaceMatch} disabled={faceMatchChecking}
                        style={{ marginTop: 10, fontSize: 12 }}>
                        🔄 Re-verify Face
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Phone field (not part of ID verification) */}
              <div className="form-group">
                <label>Phone Number <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="tel" name="phone" value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required placeholder="Enter your phone number" />
              </div>

              {/* Submit */}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="submit" className="btn btn-primary"
                  disabled={loading || !submitEnabled}
                  style={{ flex: 1, padding: 14, opacity: !submitEnabled && !loading ? 0.45 : 1 }}
                  title={!submitEnabled ? 'Complete both verification steps to enable submit' : ''}>
                  {loading ? 'Registering...' : 'Submit Registration'}
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

export default RegisterPage;
