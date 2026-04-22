import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStatistics, getAllVoters, getAllCandidates, createCandidate,
  deleteCandidate, getVotingResults, createElection, getAllElections, toggleElection, deleteElection, saveLotWinner
} from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/* ── Confetti & flower data (stable across renders) ── */
const CONFETTI = Array.from({ length: 70 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  delay: Math.random() * 4,
  duration: 2.8 + Math.random() * 2.2,
  color: ['#1a56db','#059669','#d97706','#dc2626','#7c3aed','#ec4899','#f59e0b','#06b6d4','#84cc16'][i % 9],
  size: 7 + Math.random() * 9,
  round: Math.random() > 0.55,
}));

const FLOWERS = ['🌸','🌺','🌻','🌹','🌷','💐','🌼','✨','🎉','🎊','🎈','⭐'].map((emoji, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const dist = 110 + (i % 3) * 30;
  return {
    emoji,
    fx: `${Math.round(Math.cos(angle) * dist)}px`,
    fy: `${Math.round(Math.sin(angle) * dist)}px`,
    delay: `${i * 0.14}s`,
  };
});

function AdminDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statistics, setStatistics] = useState(null);
  const [voters, setVoters] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [results, setResults] = useState(null);
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [candidateForm, setCandidateForm] = useState({ name: '', party: '', symbol: '', description: '' });
  const [candidateImage, setCandidateImage] = useState(null);
  const [electionForm, setElectionForm] = useState({ title: '', description: '', start_date: '', end_date: '' });

  // Celebration modal state
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null); // { electionTitle, total_votes, results }
  const [lotWinner, setLotWinner] = useState(null); // set after draw lots
  const [lotSpinning, setLotSpinning] = useState(false);
  const [lotDisplay, setLotDisplay] = useState('');

  // Detect tie among top-scoring candidates only
  const topVotes = modalData?.results?.[0]?.vote_count;
  const tiedCandidates = (modalData?.results || []).filter(r => r.vote_count === topVotes);
  const isTie = tiedCandidates.length > 1;

  const handleDrawLots = () => {
    if (!isTie || tiedCandidates.length < 2) return;
    const winner = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
    setLotSpinning(true);
    setLotDisplay(tiedCandidates[0].candidate_name);
    const names = tiedCandidates.map(c => c.candidate_name);
    let count = 0;
    const total = 24; // number of flips
    const spin = setInterval(() => {
      setLotDisplay(names[count % names.length]);
      count++;
      if (count >= total) {
        clearInterval(spin);
        setLotDisplay(winner.candidate_name);
        setTimeout(() => {
          setLotSpinning(false);
          setLotWinner(winner);          // Persist to backend so voters can see the decision
          if (modalData?.electionId) {
            saveLotWinner(modalData.electionId, winner.candidate_name).catch(() => {});
          }        }, 600);
      }
    }, 80 + Math.floor(count / total * 120)); // gradually slow down
  };

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) { navigate('/admin/login'); return; }
    fetchData();
  }, [activeTab]);

  // Poll every 10 s — when an active election's end_date passes, show celebration
  useEffect(() => {
    const checkElectionEnd = async () => {
      try {
        const token = localStorage.getItem('adminToken');
        if (!token) return;
        const allElections = await getAllElections();
        const now = new Date();
        for (const el of allElections) {
          if (!el.is_active) continue;
          if (new Date(el.end_date) > now) continue;
          const key = `er_shown_${el.id}`;
          if (sessionStorage.getItem(key)) continue;
          sessionStorage.setItem(key, '1');
          const res = await getVotingResults();
          setModalData({ electionTitle: el.title, electionId: el.id, ...res });
          const persistedWinner = res?.lot_winner_name
            ? (res.results || []).find(c => c.candidate_name === res.lot_winner_name) || null
            : null;
          setLotWinner(persistedWinner);
          setShowModal(true);
          break;
        }
      } catch { /* silently ignore polling errors */ }
    };
    checkElectionEnd();
    const iv = setInterval(checkElectionEnd, 10000);
    return () => clearInterval(iv);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'dashboard') { setStatistics(await getStatistics()); }
      else if (activeTab === 'voters') { setVoters(await getAllVoters()); }
      else if (activeTab === 'candidates') { setCandidates(await getAllCandidates()); }
      else if (activeTab === 'results') { setResults(await getVotingResults()); }
      else if (activeTab === 'elections') { setElections(await getAllElections()); }
    } catch { setError('Failed to fetch data'); }
    finally { setLoading(false); }
  };

  const handleLogout = () => { localStorage.removeItem('adminToken'); navigate('/admin/login'); };

  const handleCandidateSubmit = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    try {
      const formData = new FormData();
      formData.append('name', candidateForm.name);
      formData.append('party', candidateForm.party);
      formData.append('symbol', candidateForm.symbol);
      formData.append('description', candidateForm.description);
      if (candidateImage) formData.append('image', candidateImage);
      await createCandidate(formData);
      setSuccess('Candidate added successfully!');
      setCandidateForm({ name: '', party: '', symbol: '', description: '' });
      setCandidateImage(null); fetchData();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to add candidate'); }
  };

  const handleDeleteCandidate = async (id) => {
    if (!window.confirm('Delete this candidate?')) return;
    try { await deleteCandidate(id); setSuccess('Candidate deleted!'); fetchData(); }
    catch { setError('Failed to delete candidate'); }
  };

  const handleElectionSubmit = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    try {
      await createElection(electionForm);
      setSuccess('Election created!');
      setElectionForm({ title: '', description: '', start_date: '', end_date: '' }); fetchData();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to create election'); }
  };

  const handleToggleElection = async (id) => {
    try { await toggleElection(id); setSuccess('Election status updated!'); fetchData(); }
    catch { setError('Failed to update election'); }
  };

  const handleDeleteElection = async (id, title) => {
    if (!window.confirm(`Delete election history for "${title}"? This will also remove votes for this election.`)) return;
    try {
      await deleteElection(id);
      setSuccess('Election history deleted!');
      fetchData();
    } catch {
      setError('Failed to delete election history');
    }
  };

  const tabItems = [
    { key: 'dashboard', icon: '📊', label: 'Dashboard' },
    { key: 'elections', icon: '🗳️', label: 'Elections' },
    { key: 'candidates', icon: '👥', label: 'Candidates' },
    { key: 'voters', icon: '📋', label: 'Voters' },
    { key: 'results', icon: '📈', label: 'Results' },
  ];

  return (
    <div className="admin-dashboard">
      {/* ── Header / Navbar ── */}
      <div className="site-header">
        <div className="site-header-inner">
          <div className="site-logo">
            <div className="site-logo-icon">🗳️</div>
            <div><h1>VoteSecure</h1><p>Administration Panel</p></div>
          </div>
          <button className="btn btn-secondary" onClick={handleLogout} style={{ padding: '8px 20px', fontSize: 13 }}>
            Logout
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          {/* ── Tab Nav ── */}
          <div className="admin-tab-nav">
            {tabItems.map(t => (
              <button
                key={t.key}
                className={`admin-tab-btn${activeTab === t.key ? ' active' : ''}`}
                onClick={() => { setActiveTab(t.key); setError(''); setSuccess(''); }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <>
            {/* ══ DASHBOARD ══ */}
            {activeTab === 'dashboard' && statistics && (
              <div className="fade-in">
                <div className="stats-grid">
                  {[
                    { val: statistics.total_voters, label: 'Registered Voters', color: '#1a56db' },
                    { val: statistics.voted_count, label: 'Votes Cast', color: '#059669' },
                    { val: statistics.pending_votes, label: 'Pending Votes', color: '#d97706' },
                    { val: `${statistics.turnout_percentage}%`, label: 'Voter Turnout', color: '#7c3aed' },
                  ].map((s, i) => (
                    <div key={i} className="stat-card" style={{ animationDelay: `${i * 0.08}s` }}>
                      <h3 style={{ color: s.color }}>{s.val}</h3>
                      <p>{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ ELECTIONS ══ */}
            {activeTab === 'elections' && (
              <div className="fade-in">
                <div className="card" style={{ marginBottom: 24 }}>
                  <h3 className="section-title">Create New Election</h3>
                  <form onSubmit={handleElectionSubmit}>
                    <div className="form-group">
                      <label>Title</label>
                      <input type="text" value={electionForm.title}
                        onChange={(e) => setElectionForm({ ...electionForm, title: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label>Description</label>
                      <textarea value={electionForm.description}
                        onChange={(e) => setElectionForm({ ...electionForm, description: e.target.value })} rows="3" required />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="form-group">
                        <label>Start Date & Time</label>
                        <input type="datetime-local" value={electionForm.start_date}
                          onChange={(e) => setElectionForm({ ...electionForm, start_date: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>End Date & Time</label>
                        <input type="datetime-local" value={electionForm.end_date}
                          onChange={(e) => setElectionForm({ ...electionForm, end_date: e.target.value })} required />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }}>🗳️ Create Election</button>
                  </form>
                </div>

                <div className="card">
                  <h3 className="section-title">All Elections</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>Title</th><th>Start</th><th>End</th><th>Status</th><th>Action</th></tr>
                      </thead>
                      <tbody>
                        {elections.map(el => (
                          <tr key={el.id}>
                            <td style={{ fontWeight: 600 }}>{el.title}</td>
                            <td>{new Date(el.start_date).toLocaleString()}</td>
                            <td>{new Date(el.end_date).toLocaleString()}</td>
                            <td><span className={`badge ${el.is_active ? 'badge-active' : 'badge-inactive'}`}>
                              {el.is_active ? 'Active' : 'Inactive'}
                            </span></td>
                            <td>
                              {(() => {
                                const isCompleted = new Date(el.end_date) <= new Date();
                                const canDeleteHistory = !el.is_active || isCompleted;
                                return (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className={`btn ${el.is_active ? 'btn-secondary' : 'btn-primary'}`}
                                  onClick={() => handleToggleElection(el.id)}
                                  style={{ padding: '6px 16px', fontSize: 12 }}>
                                  {el.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                {canDeleteHistory && (
                                  <button
                                    className="btn btn-danger"
                                    onClick={() => handleDeleteElection(el.id, el.title)}
                                    style={{ padding: '6px 16px', fontSize: 12 }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ══ CANDIDATES ══ */}
            {activeTab === 'candidates' && (
              <div className="fade-in">
                <div className="card" style={{ marginBottom: 24 }}>
                  <h3 className="section-title">Add New Candidate</h3>
                  <form onSubmit={handleCandidateSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="form-group">
                        <label>Name</label>
                        <input type="text" value={candidateForm.name}
                          onChange={(e) => setCandidateForm({ ...candidateForm, name: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Party</label>
                        <input type="text" value={candidateForm.party}
                          onChange={(e) => setCandidateForm({ ...candidateForm, party: e.target.value })} required />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                      <div className="form-group">
                        <label>Symbol (Emoji)</label>
                        <input type="text" value={candidateForm.symbol}
                          onChange={(e) => setCandidateForm({ ...candidateForm, symbol: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Photo (Optional)</label>
                        <input type="file" accept="image/*"
                          onChange={(e) => setCandidateImage(e.target.files[0])} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Description</label>
                      <textarea value={candidateForm.description}
                        onChange={(e) => setCandidateForm({ ...candidateForm, description: e.target.value })} rows="3" required />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }}>👥 Add Candidate</button>
                  </form>
                </div>

                <div className="card">
                  <h3 className="section-title">All Candidates</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>Name</th><th>Party</th><th>Symbol</th><th>Description</th><th>Action</th></tr>
                      </thead>
                      <tbody>
                        {candidates.map(c => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 600 }}>{c.name}</td>
                            <td>{c.party}</td>
                            <td style={{ fontSize: 24 }}>{c.symbol}</td>
                            <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.description}</td>
                            <td>
                              <button className="btn btn-danger" onClick={() => handleDeleteCandidate(c.id)}
                                style={{ padding: '6px 16px', fontSize: 12 }}>
                                🗑️ Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ══ VOTERS ══ */}
            {activeTab === 'voters' && (
              <div className="card fade-in">
                <h3 className="section-title">Registered Voters</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr><th>Voter ID</th><th>Name</th><th>Father's Name</th><th>Phone</th><th>Status</th><th>Voted</th></tr>
                    </thead>
                    <tbody>
                      {voters.map(v => (
                        <tr key={v.id}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{v.voter_id}</td>
                          <td style={{ fontWeight: 600 }}>{v.name}</td>
                          <td>{v.fathers_name}</td>
                          <td>{v.phone}</td>
                          <td><span className={`badge ${v.is_verified ? 'badge-active' : 'badge-warning'}`}>
                            {v.is_verified ? 'Verified' : 'Pending'}
                          </span></td>
                          <td><span className={`badge ${v.has_voted ? 'badge-active' : 'badge-inactive'}`}>
                            {v.has_voted ? 'Yes' : 'No'}
                          </span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ══ RESULTS ══ */}
            {activeTab === 'results' && results && (
              <div className="fade-in">
                <div className="card">
                  <h3 className="section-title">Voting Results</h3>
                  <p style={{ marginBottom: 24, fontSize: 15, color: '#6b7280' }}>
                    Total Votes Cast: <span style={{ fontWeight: 700, color: '#1a56db' }}>{results.total_votes}</span>
                  </p>

                  <div style={{ marginBottom: 32, background: '#f9fafb', borderRadius: 8, padding: '20px 12px', border: '1px solid #e5e7eb' }}>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={results.results}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="candidate_name" tick={{ fill: '#374151', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#374151', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            background: '#ffffff', border: '1px solid #e5e7eb',
                            borderRadius: 8, color: '#111827', fontSize: 13,
                          }}
                        />
                        <Legend wrapperStyle={{ color: '#374151', fontSize: 13 }} />
                        <Bar dataKey="vote_count" fill="#1a56db" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Percentage</th></tr>
                      </thead>
                      <tbody>
                        {results.results.map((r, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{r.candidate_name}</td>
                            <td>{r.party}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1a56db' }}>{r.vote_count}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{
                                  flex: 1, height: 6, borderRadius: 3,
                                  background: '#e5e7eb', overflow: 'hidden', maxWidth: 120,
                                }}>
                                  <div style={{
                                    height: '100%', borderRadius: 3,
                                    background: '#1a56db',
                                    width: `${r.percentage}%`, transition: 'width 0.8s ease',
                                  }} />
                                </div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{r.percentage}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>

      <div className="site-footer">
        VoteSecure © {new Date().getFullYear()} — Administration Panel
      </div>

      {/* ══ ELECTION RESULTS CELEBRATION MODAL ══ */}
      {showModal && modalData && (
        <div className="election-overlay" onClick={() => setShowModal(false)}>

          {/* Confetti rain — only when there's a clear winner or lots have been drawn */}
          {(!isTie || lotWinner) && CONFETTI.map(p => (
            <div key={p.id} className="confetti-piece" style={{
              left: `${p.left}%`,
              top: '-30px',
              width: p.round ? p.size : p.size * 0.55,
              height: p.size,
              borderRadius: p.round ? '50%' : '2px',
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }} />
          ))}

          <div className="er-modal" onClick={e => e.stopPropagation()}>

            {/* Flower bomb particles — only when winner is shown */}
            {(!isTie || lotWinner) && FLOWERS.map((f, i) => (
              <div key={i} className="flower-particle" style={{
                animationDelay: f.delay,
                animationDuration: '2s',
                '--fx': f.fx,
                '--fy': f.fy,
              }}>{f.emoji}</div>
            ))}

            {/* Trophy or scales */}
            <div className="er-trophy">{isTie && !lotWinner ? '⚖️' : '🏆'}</div>

            <h2 className="er-title">{isTie && !lotWinner ? 'Election Tied!' : 'Election Ended!'}</h2>
            <p className="er-subtitle">{modalData.electionTitle}</p>

            {/* TIE state — no winner yet */}
            {isTie && !lotWinner && (
              <div className="er-tie-box">
                <div className="er-tie-badge">🤝 It's a Tie!</div>
                <p className="er-tie-desc">
                  The following candidates received equal votes:
                </p>
                <div className="er-tie-names">
                  {tiedCandidates.map((c, i) => (
                    <span key={i} className="er-tie-chip">{c.candidate_name} <span style={{color:'#6b7280',fontWeight:400}}>({c.party})</span></span>
                  ))}
                </div>
                <p className="er-tie-votes">{tiedCandidates[0].vote_count} vote{tiedCandidates[0].vote_count !== 1 ? 's' : ''} each</p>
                <button className="btn er-lots-btn" onClick={handleDrawLots} disabled={lotSpinning}>
                  {lotSpinning ? '🎲 Drawing...' : '🎲 Decide by Drawing Lots'}
                </button>
              </div>
            )}

            {/* Slot machine spinning animation */}
            {lotSpinning && (
              <div className="er-slot-machine">
                <div className="er-slot-label">Drawing Lots...</div>
                <div className="er-slot-reel">
                  <span className="er-slot-name">{lotDisplay}</span>
                </div>
                <div className="er-slot-dice">🎲🎲🎲</div>
              </div>
            )}

            {/* WINNER — either clear or decided by lots */}
            {(!isTie || lotWinner) && (() => {
              const winner = lotWinner || modalData.results[0];
              return winner ? (
                <div className="er-winner">
                  {lotWinner && <div className="er-lots-decided">🎲 Decided by Drawing Lots</div>}
                  <div className="er-crown">👑</div>
                  <div className="er-winner-badge">🥇 Winner</div>
                  <div className="er-winner-name">{winner.candidate_name}</div>
                  <div className="er-winner-party">{winner.party}</div>
                  <div className="er-winner-votes">
                    {winner.vote_count} votes &nbsp;·&nbsp; {winner.percentage}%
                  </div>
                </div>
              ) : null;
            })()}

            {/* Full ranking table */}
            <p style={{ fontWeight: 700, fontSize: 14, color: '#374151', textAlign: 'left', marginBottom: 6, marginTop: isTie && !lotWinner ? 16 : 0 }}>
              All Results — Total Votes: <span style={{ color: '#1a56db' }}>{modalData.total_votes}</span>
            </p>
            <table className="er-table">
              <thead>
                <tr><th>#</th><th>Candidate</th><th>Party</th><th>Votes</th><th>Share</th></tr>
              </thead>
              <tbody>
                {modalData.results.map((r, i) => (
                  <tr key={i} className={isTie ? '' : `er-rank-${i + 1}`} style={{ animationDelay: `${i * 0.08}s` }}>
                    <td>{isTie ? '🤝' : (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1)}</td>
                    <td style={{ fontWeight: 700 }}>{r.candidate_name}</td>
                    <td style={{ color: '#6b7280', fontSize: 13 }}>{r.party}</td>
                    <td style={{ fontWeight: 700, color: '#1a56db', fontFamily: 'monospace' }}>{r.vote_count}</td>
                    <td>
                      <div className="er-bar-wrap">
                        <div className="er-bar-bg">
                          <div className="er-bar-fill" style={{ width: `${r.percentage}%` }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                          {r.percentage}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="er-actions">
              <button className="btn btn-primary" onClick={() => { setShowModal(false); setActiveTab('results'); fetchData(); }}>
                📊 View Full Results
              </button>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
