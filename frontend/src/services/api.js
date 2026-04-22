import axios from 'axios';

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || window.location.origin;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${API_ORIGIN}/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add token to requests
api.interceptors.request.use((config) => {
  // Use adminToken for admin routes, regular token for others
  const isAdminRoute = config.url?.includes('/admin');
  const token = isAdminRoute
    ? localStorage.getItem('adminToken')
    : (localStorage.getItem('token') || localStorage.getItem('adminToken'));
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth APIs
export const registerVoter = async (formData) => {
  const response = await api.post('/auth/register', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const verifyDetails = async (name, fathers_name, voter_id, voterIdProofFile) => {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('fathers_name', fathers_name);
  formData.append('voter_id', voter_id);
  formData.append('voter_id_proof', voterIdProofFile, voterIdProofFile.name);
  const response = await api.post('/auth/verify-details', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000, // 90 seconds — OCR processing can take time on first run
  });
  return response.data;
};

export const validateVoterCard = async (voterIdProofFile) => {
  const formData = new FormData();
  formData.append('voter_id_proof', voterIdProofFile, voterIdProofFile.name);
  const response = await api.post('/auth/validate-voter-card', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000,
  });
  return response.data;
};

export const verifyFace = async (formData) => {
  const response = await api.post('/auth/verify-face', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const verifyLivenessProof = async ({ voterId, purpose, blinkCount, imageBlob }) => {
  const formData = new FormData();
  formData.append('voter_id', voterId);
  formData.append('purpose', purpose);
  formData.append('blink_count', String(blinkCount));
  formData.append('live_image', imageBlob, 'liveness.jpg');
  const response = await api.post('/auth/liveness/verify', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const updateVoterFace = async (formData) => {
  const response = await api.post('/auth/update-face', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const checkFaceMatch = async (faceImageBlob, voterIdProofFile) => {
  const formData = new FormData();
  formData.append('face_image', faceImageBlob, 'face.jpg');
  formData.append('voter_id_proof', voterIdProofFile, voterIdProofFile.name);
  const response = await api.post('/auth/check-face-match', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const adminLogin = async (credentials) => {
  const response = await api.post('/auth/admin/login', credentials);
  return response.data;
};

export const createAdmin = async (formData) => {
  const response = await api.post('/auth/admin/create', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const adminSignup = async (data) => {
  const response = await api.post('/auth/admin/signup', data);
  return response.data;
};

export const getSecurityQuestion = async (username) => {
  const response = await api.get(`/auth/admin/security-question?username=${encodeURIComponent(username)}`);
  return response.data;
};

export const adminForgotPassword = async (data) => {
  const response = await api.post('/auth/admin/forgot-password', data);
  return response.data;
};

// Voting APIs
export const getCandidates = async () => {
  const response = await api.get('/voting/candidates');
  return response.data;
};

export const getElectionStatus = async () => {
  const response = await api.get('/voting/election-status');
  return response.data;
};

export const castVote = async (candidateId) => {
  const response = await api.post('/voting/vote', { candidate_id: candidateId });
  return response.data;
};

export const getVoterStatus = async () => {
  const response = await api.get('/voting/my-status');
  return response.data;
};

// Admin APIs
export const createCandidate = async (formData) => {
  const response = await api.post('/admin/candidates', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const getAllCandidates = async () => {
  const response = await api.get('/admin/candidates');
  return response.data;
};

export const deleteCandidate = async (candidateId) => {
  const response = await api.delete(`/admin/candidates/${candidateId}`);
  return response.data;
};

export const getAllVoters = async () => {
  const response = await api.get('/admin/voters');
  return response.data;
};

export const createElection = async (electionData) => {
  const response = await api.post('/admin/elections', electionData);
  return response.data;
};

export const getAllElections = async () => {
  const response = await api.get('/admin/elections');
  return response.data;
};

export const toggleElection = async (electionId) => {
  const response = await api.put(`/admin/elections/${electionId}/toggle`);
  return response.data;
};

export const deleteElection = async (electionId) => {
  const response = await api.delete(`/admin/elections/${electionId}`);
  return response.data;
};

export const getVotingResults = async () => {
  const response = await api.get('/admin/results');
  return response.data;
};

export const getPublicResults = async () => {
  const response = await api.get('/voting/public-results');
  return response.data;
};

export const saveLotWinner = async (electionId, winnerName) => {
  const response = await api.post(`/admin/elections/${electionId}/set-lot-winner`, { winner_name: winnerName });
  return response.data;
};

export const getStatistics = async () => {
  const response = await api.get('/admin/statistics');
  return response.data;
};

export const resetVotes = async () => {
  const response = await api.post('/admin/reset-votes');
  return response.data;
};

export default api;
export { API_ORIGIN, API_BASE_URL };
