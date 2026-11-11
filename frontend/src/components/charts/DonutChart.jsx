import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';
import ChartEmpty from './ChartEmpty.jsx';

const share = (value, total) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0);

/**
 * Glass donut for a categorical split.
 * The legend is rendered as data rows (count + share) rather than Recharts'
 * default legend, so the numbers stay readable at every width.
 */
export default function DonutChart({ data = [], height = 260, centerLabel, centerValue, unit = '' }) {
  const items = (data || []).filter((d) => Number(d.value) > 0);
  const total = items.reduce((sum, d) => sum + Number(d.value), 0);

  if (!total) {
    return (
      <ChartEmpty
        height={height}
        title="No distribution recorded"
        hint="This splits once analyses exist for the field."
      />
    );
  }

  return (
    <div className="donut" style={{ height }}>
      <div className="donut-plot">
        <span className="donut-halo" aria-hidden="true" />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius="65%"
              outerRadius="94%"
              paddingAngle={2.5}
              cornerRadius={7}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              /* Recharts never resolves its animation end here, which freezes
                 the sectors at their start radius. Entrance motion is handled
                 by the CSS rise on .chart-well. */
              isAnimationActive={false}
            >
              {items.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip
              content={<ChartTooltip formatter={(v) => `${v}${unit ? ` ${unit.trim()}` : ''} · ${share(v, total)}%`} />}
            />
          </PieChart>
        </ResponsiveContainer>

        {(centerValue !== undefined || centerLabel) && (
          <div className="donut-center" aria-hidden="true">
            <span className="donut-center-v">{centerValue ?? total}</span>
            {centerLabel && <span className="donut-center-k">{centerLabel}</span>}
          </div>
        )}
      </div>

      <ul className="donut-legend">
        {items.map((d) => (
          <li key={d.name}>
            <i style={{ background: d.color, boxShadow: `0 0 9px ${d.color}` }} />
            <span className="dl-name">{d.name}</span>
            <span className="dl-val">{d.value}{unit}</span>
            <span className="dl-pct">{share(d.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
