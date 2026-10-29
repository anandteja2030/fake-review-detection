import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip.jsx';

export default function DonutChart({ data, height = 260, centerLabel, centerValue }) {
  const hasData = data.some((d) => d.value > 0);
  if (!hasData) {
    return <div style={{ height, display: 'grid', placeItems: 'center' }} className="faint small">No data yet — charts populate after real analyses.</div>;
  }
  return (
    <div style={{ height, position: 'relative' }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3} strokeWidth={0}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12.5, color: 'var(--text-muted)' }} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', paddingBottom: 30 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800 }}>{centerValue}</div>
            {centerLabel && <div className="faint" style={{ fontSize: 11 }}>{centerLabel}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
