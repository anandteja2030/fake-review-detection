import { useCountUp } from '../../hooks/useCountUp.js';

export default function StatCard({ label, value, hint, color, icon: Icon }) {
  const animated = useCountUp(typeof value === 'number' ? value : null);
  const shown = typeof value === 'number' && animated != null
    ? (Number.isInteger(value) ? Math.round(animated) : animated.toFixed(1))
    : value;
  return (
    <div className="card kpi hoverable" style={{ '--kpi-color': color || 'var(--accent)' }}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {Icon && <span className="kpi-icon"><Icon /></span>}
      </div>
      <div className="kpi-value">{shown ?? '—'}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
