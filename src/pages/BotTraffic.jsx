import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { BotBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';

const cityColumns = [
  { key: 'city', header: 'City', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  {
    key: 'avg_engagement_time',
    header: 'Avg Eng',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'bounce_rate',
    header: 'Bounce',
    align: 'right',
    render: (row) => (
      <span className={bounceClass(row.bounce_rate)}>
        {formatPercent(row.bounce_rate)}
      </span>
    ),
  },
  {
    key: 'return_rate',
    header: 'Return',
    align: 'right',
    format: (v) => formatPercent(v),
  },
  {
    key: 'bot_score',
    header: 'Score',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'classification',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
  },
];

const sourceColumns = [
  { key: 'source', header: 'Source', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  {
    key: 'avg_engagement_time',
    header: 'Avg Eng',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'bounce_rate',
    header: 'Bounce',
    align: 'right',
    render: (row) => (
      <span className={bounceClass(row.bounce_rate)}>
        {formatPercent(row.bounce_rate)}
      </span>
    ),
  },
  {
    key: 'bot_score',
    header: 'Score',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'classification',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
  },
];

export function BotTraffic() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;
  const bots = analyzed.bots || {};
  const sum = bots.summary || {};
  const methodology = bots.methodology || {};

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Bot Traffic Intelligence"
        subtitle="City- and source-level scoring of probable bot/datacentre traffic."
      />

      <div className="card-grid card-grid--cols-4">
        <KpiCard
          label="Confirmed bot sessions"
          value={formatInteger(sum.confirmed_bot_sessions)}
          accent="red"
        />
        <KpiCard
          label="Likely bot"
          value={formatInteger(sum.likely_bot_sessions)}
          accent="amber"
        />
        <KpiCard
          label="Suspicious"
          value={formatInteger(sum.suspicious_sessions)}
          accent="amber"
        />
        <KpiCard
          label="Human sessions"
          value={formatInteger(sum.human_sessions)}
          accent="green"
        />
      </div>

      <div className="card-grid card-grid--cols-2">
        <KpiCard
          label="Bot user IDs"
          value={formatInteger(sum.bot_user_ids)}
          sub="Confirmed + likely from User sheet"
        />
        <KpiCard
          label="Fractional user IDs"
          value={formatInteger(sum.fractional_user_ids)}
          sub="GA4 cross-device / Google Signals"
        />
      </div>

      <h2 className="section-header">City-level bot <em>scoring</em></h2>
      <DataTable columns={cityColumns} rows={bots.cities || []} hint="Top 60 by sessions" />

      <h2 className="section-header">Source-level bot <em>scoring</em></h2>
      <DataTable columns={sourceColumns} rows={bots.sources || []} />

      <h2 className="section-header"><em>Methodology</em></h2>
      <div className="card-grid card-grid--cols-2">
        <div className="card">
          <h3 className="card-title">City rules</h3>
          <ul>
            {(methodology.city_rules || []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3 className="card-title">Source rules</h3>
          <ul>
            {(methodology.source_rules || []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="card">
        <h3 className="card-title">Score thresholds</h3>
        <ul>
          {Object.entries(methodology.thresholds || {}).map(([k, v]) => (
            <li key={k}>
              <strong>{k.replace('_', ' ')}:</strong> {v}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
