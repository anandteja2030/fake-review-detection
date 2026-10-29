
export default function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'linear-gradient(160deg, rgba(10, 17, 36, 0.92), rgba(6, 11, 26, 0.88))',
      backdropFilter: 'blur(14px) saturate(150%)',
      border: '1px solid rgba(56, 200, 255, 0.3)',
      borderRadius: 10, padding: '9px 12px', fontSize: 12.5,
      boxShadow: '0 12px 34px rgba(1, 4, 12, 0.7), 0 0 22px rgba(34, 211, 238, 0.14)',
      color: 'var(--text)', pointerEvents: 'auto'
    }}>
      {label !== undefined && <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{formatter ? formatter(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
