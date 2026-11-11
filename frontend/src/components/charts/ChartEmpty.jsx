/**
 * Designed empty state for a chart slot.
 * Used instead of a bare "no data" string so an empty chart still reads as a
 * finished surface rather than a broken component.
 */
export default function ChartEmpty({ height = 240, title = 'No data recorded yet', hint, icon }) {
  return (
    <div className="chart-empty" style={{ minHeight: height }} role="status">
      <span className="chart-empty-glyph" aria-hidden="true">
        {icon || (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" strokeLinecap="round" />
            <path d="M2.5 19h19" strokeLinecap="round" opacity="0.5" />
          </svg>
        )}
      </span>
      <span className="chart-empty-title">{title}</span>
      {hint && <span className="chart-empty-hint">{hint}</span>}
    </div>
  );
}
