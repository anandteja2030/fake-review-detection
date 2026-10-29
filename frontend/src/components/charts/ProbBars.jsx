/**
 * Binary class probabilities from the real model response.
 * The trained classifier has exactly two classes (Fake, Genuine):
 * there is no Suspicious class, so none is fabricated here.
 */
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

export default function ProbBars({ probabilities }) {
  if (!probabilities) return null;
  const fake = clamp01(probabilities.fake);
  const genuine = probabilities.genuine != null ? clamp01(probabilities.genuine) : 1 - fake;
  const rows = [
    { label: 'Fake', value: fake, color: 'var(--fake)' },
    { label: 'Genuine', value: genuine, color: 'var(--genuine)' }
  ];
  const sum = Math.round((fake + genuine) * 1000) / 10;
  return (
    <div>
      {rows.map(({ label, value, color }) => {
        const pct = Math.round(value * 1000) / 10;
        return (
          <div className="prob-row" key={label}>
            <div className="prob-head">
              <span>{label}</span>
              <span style={{ color }}>{pct}%</span>
            </div>
            <div className="prob-track">
              <div className="prob-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
      <p className="prob-note">
        Binary classifier — two classes only. P(fake) + P(genuine) = {sum}%
        {' '}(rounding may apply). No Suspicious class exists in this model.
      </p>
    </div>
  );
}
