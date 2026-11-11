export default function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="q-tooltip">
      {label !== undefined && <div className="q-tooltip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="q-tooltip-row">
          <span className="q-tooltip-key" style={{ background: p.color || p.fill }} />
          <span className="q-tooltip-name">{p.name}:</span>
          <span className="q-tooltip-val">{formatter ? formatter(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
