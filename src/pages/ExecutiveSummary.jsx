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
import { PriorityBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { TrustScore } from '../components/TrustScore/TrustScore.jsx';
import { AnomalyList } from '../components/AnomalyList/AnomalyList.jsx';
import { AccuracyCheck } from '../components/AccuracyCheck/AccuracyCheck.jsx';
import { useData } from '../context/DataContext.jsx';

export function ExecutiveSummary() {
  const { hasData, analyzed, filename, uploadedAt } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const { summary, monthly, insights, verification, unique, accuracy } = analyzed;
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
            Different sheets in your workbook report different totals for the
            same period. See the accuracy matrix below — it shows which sheet
            each KPI was computed from and where independent calculations
            agree or disagree.{' '}
            <Link to="/upload">Open the full validation report →</Link>
          </div>
        </div>
      )}

      <KpiStrip summary={summary} year={summary.report_year} />

      {accuracy && <AccuracyCheck accuracy={accuracy} />}

      {trust && <TrustScore trust={trust} />}

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

      <h2 className="section-header">
        Top <em>insights</em>
      </h2>
      <div className="card-grid">
        {(insights || []).slice(0, 6).map((ins, i) => (
          <div key={i} className={`insight insight--${ins.priority || 'info'}`}>
            <div className="insight__head">
              <h3 className="insight__title">{ins.title}</h3>
              <PriorityBadge priority={ins.priority} />
            </div>
            <p className="insight__evidence">{ins.evidence}</p>
          </div>
        ))}
      </div>
    </>
  );
}
