import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getElectionStatus, getPublicResults } from '../services/api';

const CONFETTI = Array.from({ length: 70 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  delay: Math.random() * 4,
  duration: 2.8 + Math.random() * 2.2,
  color: ['#1a56db','#059669','#d97706','#dc2626','#7c3aed','#ec4899','#f59e0b','#06b6d4','#84cc16'][i % 9],
  size: 7 + Math.random() * 9,
  round: Math.random() > 0.55,
}));
const FLOWERS = ['\uD83C\uDF38','\uD83C\uDF3A','\uD83C\uDF3B','\uD83C\uDF39','\uD83C\uDF37','\uD83D\uDC90','\uD83C\uDF3C','\u2728','\uD83C\uDF89','\uD83C\uDF8A','\uD83C\uDF88','\u2B50'].map((emoji, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const dist = 110 + (i % 3) * 30;
  return { emoji, fx: `${Math.round(Math.cos(angle) * dist)}px`, fy: `${Math.round(Math.sin(angle) * dist)}px`, delay: `${i * 0.14}s` };
});

function HomePage() {
  const navigate = useNavigate();
  const [electionStatus, setElectionStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [resultsData, setResultsData] = useState(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  useEffect(() => { fetchElectionStatus(); }, []);

  const fetchElectionStatus = async () => {
    try {
      const data = await getElectionStatus();
      setElectionStatus(data);
    } catch (error) {
      console.error('Error fetching election status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewResults = async () => {
    setResultsLoading(true);
    try {
      const data = await getPublicResults();
      setResultsData(data);
      setShowResultsModal(true);
    } catch {
      alert('Results are not available yet.');
    } finally {
      setResultsLoading(false);
    }
  };

  const topVotes = resultsData?.results?.[0]?.vote_count;
  const tiedCandidates = (resultsData?.results || []).filter(r => r.vote_count === topVotes);
  const isTie = tiedCandidates.length > 1;
  const lotWinner = resultsData?.lot_winner_name
    ? resultsData.results.find(r => r.candidate_name === resultsData.lot_winner_name)
    : null;
  const showWinner = !isTie || lotWinner;
  const winner = lotWinner || (resultsData?.results?.[0]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: '#fff',
        borderBottom: '3px solid #16a34a',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <img src="/bec%20logo.png" alt="Bapatla Engineering College" style={{ height: 120, width: 120, objectFit: 'contain' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#14532d', letterSpacing: 0.5 }}>Bapatla Engineering College, Bapatla</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#df09bf', marginTop: 2, letterSpacing: 0.3 }}>Smart Online Voting Platform Using Face Recognition</div>
          <div style={{ fontSize: 16, color: '#6b7280', marginTop: 2, letterSpacing: 0.3 }}>Developed By</div>
          <div style={{ fontSize: 18, fontWeight: 450, color: '#0f08d3', marginTop: 2, letterSpacing: 0.3 }}>Department Of Information Technology</div>
        </div>
        <img src="/bec%20logo.png" alt="" style={{ height: 120, width: 120, objectFit: 'contain' }} />
      </div>

      <div className="site-header">
        <div className="site-header-inner">
          <div className="site-logo">
            <div className="site-logo-icon">{'\uD83D\uDDF3\uFE0F'}</div>
            <div><h1>VoteSecure</h1><p>Online Voting System</p></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/admin/login')}>Admin Portal</button>
          </div>
        </div>
      </div>

      <div style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #1a56db 50%, #2563eb 100%)', color: 'white', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, marginBottom: 12 }}>Smart Online Voting Platform</h2>
          <p style={{ fontSize: 17, opacity: 0.9, marginBottom: 32, lineHeight: 1.6 }}>
            Cast your vote securely using face recognition technology. Your identity is verified, and your vote remains anonymous.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-lg" onClick={() => navigate('/register')} style={{ background: 'white', color: '#1a56db', border: 'none', fontWeight: 700 }}>Register to Vote</button>
            <button className="btn btn-lg" onClick={() => navigate('/update-face')} style={{ background: '#7c3aed', color: 'white', border: 'none', fontWeight: 700 }}>Update Face Photo</button>
            <button className="btn btn-lg" onClick={() => navigate('/vote')} disabled={!electionStatus?.is_active}
              style={{ background: !electionStatus?.is_active ? 'rgba(255,255,255,0.3)' : '#059669', color: 'white', border: 'none', fontWeight: 700, cursor: !electionStatus?.is_active ? 'not-allowed' : 'pointer' }}>
              Cast Your Vote
            </button>
            {electionStatus?.has_ended && (
              <button className="btn btn-lg" onClick={handleViewResults} disabled={resultsLoading}
                style={{ background: '#f59e0b', color: 'white', border: 'none', fontWeight: 700 }}>
                {resultsLoading ? '\u23F3 Loading...' : '\uD83D\uDCCA View Results'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          {!loading && electionStatus && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: electionStatus.is_active ? '#059669' : electionStatus.has_ended ? '#1a56db' : '#d97706', display: 'inline-block' }} />
                Election Status
              </h3>
              {electionStatus.is_active ? (
                <div className="alert-info" style={{ margin: 0 }}>
                  <strong>Active Election:</strong> {electionStatus.election?.title}
                  <br />
                  <span style={{ fontSize: 13 }}>{new Date(electionStatus.election?.start_date).toLocaleDateString()} &mdash; {new Date(electionStatus.election?.end_date).toLocaleDateString()}</span>
                  {electionStatus.election?.description && (<><br /><span style={{ fontSize: 13 }}>{electionStatus.election.description}</span></>)}
                </div>
              ) : electionStatus.has_ended ? (
                <div style={{ margin: 0, padding: '12px 16px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                  <strong>Election Completed:</strong> {electionStatus.election?.title}
                  <br />
                  <span style={{ fontSize: 13, color: '#4b5563' }}>The election has ended. Click <strong>View Results</strong> to see the outcome.</span>
                </div>
              ) : (
                <div className="alert-warning" style={{ margin: 0 }}>
                  <strong>No Active Election</strong> &mdash; There is currently no election open for voting. Please check back later.
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 18 }}>How It Works</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
              {[
                { step: 1, title: 'Register', desc: 'Submit your details and a face photo to create your voter profile.', icon: '\uD83D\uDCDD' },
                { step: 2, title: 'Verify Identity', desc: 'Prove your identity with live face recognition before voting.', icon: '\uD83D\uDD10' },
                { step: 3, title: 'Cast Your Vote', desc: 'Select your candidate from the secure ballot.', icon: '\uD83D\uDDF3\uFE0F' },
                { step: 4, title: 'Done', desc: 'Your vote is recorded anonymously and securely.', icon: '\u2705' },
              ].map(item => (
                <div key={item.step} style={{ padding: 16, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', margin: '0 auto 8px', background: '#1a56db', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{item.step}</div>
                  <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{item.title}</h4>
                  <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>Key Features</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              {[
                'Face Recognition for voter identity verification',
                'One vote per registered voter guaranteed',
                'Anonymous ballot &mdash; your vote cannot be traced to you',
                'Real-time results and analytics for administrators',
                'Secure encrypted data storage',
                'Accessible from any device with a camera',
              ].map((feature, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: '#374151' }}>
                  <span style={{ color: '#059669', fontWeight: 700, marginTop: 1 }}>{'\u2713'}</span>
                  {feature}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="site-footer">VoteSecure &copy; {new Date().getFullYear()} &mdash; Smart Digital Voting Platform Using Facial Recognition</div>

      {showResultsModal && resultsData && (
        <div className="election-overlay" onClick={() => setShowResultsModal(false)}>
          {showWinner && CONFETTI.map(p => (
            <div key={p.id} className="confetti-piece" style={{ left: `${p.left}%`, top: '-30px', width: p.round ? p.size : p.size * 0.55, height: p.size, borderRadius: p.round ? '50%' : '2px', background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }} />
          ))}
          <div className="er-modal" onClick={e => e.stopPropagation()}>
            {showWinner && FLOWERS.map((f, i) => (
              <div key={i} className="flower-particle" style={{ animationDelay: f.delay, animationDuration: '2s', '--fx': f.fx, '--fy': f.fy }}>{f.emoji}</div>
            ))}
            <div className="er-trophy">{isTie && !lotWinner ? '\u2696\uFE0F' : '\uD83C\uDFC6'}</div>
            <h2 className="er-title">{isTie && !lotWinner ? 'Election Tied!' : 'Election Ended!'}</h2>
            <p className="er-subtitle">{resultsData.election_title}</p>

            {isTie && !lotWinner && (
              <div className="er-tie-box">
                <div className="er-tie-badge">{'\uD83E\uDD1D'} It&apos;s a Tie!</div>
                <p className="er-tie-desc">The following candidates received equal votes:</p>
                <div className="er-tie-names">
                  {tiedCandidates.map((c, i) => (
                    <span key={i} className="er-tie-chip">{c.candidate_name} <span style={{ color: '#6b7280', fontWeight: 400 }}>({c.party})</span></span>
                  ))}
                </div>
                <p className="er-tie-votes">{tiedCandidates[0].vote_count} vote{tiedCandidates[0].vote_count !== 1 ? 's' : ''} each</p>
                <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 10, padding: '10px 16px', marginTop: 8, fontSize: 14, color: '#92400e', fontWeight: 600 }}>
                  {'\u23F3'} The administrator is yet to decide the winner via drawing lots. Please check back soon.
                </div>
              </div>
            )}

            {showWinner && winner && (
              <div className="er-winner">
                {lotWinner && <div className="er-lots-decided">{'\uD83C\uDFB2'} Decided by Drawing Lots</div>}
                <div className="er-crown">{'\uD83D\uDC51'}</div>
                <div className="er-winner-badge">{'\uD83E\uDD47'} Winner</div>
                <div className="er-winner-name">{winner.candidate_name}</div>
                <div className="er-winner-party">{winner.party}</div>
                <div className="er-winner-votes">{winner.vote_count} votes &nbsp;&middot;&nbsp; {winner.percentage}%</div>
              </div>
            )}

            <p style={{ fontWeight: 700, fontSize: 14, color: '#374151', textAlign: 'left', marginBottom: 6, marginTop: 12 }}>
              All Results &mdash; Total Votes: <span style={{ color: '#1a56db' }}>{resultsData.total_votes}</span>
            </p>
            <table className="er-table">
              <thead>
                <tr><th>#</th><th>Candidate</th><th>Party</th><th>Votes</th><th>Share</th></tr>
              </thead>
              <tbody>
                {resultsData.results.map((r, i) => (
                  <tr key={i} className={isTie ? '' : `er-rank-${i + 1}`} style={{ animationDelay: `${i * 0.08}s` }}>
                    <td>{isTie ? '\uD83E\uDD1D' : (i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : i + 1)}</td>
                    <td style={{ fontWeight: 700 }}>{r.candidate_name}</td>
                    <td style={{ color: '#6b7280', fontSize: 13 }}>{r.party}</td>
                    <td style={{ fontWeight: 700, color: '#1a56db', fontFamily: 'monospace' }}>{r.vote_count}</td>
                    <td>
                      <div className="er-bar-wrap">
                        <div className="er-bar-bg"><div className="er-bar-fill" style={{ width: `${r.percentage}%` }} /></div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{r.percentage}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="er-actions">
              <button className="btn btn-secondary" onClick={() => setShowResultsModal(false)}>{'\u2715'} Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;