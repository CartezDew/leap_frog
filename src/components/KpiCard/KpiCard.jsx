export function KpiCard({ label, value, sub, accent, trend, trendDirection }) {
  const className = `kpi${accent ? ` kpi--${accent}` : ''}`;
  return (
    <div className={className}>
      <p className="kpi__label">{label}</p>
      <p className="kpi__value">{value}</p>
      {sub && <p className="kpi__sub">{sub}</p>}
      {trend && (
        <span
          className={`kpi__trend kpi__trend--${
            trendDirection === 'down' ? 'down' : 'up'
          }`}
        >
          {trend}
        </span>
      )}
    </div>
  );
}
