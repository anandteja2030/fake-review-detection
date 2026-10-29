import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';

export default function BarByKey({ data, xKey, yKey = 'value', colors, height = 260, unit = '', horizontal = false }) {
  const hasData = data.some((d) => d[yKey] > 0);
  if (!hasData) {
    return <div style={{ height, display: 'grid', placeItems: 'center' }} className="faint small">No data yet — charts populate after real analyses.</div>;
  }
  const gradAxis = horizontal ? 'x' : 'y';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'}
        margin={horizontal ? { top: 8, right: 16, left: 8, bottom: 0 } : { top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {data.map((d, i) => {
            const c = colors ? colors[i % colors.length] : 'var(--accent)';
            return (
              <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2={gradAxis === 'x' ? '1' : '0'} y2={gradAxis === 'x' ? '0' : '1'}>
                <stop offset="0%" stopColor={c} stopOpacity={0.98} />
                <stop offset="100%" stopColor={c} stopOpacity={0.42} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey={xKey} width={190} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatter={(v) => `${v}${unit}`} />} cursor={{ fill: 'var(--accent-soft)' }} />
        <Bar dataKey={yKey} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={46}>
          {data.map((d, i) => <Cell key={i} fill={`url(#bar-grad-${i})`} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
