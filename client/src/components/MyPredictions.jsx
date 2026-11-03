export default function MyPredictions({ predictions, races, isGuest }) {
  return (
    <div className="card">
      <div className="card-title">
        <i className="fas fa-list-ul" /> My predictions
        <span className="badge-pill">{isGuest ? `guest · ${predictions.length}` : `${predictions.length} this season`}</span>
      </div>
      <div className="prediction-list">
        {predictions.length === 0 ? (
          <div className="empty-state"><i className="far fa-hourglass" /> No predictions yet</div>
        ) : (
          predictions.map((p) => {
            const race = races.find((r) => r.id === p.raceId);
            return (
              <div key={`${p.raceId}-${p.driverId}`} className="prediction-item">
                <span className="race-name">{race?.flag || '🏁'} {race?.name || 'Unknown Race'}</span>
                <span className="pick">
                  {p.driverCode || '???'}
                  {p.actualPosition === 1 && ' ✓'}
                  {p.scored > 0 && <span className="score-tag">+{p.scored}</span>}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
