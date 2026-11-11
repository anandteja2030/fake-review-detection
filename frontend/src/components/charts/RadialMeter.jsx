import { useEffect, useState } from 'react';
import { useChartMotion } from './useChartMotion.js';

/**
 * Circular metric meter (radial indicator).
 * Purely presentational: the number shown is always the value passed in, so a
 * probability is never re-scaled or re-labelled as something else.
 */
export default function RadialMeter({
  value,
  max = 100,
  label,
  caption,
  color = 'var(--accent)',
  size = 108,
  thickness = 9,
  suffix = '%',
  digits = 1,
  muted = false
}) {
  const animate = useChartMotion();
  const numeric = Number.isFinite(Number(value)) ? Number(value) : null;
  const pct = numeric == null ? 0 : Math.max(0, Math.min(1, numeric / max));

  // Start at zero and transition once, so the ring sweeps in on mount.
  const [shown, setShown] = useState(animate ? 0 : pct);
  useEffect(() => {
    if (!animate) { setShown(pct); return undefined; }
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [animate, pct]);

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      className={`radial-meter${muted ? ' muted' : ''}`}
      style={{ '--meter-color': color, '--meter-size': `${size}px` }}
    >
      <div className="radial-dial">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label || 'value'}: ${numeric == null ? 'unavailable' : `${numeric}${suffix}`}`}>
          <circle className="radial-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} />
          <circle
            className="radial-fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
          />
        </svg>
        <span className="radial-value">
          {numeric == null ? '—' : `${numeric.toFixed(digits).replace(/\.0$/, '')}${suffix}`}
        </span>
      </div>
      {label && <span className="radial-label">{label}</span>}
      {caption && <span className="radial-caption">{caption}</span>}
    </div>
  );
}
