import { useId } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';
import ChartEmpty from './ChartEmpty.jsx';

/**
 * Single-series bar chart with a soft background track.
 * `horizontal` is used for long category names; value labels are drawn only
 * when there is room, so the plot never turns into a wall of numbers.
 */
export default function BarByKey({
  data = [],
  xKey,
  yKey = 'value',
  colors,
  height = 260,
  unit = '',
  horizontal = false,
  showValues
}) {
  // Unique per instance: two bar charts on one page must not share SVG ids,
  // otherwise a gradient reference can resolve to the other chart's defs.
  const uid = useId().replace(/:/g, '');
  const hasData = data.some((d) => Number(d[yKey]) > 0);
  const label = showValues ?? (horizontal && data.length <= 8);

  if (!hasData) {
    return (
      <ChartEmpty
        height={height}
        title="No values recorded"
        hint="Bars fill in as analyses are added."
      />
    );
  }

  const gradAxis = horizontal ? 'x' : 'y';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={horizontal ? { top: 4, right: 26, left: 4, bottom: 0 } : { top: 14, right: 8, left: -18, bottom: 0 }}
        barCategoryGap="26%"
      >
        <defs>
          {data.map((d, i) => {
            const c = colors ? colors[i % colors.length] : 'var(--accent)';
            return (
              <linearGradient key={i} id={`${uid}-bar-${i}`} x1="0" y1="0" x2={gradAxis === 'x' ? '1' : '0'} y2={gradAxis === 'x' ? '0' : '1'}>
                <stop offset="0%" stopColor={c} stopOpacity={0.98} />
                <stop offset="100%" stopColor={c} stopOpacity={0.38} />
              </linearGradient>
            );
          })}
        </defs>

        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />

        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} tickMargin={4} />
            <YAxis type="category" dataKey={xKey} width={190} tick={{ fontSize: 11.5, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11.5, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} tickMargin={7} interval={0} />
            <YAxis tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} tickMargin={4} />
          </>
        )}

        <Tooltip content={<ChartTooltip formatter={(v) => `${v}${unit}`} />} cursor={{ fill: 'var(--accent-soft)', radius: 8 }} />

        <Bar
          dataKey={yKey}
          radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]}
          maxBarSize={horizontal ? 26 : 46}
          /* Recharts never fires its animation-end callback in this app, which
             also gates LabelList — so the value labels would silently vanish.
             Entrance motion comes from the CSS rise on .chart-well instead. */
          isAnimationActive={false}
        >
          {data.map((d, i) => <Cell key={i} fill={`url(#${uid}-bar-${i})`} />)}
          {label && (
            <LabelList
              dataKey={yKey}
              position={horizontal ? 'right' : 'top'}
              offset={8}
              style={{ fill: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
