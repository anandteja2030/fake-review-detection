import StateBlock from './StateBlock.jsx';

/**
 * Chart surface: header chrome, an inset plot well, and an optional footnote.
 * The well provides the layered depth (tint + inner highlight + shadow) so
 * charts sit inside glass rather than on a flat card.
 */
export default function ChartCard({
  title,
  subtitle,
  loading,
  error,
  children,
  height = 260,
  actions,
  footnote,
  badge,
  className = ''
}) {
  return (
    <div className={`card chart-card ${className}`.trim()}>
      <div className={`chart-head${subtitle || actions ? '' : ' tight'}`}>
        <div className="chart-head-text">
          {title && (
            <div className="card-title chart-title">
              {title}
              {badge && <span className="chart-badge">{badge}</span>}
            </div>
          )}
          {subtitle && <div className="card-sub chart-sub">{subtitle}</div>}
        </div>
        {actions}
      </div>

      {loading ? (
        <div className="chart-well" style={{ height }}>
          <div className="skeleton" style={{ height: '100%' }} />
        </div>
      ) : error ? (
        <StateBlock kind="error" title="Could not load data">{error.message}</StateBlock>
      ) : (
        <div className="chart-well" style={{ height }}>{children}</div>
      )}

      {footnote && <p className="chart-foot">{footnote}</p>}
    </div>
  );
}
