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
import { LuTriangleAlert } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiStrip } from '../components/KpiStrip/KpiStrip.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { TrustScore } from '../components/TrustScore/TrustScore.jsx';
import { AnomalyList } from '../components/AnomalyList/AnomalyList.jsx';
import { AccuracyCheck } from '../components/AccuracyCheck/AccuracyCheck.jsx';
import { TopInsightsTable } from '../components/TopInsightsTable/TopInsightsTable.jsx';
import { BotAlertBanner } from '../components/BotAlertBanner/BotAlertBanner.jsx';
import { useData } from '../context/DataContext.jsx';

export function ExecutiveSummary() {
  const { hasData, analyzed, filename, uploadedAt } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

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
