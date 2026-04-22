import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

function ThankYouPage() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => {
    localStorage.removeItem('token');
    setTimeout(() => setShow(true), 100);
  }, []);

  const infoItems = [
    { icon: '🔒', text: 'Your vote has been recorded anonymously and securely' },
    { icon: '🚫', text: 'You cannot vote again in this election' },
    { icon: '📊', text: 'Results will be announced after the election ends' },
    { icon: '🙏', text: 'Thank you for participating in the democratic process' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="site-header">
        <div className="site-header-inner">
          <div className="site-logo">
            <div className="site-logo-icon">🗳️</div>
            <div><h1>VoteSecure</h1><p>Online Voting System</p></div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{
          maxWidth: 520, width: '100%', textAlign: 'center', padding: '48px 36px',
          opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.5s ease',
        }}>
          {/* Checkmark */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 24px',
            background: '#ecfdf5', border: '2px solid #059669',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
          }}>✅</div>

          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 10, color: '#059669' }}>
            Vote Recorded Successfully
          </h1>
          <p style={{ fontSize: 15, color: '#6b7280', marginBottom: 28, lineHeight: 1.6 }}>
            Your vote has been submitted successfully and securely.
          </p>

          {/* Info Items */}
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 8, padding: '16px 20px', textAlign: 'left', marginBottom: 28,
          }}>
            {infoItems.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 0',
                borderBottom: i < infoItems.length - 1 ? '1px solid #dcfce7' : 'none',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 14, color: '#374151', lineHeight: 1.5 }}>{item.text}</span>
              </div>
            ))}
          </div>

          <button className="btn btn-primary" onClick={() => navigate('/')}
            style={{ padding: '12px 36px', fontSize: 15 }}>
            ← Return to Home
          </button>
        </div>
      </div>

      <div className="site-footer">
        VoteSecure © {new Date().getFullYear()} — Secure Online Voting System
      </div>
    </div>
  );
}

export default ThankYouPage;
