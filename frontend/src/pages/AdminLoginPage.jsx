import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin, adminSignup, adminForgotPassword, getSecurityQuestion } from '../services/api';

const SECURITY_QUESTIONS = [
  'What is your mother\'s maiden name?',
  'What was the name of your first pet?',
  'What city were you born in?',
  'What is your favorite book?',
  'What was the name of your first school?',
  'What is your favorite movie?',
];

function AdminLoginPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [signupData, setSignupData] = useState({
    username: '', email: '', password: '', confirmPassword: '',
    security_question: SECURITY_QUESTIONS[0], security_answer: ''
  });
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotData, setForgotData] = useState({
    username: '', email: '', security_answer: '',
    new_password: '', confirm_password: ''
  });
  const [securityQuestion, setSecurityQuestion] = useState('');

  const clearMessages = () => { setError(''); setSuccess(''); };
  const switchTab = (tab) => { setActiveTab(tab); clearMessages(); setForgotStep(1); setSecurityQuestion(''); };

  const handleLogin = async (e) => {
    e.preventDefault(); clearMessages(); setLoading(true);
    try {
      const result = await adminLogin(loginData);
      localStorage.setItem('adminToken', result.access_token);
      navigate('/admin/dashboard');
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (!err.response) setError('Cannot reach server. Make sure the backend is running.');
      else setError(typeof detail === 'string' ? detail : 'Login failed. Please check your credentials.');
    } finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault(); clearMessages();
    if (signupData.password !== signupData.confirmPassword) { setError('Passwords do not match'); return; }
    if (signupData.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      const result = await adminSignup({
        username: signupData.username, email: signupData.email, password: signupData.password,
        security_question: signupData.security_question, security_answer: signupData.security_answer,
      });
      setSuccess(result.message);
      setSignupData({ username: '', email: '', password: '', confirmPassword: '', security_question: SECURITY_QUESTIONS[0], security_answer: '' });
      setTimeout(() => switchTab('login'), 2000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : JSON.stringify(detail) || 'Sign up failed.');
    } finally { setLoading(false); }
  };

  const handleFetchQuestion = async (e) => {
    e.preventDefault(); clearMessages();
    if (!forgotData.username) { setError('Please enter your username'); return; }
    setLoading(true);
    try {
      const result = await getSecurityQuestion(forgotData.username);
      setSecurityQuestion(result.security_question);
      setForgotStep(2);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (!err.response) setError('Cannot reach server. Make sure the backend is running.');
      else setError(typeof detail === 'string' ? detail : 'Could not find account.');
    } finally { setLoading(false); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault(); clearMessages();
    if (forgotData.new_password !== forgotData.confirm_password) { setError('Passwords do not match'); return; }
    if (forgotData.new_password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      const result = await adminForgotPassword({
        username: forgotData.username, email: forgotData.email,
        security_answer: forgotData.security_answer, new_password: forgotData.new_password,
      });
      setSuccess(result.message);
      setForgotData({ username: '', email: '', security_answer: '', new_password: '', confirm_password: '' });
      setForgotStep(1); setSecurityQuestion('');
      setTimeout(() => switchTab('login'), 2000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (!err.response) setError('Cannot reach server. Make sure the backend is running.');
      else setError(typeof detail === 'string' ? detail : 'Password reset failed.');
    } finally { setLoading(false); }
  };

  const tabs = [
    { key: 'login', label: 'Login' },
    { key: 'signup', label: 'Sign Up' },
    { key: 'forgot', label: 'Forgot Password' },
  ];

  return (
    <div className="admin-login-page">
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

      <div className="admin-login-center">
        <div className="admin-login-card">
          {/* Header */}
          <div className="admin-login-icon">🛡️</div>
          <h2 className="admin-login-title">Administration Portal</h2>
          <p className="admin-login-subtitle">Manage elections, candidates, and voters</p>

          {/* Tabs */}
          <div className="admin-login-tabs">
            {tabs.map(t => (
              <button
                key={t.key}
                className={`admin-login-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => switchTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          {/* ── LOGIN ── */}
          {activeTab === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>Username</label>
                <input type="text" value={loginData.username} onChange={(e) => setLoginData({ ...loginData, username: e.target.value })} required placeholder="Enter username" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={loginData.password} onChange={(e) => setLoginData({ ...loginData, password: e.target.value })} required placeholder="Enter password" />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, padding: 14 }}>
                  {loading ? 'Logging in...' : 'Login'}
                </button>
              </div>
            </form>
          )}

          {/* ── SIGNUP ── */}
          {activeTab === 'signup' && (
            <form onSubmit={handleSignup}>
              <div className="form-group">
                <label>Username</label>
                <input type="text" value={signupData.username} onChange={(e) => setSignupData({ ...signupData, username: e.target.value })} required placeholder="Choose a username" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={signupData.email} onChange={(e) => setSignupData({ ...signupData, email: e.target.value })} required placeholder="Enter your email" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={signupData.password} onChange={(e) => setSignupData({ ...signupData, password: e.target.value })} required placeholder="Min 6 characters" />
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input type="password" value={signupData.confirmPassword} onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })} required placeholder="Confirm password" />
              </div>
              <div className="form-group">
                <label>Security Question</label>
                <select value={signupData.security_question} onChange={(e) => setSignupData({ ...signupData, security_question: e.target.value })}>
                  {SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Security Answer</label>
                <input type="text" value={signupData.security_answer} onChange={(e) => setSignupData({ ...signupData, security_answer: e.target.value })} required placeholder="Used for password recovery" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', padding: 14, marginTop: 8 }}>
                {loading ? 'Creating Account...' : 'Create Admin Account'}
              </button>
            </form>
          )}

          {/* ── FORGOT PASSWORD ── */}
          {activeTab === 'forgot' && (
            <>
              {forgotStep === 1 && (
                <form onSubmit={handleFetchQuestion}>
                  <div className="form-group">
                    <label>Username</label>
                    <input type="text" value={forgotData.username} onChange={(e) => setForgotData({ ...forgotData, username: e.target.value })} required placeholder="Enter your admin username" />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', padding: 14, marginTop: 8 }}>
                    {loading ? 'Looking up...' : 'Find My Account'}
                  </button>
                </form>
              )}
              {forgotStep === 2 && (
                <form onSubmit={handleResetPassword}>
                  <div className="alert-info" style={{ marginBottom: 16 }}>
                    <strong>Security Question:</strong><br />{securityQuestion}
                  </div>
                  <div className="form-group">
                    <label>Security Answer</label>
                    <input type="text" value={forgotData.security_answer} onChange={(e) => setForgotData({ ...forgotData, security_answer: e.target.value })} required placeholder="Your answer" />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={forgotData.email} onChange={(e) => setForgotData({ ...forgotData, email: e.target.value })} required placeholder="Registered email" />
                  </div>
                  <div className="form-group">
                    <label>New Password</label>
                    <input type="password" value={forgotData.new_password} onChange={(e) => setForgotData({ ...forgotData, new_password: e.target.value })} required placeholder="Min 6 characters" />
                  </div>
                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input type="password" value={forgotData.confirm_password} onChange={(e) => setForgotData({ ...forgotData, confirm_password: e.target.value })} required placeholder="Confirm new password" />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, padding: 14 }}>
                      {loading ? 'Resetting...' : 'Reset Password'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => { setForgotStep(1); clearMessages(); }} style={{ padding: '14px 20px' }}>Back</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <div className="site-footer">
        VoteSecure © {new Date().getFullYear()} — Smart Digital Voting Platform Using Facial Recognition
      </div>
    </div>
  );
}

export default AdminLoginPage;
