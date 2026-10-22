export default function AuthModal({ isOpen, isSignUp, onClose, onToggleMode, onSubmit, loading, username, password, onUsernameChange, onPasswordChange }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-modal" onClick={onClose}>&times;</button>
        <h2>{isSignUp ? 'Sign Up' : 'Sign In'}</h2>
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        <input
          type="password"
          placeholder={isSignUp ? 'Password (min 6 characters)' : 'Password'}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        <button className="btn-primary" onClick={onSubmit} disabled={loading}>
          {loading ? <span className="loading-spinner" /> : (isSignUp ? 'Sign Up' : 'Sign In')}
        </button>
        <button className="btn-secondary" onClick={onToggleMode}>
          {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
        </button>
      </div>
    </div>
  );
}
