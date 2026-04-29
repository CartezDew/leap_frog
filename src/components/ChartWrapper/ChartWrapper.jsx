import { ResponsiveContainer } from 'recharts';

const DEFAULT_MIN_ROWS_FOR_CHART_EXPORT = 5;

export function ChartWrapper({
  title,
  subtitle,
  height = 280,
  toolbar,
  /** With `toolbar`, pass the number of data rows/points; the export dock shows only when this is strictly greater than `minRowsForChartExport` (default 5 → 6+). */
  chartExportRowCount,
  minRowsForChartExport = DEFAULT_MIN_ROWS_FOR_CHART_EXPORT,
  children,
}) {
  const hasHead = Boolean(title || subtitle);
  const showExportDock = Boolean(
    toolbar &&
      chartExportRowCount != null &&
      chartExportRowCount > minRowsForChartExport,
  );
  return (
    <div className="chart-wrap">
      {hasHead && (
        <div className="chart-wrap__head">
          <div className="chart-wrap__head-copy">
            {title && <h3 className="chart-wrap__title">{title}</h3>}
            {subtitle && <p className="chart-wrap__sub">{subtitle}</p>}
          </div>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
      {showExportDock ? (
        <div className="chart-wrap__export-dock">
          <span className="chart-wrap__export-label">Download</span>
          {toolbar}
        </div>
      ) : null}
    </div>
  );
}
