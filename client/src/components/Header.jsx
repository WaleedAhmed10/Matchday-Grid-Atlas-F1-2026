export default function Header({ user, onAuthClick, onSignOut }) {
  return (
    <header className="app-header">
      <div className="logo-area">
        <i className="fas fa-flag-checkered" />
        <div>
          <div className="logo-title-row">
            <h1>Matchday Atlas Grid</h1>
            <span>2026</span>
          </div>
          <div className="brand-tag">A Matchday Atlas project · F1 2026</div>
          <p className="legal-disclaimer">Unofficial fan predictor. Not affiliated with Formula 1 or the FIA.</p>
        </div>
      </div>
      <div className="auth-section">
        <div className="user-badge" onClick={onAuthClick}>
          <i className="fas fa-user" />
          <span>{user ? user.displayName || user.username : 'Guest'}</span>
        </div>
        <button className="btn-outline" onClick={user ? onSignOut : onAuthClick}>
          {user ? 'Sign Out' : 'Sign In'}
        </button>
      </div>
    </header>
  );
}
