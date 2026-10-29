import { useCountUp } from '../../hooks/useCountUp.js';

export default function StatCard({ label, value, hint, color }) {
  const animated = useCountUp(typeof value === 'number' ? value : null);
  const shown = typeof value === 'number' && animated != null
    ? (Number.isInteger(value) ? Math.round(animated) : animated.toFixed(1))
    : value;
  return (
    <div className="card stat-card hoverable lit" style={{ '--stat-color': color || 'var(--accent)' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{shown ?? '—'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
