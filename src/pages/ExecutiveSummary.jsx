import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Cell,
} from 'recharts';
import { LuTriangleAlert, LuArrowRight, LuSearch } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiStrip } from '../components/KpiStrip/KpiStrip.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { TrustScore } from '../components/TrustScore/TrustScore.jsx';
import { AnomalyList } from '../components/AnomalyList/AnomalyList.jsx';
import { AccuracyCheck } from '../components/AccuracyCheck/AccuracyCheck.jsx';
import { TopInsightsTable } from '../components/TopInsightsTable/TopInsightsTable.jsx';
import { BotAlertBanner } from '../components/BotAlertBanner/BotAlertBanner.jsx';
import { useData } from '../context/DataContext.jsx';
import { runKeywordAnalysis } from '../lib/keywordAnalyzer.js';
import { formatInteger } from '../lib/formatters.js';

// Semrush-only Overview: when the user has uploaded Semrush PDFs but no GA4
// workbook, the GA4 KPI strip / monthly trend / trust score have nothing to
// show. Surface a focused Semrush snapshot instead so the page is still
// useful at-a-glance, with a clear CTA to upload GA4 to unlock the rest.
function SemrushOnlyOverview({ analyzed, filename, uploadedAt }) {
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
            <div className="page-meta__stamp">
              Source
              <strong>{filename}</strong>
            </div>
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

      <div className="empty-state">
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
  const { hasData, hasGA4, analyzed, filename, uploadedAt } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  // Semrush-only fall-through: render a keyword-focused Overview rather
  // than a GA4 dashboard full of zeros.
  if (!hasGA4) {
    return (
      <SemrushOnlyOverview
        analyzed={analyzed}
        filename={filename}
        uploadedAt={uploadedAt}
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
    sessions: m.sessions,
    bouncePct: Math.round((m.bounce_rate || 0) * 1000) / 10,
    isAnomaly: anomalyMonths.has(m.month_name),
  }));

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
            <div className="page-meta__stamp">
              Source
              <strong>{filename}</strong>
            </div>
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
        Sessions are bars; bounce rate (%) is the line. Highlighted bars mark
        months that deviated more than 1.5σ from the annual baseline.
      </p>
      <div className="exec-trend-grid">
        <ChartWrapper height={340}>
          <ComposedChart data={monthlyData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke="#6b7280" />
            <YAxis yAxisId="left" stroke="#522e91" />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#dc2626"
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="sessions"
              name="Sessions"
              fill="#522e91"
              radius={[4, 4, 0, 0]}
            >
              {monthlyData.map((entry, idx) => (
                <Cell key={idx} fill={entry.isAnomaly ? '#f59e0b' : '#522e91'} />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="bouncePct"
              name="Bounce %"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ChartWrapper>
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
