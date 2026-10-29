import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';

export default function TrendLine({ data, yKeys, height = 260, yDomain }) {
  if (!data.length) {
    return <div style={{ height, display: 'grid', placeItems: 'center' }} className="faint small">No data yet — charts populate after real analyses.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <defs>
          {yKeys.map((k, i) => (
            <linearGradient key={k.key} id={`trend-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={k.color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={k.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
          <filter id="line-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={yDomain || ['auto', 'auto']} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(56, 200, 255, 0.4)', strokeDasharray: '3 3' }} />
        {yKeys.map((k, i) => (
          <Area key={k.key} type="monotone" dataKey={k.key} name={k.name} stroke="none"
            fill={`url(#trend-fill-${i})`} isAnimationActive animationDuration={900} />
        ))}
        {yKeys.map((k) => (
          <Line key={`l-${k.key}`} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} strokeWidth={2.4}
            dot={{ r: 2.5, strokeWidth: 0, fill: k.color }} activeDot={{ r: 4.5 }}
            filter="url(#line-glow)" isAnimationActive animationDuration={900} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
