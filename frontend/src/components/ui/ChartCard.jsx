import StateBlock from './StateBlock.jsx';

export default function ChartCard({ title, subtitle, loading, error, children, height = 260, actions }) {
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: subtitle || actions ? 12 : 0 }}>
        <div>
          {title && <div className="card-title">{title}</div>}
          {subtitle && <div className="card-sub" style={{ marginBottom: 0 }}>{subtitle}</div>}
        </div>
        {actions}
      </div>
      {loading ? (
        <div style={{ height }}>
          <div className="skeleton" style={{ height: '100%' }} />
        </div>
      ) : error ? (
        <StateBlock kind="error" title="Could not load data">{error.message}</StateBlock>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </div>
  );
}
