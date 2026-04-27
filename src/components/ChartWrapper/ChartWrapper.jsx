import { ResponsiveContainer } from 'recharts';

export function ChartWrapper({ title, subtitle, height = 280, children }) {
  return (
    <div className="chart-wrap">
      {title && <h3 className="chart-wrap__title">{title}</h3>}
      {subtitle && <p className="chart-wrap__sub">{subtitle}</p>}
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
