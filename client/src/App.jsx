import { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import { useToast, ToastContainer } from './hooks/useToast';
import Header from './components/Header';
import AuthModal from './components/AuthModal';
import PredictionPanel from './components/PredictionPanel';
import LeaderboardPanel from './components/LeaderboardPanel';
import StandingsPanel from './components/StandingsPanel';
import SimulationPanel from './components/SimulationPanel';
import MyPredictions from './components/MyPredictions';
import { FALLBACK_DRIVERS } from './data/drivers';
import { FALLBACK_RACES } from './data/races';

const TABS = ['predict', 'standings', 'simulation'];

export default function App() {
  const [drivers, setDrivers] = useState([]);
  const [races, setRaces] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [driverStandings, setDriverStandings] = useState([]);
  const [constructorStandings, setConstructorStandings] = useState([]);
  const [simulation, setSimulation] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedRace, setSelectedRace] = useState(null);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('predict');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { toasts, showToast, removeToast } = useToast();

  const loadPublicData = useCallback(async ({ silent = false } = {}) => {
    const results = await Promise.allSettled([
      api.getDrivers(),
      api.getRaces(),
      api.getLeaderboard(),
      api.getDriverStandings(),
      api.getConstructorStandings(),
      api.getChampionshipSimulation()
    ]);
    const [driversResult, racesResult, leaderboardResult, driverStandingsResult, constructorStandingsResult, simulationResult] = results;
    const driversData = driversResult.status === 'fulfilled' && driversResult.value.length
      ? driversResult.value
      : FALLBACK_DRIVERS;
    const useFallbackRaces = racesResult.status === 'rejected' || !racesResult.value?.length;
    const racesData = useFallbackRaces
      ? FALLBACK_RACES.map((race) => ({
        ...race,
        // same rule as the server: predictions close when race day starts (00:00 UTC)
        status: new Date(`${race.date}T00:00:00Z`) <= new Date() ? 'locked' : 'upcoming'
      }))
      : racesResult.value;

    setDrivers(driversData);
    setRaces(racesData);
    setLeaderboard(leaderboardResult.status === 'fulfilled' ? leaderboardResult.value : []);
    setDriverStandings(driverStandingsResult.status === 'fulfilled' ? driverStandingsResult.value : []);
    setConstructorStandings(constructorStandingsResult.status === 'fulfilled' ? constructorStandingsResult.value : []);
    setSimulation(simulationResult.status === 'fulfilled' ? simulationResult.value : null);
    const firstOpen = racesData.find((race) => race.status === 'upcoming');
    setSelectedDriver((current) => current || driversData[0]?.id || '');
    setSelectedRace((current) => (
      racesData.some((race) => race.id === current)
        ? current
        : firstOpen?.id ?? racesData[0]?.id ?? null
    ));

    const failedResources = results
      .map((result, index) => result.status === 'rejected'
        ? ['drivers', 'races', 'leaderboard', 'driver standings', 'constructor standings', 'simulation'][index]
        : null)
      .filter(Boolean);
    if (failedResources.length && !silent) {
      showToast(`Failed to load ${failedResources.join(', ')}${useFallbackRaces ? '; showing the season schedule instead' : ''}`, 'error');
    }
  }, [showToast]);

  const loadPredictions = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getUserPredictions();
      setPredictions(data);
    } catch (err) {
      if (err.message !== 'Authentication required') {
        showToast('Failed to load predictions', 'error');
      }
    }
  }, [user, showToast]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        // Corrupted saved login: forget it instead of crashing the whole page
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    loadPublicData();
  }, [loadPublicData]);

  useEffect(() => {
    loadPredictions();
  }, [loadPredictions]);

  // Keep points fresh: results are synced on the server after every GP, so the
  // page re-reads standings/leaderboard every few minutes and when you come back to the tab.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        loadPublicData({ silent: true });
        loadPredictions();
      }
    };
    const timer = setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadPublicData, loadPredictions]);

  // The saved token was rejected by the server (e.g. database was reset) -> sign out cleanly
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setPredictions([]);
      showToast('Your session expired. Please sign in again.', 'error');
      setIsAuthModalOpen(true);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [showToast]);

  const handleAuth = async () => {
    if (!authUsername.trim() || !authPassword) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    if (isSignUp && authPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    setLoading(true);
    try {
      const data = isSignUp
        ? await api.signup(authUsername.trim(), authPassword, authUsername.trim())
        : await api.signin(authUsername.trim(), authPassword);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setAuthPassword('');
      setIsAuthModalOpen(false);
      showToast(`Welcome ${data.user.displayName}!`, 'success');
      loadPublicData();
      loadPredictions();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoading(false);
  };

  const handleSignOut = () => {
    api.signout().catch(() => {}); // invalidate the token on the server (best effort)
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setPredictions([]);
    showToast('Signed out', 'info');
  };

  const handleSubmitPrediction = async () => {
    if (!user) {
      showToast('Please sign in first', 'error');
      setIsAuthModalOpen(true);
      return;
    }
    setLoading(true);
    try {
      const data = await api.submitPrediction(selectedRace, selectedDriver);
      showToast(`Prediction ${data.updated ? 'updated' : 'saved'}!`, 'success');
      loadPredictions();
      loadPublicData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoading(false);
  };

  const handleReset = async () => {
    if (!user || !window.confirm('Reset all your predictions?')) return;
    setLoading(true);
    try {
      const data = await api.deletePredictions();
      showToast(`Reset ${data.count} predictions`, 'info');
      loadPredictions();
      loadPublicData();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoading(false);
  };

  const handleExport = async () => {
    if (!user) {
      showToast('Please sign in to export', 'error');
      return;
    }
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `f1_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="app-container">
      <Header
        user={user}
        onAuthClick={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
      />

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'predict' && <><i className="fas fa-bullseye" /> Predict</>}
            {tab === 'standings' && <><i className="fas fa-chart-bar" /> Standings</>}
            {tab === 'simulation' && <><i className="fas fa-dice" /> Simulation</>}
          </button>
        ))}
      </nav>

      {activeTab === 'predict' && (
        <>
          <div className="predictor-grid">
            <PredictionPanel
              races={races}
              drivers={drivers}
              selectedRace={selectedRace}
              selectedDriver={selectedDriver}
              onRaceChange={setSelectedRace}
              onDriverSelect={setSelectedDriver}
              onSubmit={handleSubmitPrediction}
              loading={loading}
            />
            <LeaderboardPanel leaderboard={leaderboard} user={user} onRefresh={loadPublicData} />
          </div>
          <MyPredictions predictions={predictions} races={races} />
        </>
      )}

      {activeTab === 'standings' && (
        <StandingsPanel driverStandings={driverStandings} constructorStandings={constructorStandings} />
      )}

      {activeTab === 'simulation' && <SimulationPanel simulation={simulation} />}

      {user && (
        <div className="footer-actions">
          <div className="footer-buttons">
            <button className="btn-secondary" onClick={handleReset}><i className="fas fa-undo-alt" /> Reset</button>
            <button className="btn-secondary" onClick={handleExport}><i className="fas fa-download" /> Export</button>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <AuthModal
        isOpen={isAuthModalOpen}
        isSignUp={isSignUp}
        onClose={() => setIsAuthModalOpen(false)}
        onToggleMode={() => setIsSignUp(!isSignUp)}
        onSubmit={handleAuth}
        loading={loading}
        username={authUsername}
        password={authPassword}
        onUsernameChange={setAuthUsername}
        onPasswordChange={setAuthPassword}
      />
    </div>
  );
}
