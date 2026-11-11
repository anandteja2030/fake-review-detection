import { useId } from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';
import ChartEmpty from './ChartEmpty.jsx';

/**
 * Trend / cumulative line chart.
 * A yKey may set `axis: 'right'` when its scale differs from the primary series
 * (for example a 0–100 trust score next to a running total), so both stay legible.
 */
export default function TrendLine({ data = [], yKeys = [], height = 260, yDomain, valueSuffix = '' }) {
  const uid = useId().replace(/:/g, '');
  const hasRight = yKeys.some((k) => k.axis === 'right');
  const dense = data.length > 24;

  if (!data.length) {
    return (
      <ChartEmpty
        height={height}
        title="Nothing to plot yet"
        hint="Series appear after the first recorded analyses."
      />
    );
  }

  return (
    <div className="trend-chart" style={{ height }}>
    <div className="trend-plot" style={{ height: Math.max(80, height - 24) }}>
    <ResponsiveContainer width="100%" height="100%">
      {/* The right margin must clear the last category tick, otherwise the
          final label is cut off at the plot edge on dense timelines. */}
      <ComposedChart data={data} margin={{ top: 10, right: hasRight ? 22 : 14, left: -16, bottom: 0 }}>
        <defs>
          {yKeys.map((k) => (
            <linearGradient key={k.key} id={`${uid}-fill-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={k.color} stopOpacity={0.3} />
              <stop offset="72%" stopColor={k.color} stopOpacity={0.05} />
              <stop offset="100%" stopColor={k.color} stopOpacity={0} />
            </linearGradient>
          ))}
          <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }}
          axisLine={{ stroke: 'var(--chart-grid)' }}
          tickLine={false}
          tickMargin={7}
          minTickGap={dense ? 18 : 6}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }}
          axisLine={false}
          tickLine={false}
          domain={yDomain || [0, 'auto']}
          tickMargin={4}
          width={38}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
            tickMargin={4}
            width={34}
          />
        )}

        <Tooltip
          content={<ChartTooltip formatter={(v) => `${v}${valueSuffix}`} />}
          cursor={{ stroke: 'rgba(56, 200, 255, 0.4)', strokeDasharray: '3 3' }}
        />

        {yKeys.map((k) => (
          <Area
            key={k.key}
            yAxisId={k.axis === 'right' ? 'right' : 'left'}
            type="monotone"
            dataKey={k.key}
            name={k.name}
            stroke="none"
            fill={`url(#${uid}-fill-${k.key})`}
            isAnimationActive={false}
          />
        ))}

        {yKeys.map((k) => (
          <Line
            key={`l-${k.key}`}
            yAxisId={k.axis === 'right' ? 'right' : 'left'}
            type="monotone"
            dataKey={k.key}
            name={k.name}
            stroke={k.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            dot={dense ? false : { r: 3, strokeWidth: 0, fill: k.color }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg)', fill: k.color }}
            filter={`url(#${uid}-glow)`}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
    <ul className="trend-key">
      {yKeys.map((k) => (
        <li key={k.key}>
          <i style={{ background: k.color, boxShadow: `0 0 8px ${k.color}` }} />
          {k.name}
          {k.axis === 'right' && <span className="trend-key-axis">right axis</span>}
        </li>
      ))}
    </ul>
    </div>
  );
}
