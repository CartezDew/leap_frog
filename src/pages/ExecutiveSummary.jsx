import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { LuTriangleAlert, LuArrowRight, LuSearch } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiStrip } from '../components/KpiStrip/KpiStrip.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { TrustScore } from '../components/TrustScore/TrustScore.jsx';
import { AnomalyList } from '../components/AnomalyList/AnomalyList.jsx';
import { AccuracyCheck } from '../components/AccuracyCheck/AccuracyCheck.jsx';
import { TopInsightsTable } from '../components/TopInsightsTable/TopInsightsTable.jsx';
import { BotAlertBanner } from '../components/BotAlertBanner/BotAlertBanner.jsx';
import { useData } from '../context/DataContext.jsx';
import { runKeywordAnalysis } from '../lib/keywordAnalyzer.js';
import { formatInteger } from '../lib/formatters.js';

// ---------------------------------------------------------------------------
// Monthly trend chart — helpers & sub-components
// ---------------------------------------------------------------------------

const TREND_COLORS = {
  bar: '#522e91',
  barTopSessions: '#9aca3c',
  barHover: '#f59e0b',
  barAnomaly: '#fbbf24',
  line: '#dc2626',
};

// Custom hover tooltip — formats sessions with comma separators and shows
// both metrics together so the user can scan side-by-side.
function MonthlyTrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="exec-trend-tt">
      <p className="exec-trend-tt__title">{label}</p>
      <p className="exec-trend-tt__row">
        <span className="exec-trend-tt__swatch exec-trend-tt__swatch--sessions" aria-hidden="true" />
        <span className="exec-trend-tt__label">Sessions</span>
        <span className="exec-trend-tt__value">{point.sessions.toLocaleString('en-US')}</span>
      </p>
      <p className="exec-trend-tt__row">
        <span className="exec-trend-tt__swatch exec-trend-tt__swatch--bounce" aria-hidden="true" />
        <span className="exec-trend-tt__label">Bounce %</span>
        <span className="exec-trend-tt__value">{point.bouncePct}%</span>
      </p>
      {point.isTopSessions && (
        <p className="exec-trend-tt__pin">★ Top sessions month for the year</p>
      )}
      {point.isTopBounce && (
        <p className="exec-trend-tt__pin exec-trend-tt__pin--bounce">★ Highest bounce rate this year</p>
      )}
    </div>
  );
}

// Custom dot for the bounce line — enlarged & ringed for the top-bounce
// month so it draws the eye even before the user interacts with the chart.
function BounceDot(topIdx) {
  return function RenderBounceDot(props) {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return null;
    const isTop = index === topIdx;
    return (
      <g key={`bounce-dot-${index}`}>
        {isTop && (
          <circle cx={cx} cy={cy} r={9} fill={TREND_COLORS.line} opacity={0.18} />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isTop ? 5.5 : 3}
          fill={TREND_COLORS.line}
          stroke="#ffffff"
          strokeWidth={isTop ? 2 : 1}
        />
      </g>
    );
  };
}

function MonthlyTrendHighlights({ topSessions, topBounce }) {
  const highlightItems = [
    topSessions && {
      key: 'sessions',
      label: 'Peak sessions',
      month: topSessions.month,
      value: formatInteger(topSessions.sessions),
      note: `${topSessions.bouncePct}% bounce`,
    },
    topBounce && {
      key: 'bounce',
      label: 'Highest bounce',
      month: topBounce.month,
      value: `${topBounce.bouncePct}%`,
      note: `${formatInteger(topBounce.sessions)} sessions`,
    },
  ].filter(Boolean);

  return (
    <div className="exec-trend-panel" aria-label="Monthly trend legend and peak months">
      <div className="exec-trend-panel__eyebrow">Peaks to watch</div>
      <div className="exec-trend-panel__highlights">
        {highlightItems.map((item) => (
          <div
            className={`exec-trend-peak exec-trend-peak--${item.key}`}
            key={item.key}
          >
            <span className="exec-trend-peak__marker" aria-hidden="true" />
            <span className="exec-trend-peak__copy">
              <span className="exec-trend-peak__label">{item.label}</span>
              <strong>
                {item.month}
                <span>{item.value}</span>
              </strong>
              <small>{item.note}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="exec-trend-panel__legend" aria-label="Chart legend">
        <span><i className="exec-trend-legend__bar" aria-hidden="true" /> Sessions</span>
        <span><i className="exec-trend-legend__bar exec-trend-legend__bar--peak" aria-hidden="true" /> Peak sessions</span>
        <span><i className="exec-trend-legend__bar exec-trend-legend__bar--outlier" aria-hidden="true" /> Outlier</span>
        <span><i className="exec-trend-legend__line" aria-hidden="true" /> Bounce %</span>
        <span><i className="exec-trend-legend__dot" aria-hidden="true" /> Peak bounce</span>
      </div>
    </div>
  );
}

// Semrush-only Overview: when the user has uploaded Semrush PDFs but no GA4
// workbook, the GA4 KPI strip / monthly trend / trust score have nothing to
// show. Surface a focused Semrush snapshot instead so the page is still
// useful at-a-glance, with a clear CTA to upload GA4 to unlock the rest.
function sourceCountLabel(sourceFiles, fallbackFilename) {
  const count = Array.isArray(sourceFiles) && sourceFiles.length > 0
    ? sourceFiles.length
    : fallbackFilename
      ? 1
      : 0;
  return `Connected (${count})`;
}

function sourceTitle(sourceFiles, fallbackFilename) {
  const names = Array.isArray(sourceFiles)
    ? sourceFiles.map((file) => file.filename).filter(Boolean)
    : [];
  return names.length > 0 ? names.join('\n') : fallbackFilename || 'No connected source files';
}

function SemrushOnlyOverview({ analyzed, filename, uploadedAt, sourceFiles }) {
  const kw = runKeywordAnalysis(analyzed);
  const latest = kw.trend.national[kw.trend.national.length - 1];
  const syncedLabel = uploadedAt
    ? `Synced ${new Date(uploadedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`
    : 'Live data';

  return (
    <>
      <PageHeader
        badge={syncedLabel}
        title="Overview"
        subtitle="Semrush snapshot — upload a GA4 Excel report to unlock the full executive dashboard."
        meta={
          filename ? (
            <Link
              to="/upload"
              className="page-meta__stamp"
              title={sourceTitle(sourceFiles, filename)}
              aria-label="Open Upload / Replace Data for connected source files"
            >
              Source
              <strong>{sourceCountLabel(sourceFiles, filename)}</strong>
            </Link>
          ) : null
        }
      />

      <div className="card-grid card-grid--cols-3">
        <KpiCard
          label="Keywords tracked"
          value={formatInteger(latest?.tracked || 0)}
          sub={`${formatInteger(latest?.ranked || 0)} ranked in top 100`}
          accent="purple"
        />
        <KpiCard
          label="Page-1 keywords"
          value={formatInteger(latest?.top10 || 0)}
          sub={`${formatInteger(latest?.top3 || 0)} in the top 3`}
          accent="green"
        />
        <KpiCard
          label="Avg national position"
          value={
            latest?.avg_position != null
              ? `#${latest.avg_position.toFixed(1)}`
              : '—'
          }
          sub={`Across ${formatInteger(kw.monthly.length)} monthly snapshot${kw.monthly.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="empty-state semrush-overview-cta">
        <h2 className="empty-state__title">Want the full Overview?</h2>
        <p className="empty-state__body">
          The full executive dashboard (sessions, bounce rate, trust score,
          anomalies, top insights) is built from a GA4 Excel export. Upload one
          and re-run analysis to unlock it.
        </p>
        <div className="row-spread" style={{ gap: 12, justifyContent: 'center' }}>
          <Link to="/upload" className="btn btn--primary">
            Upload a GA4 report <LuArrowRight size={14} />
          </Link>
          <Link to="/keywords" className="btn btn--secondary">
            <LuSearch size={14} /> Open Keywords Intelligence
          </Link>
        </div>
      </div>
    </>
  );
}

export function ExecutiveSummary() {
  const { hasData, hasGA4, analyzed, filename, uploadedAt, sourceFiles } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  // Semrush-only fall-through: render a keyword-focused Overview rather
  // than a GA4 dashboard full of zeros.
  if (!hasGA4) {
    return (
      <SemrushOnlyOverview
        analyzed={analyzed}
        filename={filename}
        uploadedAt={uploadedAt}
        sourceFiles={sourceFiles}
      />
    );
  }

  const { summary, monthly, insights, verification, unique, accuracy, bots } = analyzed;
  const trust = unique?.trust;
  const anomalies = unique?.anomalies;
  const syncedLabel = uploadedAt
    ? `Synced ${new Date(uploadedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`
    : 'Live data';

  const anomalyMonths = new Set(
    (anomalies?.anomalies || [])
      .filter((a) => a.metric === 'sessions')
      .map((a) => a.month),
  );
  const monthlyData = (monthly || []).map((m) => ({
    month: m.month_name,
    sessions: m.sessions || 0,
    bouncePct: Math.round((m.bounce_rate || 0) * 1000) / 10,
    isAnomaly: anomalyMonths.has(m.month_name),
  }));

  // Pre-compute the standout months so the chart can highlight them by
  // default without waiting for the user to hover. We tag the data points
  // themselves so the custom Tooltip can show "★ top sessions" pins.
  let topSessionsIndex = -1;
  let topBounceIndex = -1;
  if (monthlyData.length > 0) {
    let maxSessions = -Infinity;
    let maxBounce = -Infinity;
    monthlyData.forEach((d, idx) => {
      if (d.sessions > maxSessions) {
        maxSessions = d.sessions;
        topSessionsIndex = idx;
      }
      if (d.bouncePct > maxBounce) {
        maxBounce = d.bouncePct;
        topBounceIndex = idx;
      }
    });
    monthlyData.forEach((d, idx) => {
      d.isTopSessions = idx === topSessionsIndex;
      d.isTopBounce = idx === topBounceIndex;
    });
  }
  const topSessionsPoint = monthlyData[topSessionsIndex] || null;
  const topBouncePoint = monthlyData[topBounceIndex] || null;

  const verifyChecks = verification?.checks || [];
  const verifyErrors = verifyChecks.filter((c) => c.status === 'error');
  const verifyWarns = verifyChecks.filter((c) => c.status === 'warn');
  const verifyIssueCount = verifyErrors.length + verifyWarns.length;

  return (
    <>
      <PageHeader
        badge={syncedLabel}
        title="Overview"
        subtitle={`Year-end performance snapshot — ${summary.report_period || 'full period'}.`}
        meta={
          filename ? (
            <Link
              to="/upload"
              className="page-meta__stamp"
              title={sourceTitle(sourceFiles, filename)}
              aria-label="Open Upload / Replace Data for connected source files"
            >
              Source
              <strong>{sourceCountLabel(sourceFiles, filename)}</strong>
            </Link>
          ) : null
        }
      />

      <BotAlertBanner
        bots={bots}
        totalSessions={summary?.total_sessions || 0}
        variant="subtle"
      />

      {verifyIssueCount > 0 && (
        <div
          className={`exec-verify-banner exec-verify-banner--${
            verifyErrors.length > 0 ? 'error' : 'warn'
          }`}
        >
          <span className="exec-verify-banner__icon" aria-hidden="true">
            <LuTriangleAlert size={16} />
          </span>
          <div className="exec-verify-banner__body">
            <strong>
              {verifyErrors.length > 0
                ? `Calculation cross-check found ${verifyErrors.length} mismatch${
                    verifyErrors.length === 1 ? '' : 'es'
                  }.`
                : `Calculation cross-check raised ${verifyWarns.length} warning${
                    verifyWarns.length === 1 ? '' : 's'
                  }.`}
            </strong>{' '}
            Different sheets in your workbook (and any hand-typed totals on
            your "Executive Summary" tabs) report different numbers for the
            same period. Scroll to the calculation accuracy check at the
            bottom to see which sheet each KPI comes from and where things
            disagree.{' '}
            <Link to="/upload">Open the full validation report →</Link>
          </div>
        </div>
      )}

      {/* ===== 1. Key performance metrics =================================== */}
      <KpiStrip summary={summary} year={summary.report_year} />

      {/* ===== 2. Monthly trend + volatility ================================ */}
      <h2 className="section-header">
        Monthly <em>trend</em>
      </h2>
      <p className="section-subhead">
        Sessions are bars; bounce rate (%) is the line. The top-sessions month
        and the highest-bounce month stay highlighted by default — hover or
        tap any other month to compare.
      </p>
      <div className="exec-trend-grid">
        <div className="chart-wrap exec-trend-chart">
          <div className="exec-trend-chart__head">
            <MonthlyTrendHighlights
              topSessions={topSessionsPoint}
              topBounce={topBouncePoint}
            />
          </div>
          <ResponsiveContainer width="100%" height={330}>
            <ComposedChart
              data={monthlyData}
              margin={{ top: 20, right: 24, left: 8, bottom: 0 }}
            >
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#6b7280" />
              <YAxis
                yAxisId="left"
                stroke="#522e91"
                tickFormatter={(v) => formatInteger(v)}
                width={64}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#dc2626"
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                content={<MonthlyTrendTooltip />}
                cursor={{ fill: 'rgba(82, 46, 145, 0.06)' }}
              />
              <Bar
                yAxisId="left"
                dataKey="sessions"
                name="Sessions"
                fill={TREND_COLORS.bar}
                radius={[4, 4, 0, 0]}
                activeBar={{ fill: TREND_COLORS.barHover, stroke: '#fff', strokeWidth: 2 }}
              >
                {monthlyData.map((entry, idx) => {
                  let fill = TREND_COLORS.bar;
                  if (idx === topSessionsIndex) fill = TREND_COLORS.barTopSessions;
                  else if (entry.isAnomaly) fill = TREND_COLORS.barAnomaly;
                  return <Cell key={idx} fill={fill} />;
                })}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="bouncePct"
                name="Bounce %"
                stroke={TREND_COLORS.line}
                strokeWidth={2}
                dot={BounceDot(topBounceIndex)}
                activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {anomalies && (
          <AnomalyList
            anomalies={anomalies.anomalies}
            stats={anomalies.stats}
            title="Volatility radar"
          />
        )}
      </div>

      {/* ===== 3. Top 10 dynamic insights =================================== */}
      <h2 className="section-header">
        Top 10 <em>key insights</em> from the data
      </h2>
      <p className="section-subhead">
        Auto-generated from this upload — every row is interpolated from your
        live numbers, so a different file will produce a different list.
        Priority pills show the recommended action category.
      </p>
      <TopInsightsTable insights={insights} />

      {/* ===== 4. Data trust score ========================================== */}
      {trust && <TrustScore trust={trust} />}

      {/* ===== 5. Calculation accuracy (bottom — audit panel) =============== */}
      {accuracy && <AccuracyCheck accuracy={accuracy} />}
    </>
  );
}
