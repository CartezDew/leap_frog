import {
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
} from 'recharts';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { BotBadge, BounceBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { QualityQuadrant } from '../components/QualityQuadrant/QualityQuadrant.jsx';
import { ConcentrationCard } from '../components/ConcentrationCard/ConcentrationCard.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';
import {
  LuShieldAlert,
  LuTrendingUp,
  LuLayers,
  LuGoal,
  LuBrainCircuit,
} from 'react-icons/lu';

import { rankChannels, summarizeAiSources } from '../lib/levers.js';
import { formatSeconds } from '../lib/formatters.js';

const DEVICE_COLORS = ['#522e91', '#9aca3c', '#d97706', '#2563eb', '#dc2626'];

// Skip label rendering altogether for tiny slices (e.g. tablet at 1%, smart
// tv at 0%) so they don't pile up on top of each other near the edge of the
// donut. Those entries still appear in the legend below the chart.
const DEVICE_LABEL_THRESHOLD = 0.04;

function renderDeviceLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  percent,
  name,
}) {
  if (percent < DEVICE_LABEL_THRESHOLD) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#522e91"
      fontSize={12}
      fontWeight={600}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
    >
      {`${name}: ${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function renderDeviceLabelLine(props) {
  const { points, percent } = props;
  if (percent < DEVICE_LABEL_THRESHOLD || !points || points.length < 2) {
    return null;
  }
  const [p1, p2] = points;
  return (
    <polyline
      points={`${p1.x},${p1.y} ${p2.x},${p2.y}`}
      stroke="#c9b8e0"
      strokeWidth={1}
      fill="none"
    />
  );
}

// Cleanest → dirtiest, used to sort badge columns whose displayed value is
// `bot_classification` (which is otherwise just an opaque string).
const BOT_RANK = {
  human: 0,
  suspicious: 1,
  likely_bot: 2,
  confirmed_bot: 3,
};

const sourceColumns = [
  { key: 'source', header: 'Source', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  { key: 'total_users', header: 'Users', align: 'right', format: (v) => formatInteger(v) },
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
    key: 'engagement_rate',
    header: 'Engagement',
    align: 'right',
    format: (v) => formatPercent(v),
  },
  {
    key: 'tier',
    header: 'Bounce Tier',
    render: (row) => <BounceBadge value={row.bounce_rate} />,
    sortValue: (row) => row.bounce_rate,
    exportValue: (row) => row.tier ?? '',
  },
  {
    key: 'bot',
    header: 'Bot Class',
    render: (row) => <BotBadge classification={row.bot_classification} />,
    sortValue: (row) => BOT_RANK[row.bot_classification] ?? -1,
    exportValue: (row) => row.bot_classification ?? '',
  },
];

function buildSourceStoryCards({ sources, quadrant, concentration }) {
  const cards = [];
  const totalSessions = sources.reduce((acc, s) => acc + (s.sessions || 0), 0);

  // 1. Premium sources (the keepers)
  const premium = (quadrant?.items || []).filter((i) => i.quadrant === 'premium');
  const premiumShare = totalSessions
    ? premium.reduce((acc, p) => acc + p.sessions, 0) / totalSessions
    : 0;
  cards.push({
    tone: 'green',
    icon: LuTrendingUp,
    label: 'Premium channels',
    value: formatInteger(premium.length),
    headline: premium.length > 0
      ? `${formatPercent(premiumShare, 0)} of sessions come from your strongest mix`
      : 'No channel currently meets the premium bar',
    caption: premium.length > 0
      ? `Top: ${premium.slice(0, 3).map((p) => p.name).join(', ')}.`
      : 'Premium = above-median volume AND above-median engagement.',
  });

  // 2. Volume Leaks (the biggest fix)
  const leaks = (quadrant?.items || []).filter((i) => i.quadrant === 'leak');
  const leakShare = totalSessions
    ? leaks.reduce((acc, p) => acc + p.sessions, 0) / totalSessions
    : 0;
  cards.push({
    tone: leaks.length ? 'red' : 'green',
    icon: LuShieldAlert,
    label: 'Volume leaks',
    value: formatInteger(leaks.length),
    headline: leaks.length
      ? `${formatPercent(leakShare, 0)} of sessions are weak engagement at scale`
      : 'No high-volume channels are leaking engagement',
    caption: leaks.length
      ? `Worst: ${leaks.slice(0, 2).map((p) => p.name).join(', ')}.`
      : 'Channels with above-median volume but below-median quality.',
  });

  // 3. Scale Opportunities (small but mighty)
  const scale = (quadrant?.items || []).filter((i) => i.quadrant === 'scale');
  cards.push({
    tone: scale.length ? 'info' : 'amber',
    icon: LuGoal,
    label: 'Scale opportunities',
    value: formatInteger(scale.length),
    headline: scale.length
      ? `Engaged audiences hiding under low volume`
      : 'No low-volume channels are showing standout engagement',
    caption: scale.length
      ? `Worth doubling down: ${scale.slice(0, 3).map((p) => p.name).join(', ')}.`
      : 'Strong engagement at low volume = candidates for paid lift or SEO investment.',
  });

  // 4. Concentration risk
  const conc = concentration?.sources;
  if (conc && conc.count > 0) {
    let tone = 'green';
    if (conc.hhi >= 2500) tone = 'red';
    else if (conc.hhi >= 1500) tone = 'amber';

    cards.push({
      tone,
      icon: LuLayers,
      label: 'Source diversification',
      value: conc.effective.toFixed(1),
      headline: `${conc.label.toLowerCase()} — top source delivers ${formatPercent(conc.top1, 0)}`,
      caption: `HHI ${conc.hhi.toLocaleString()} · Site behaves as if it had ${conc.effective.toFixed(1)} equally-weighted sources.`,
    });
  }

  return cards;
}

const cityColumns = [
  { key: 'city', header: 'City', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  {
    key: 'avg_engagement_time',
    header: 'Avg Engagement',
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
    header: 'Bot Score',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'bot',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
    sortValue: (row) => BOT_RANK[row.bot_classification] ?? -1,
    exportValue: (row) => row.bot_classification ?? '',
  },
];

const channelLeaderColumns = [
  { key: 'source', header: 'Source', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  { key: 'engagement_rate', header: 'Engagement', align: 'right', format: (v) => formatPercent(v, 1) },
  {
    key: 'avg_engagement_time',
    header: 'Avg time',
    align: 'right',
    format: (v) => formatSeconds(v),
  },
  {
    key: 'quality_index',
    header: 'Quality',
    align: 'right',
    render: (row) => (
      <progress
        className="lever-quality-bar"
        value={Math.round(row.quality_index * 100)}
        max={100}
        aria-label={`Quality index ${(row.quality_index * 100).toFixed(0)} of 100`}
      />
    ),
    sortValue: (row) => row.quality_index,
    exportValue: (row) =>
      row.quality_index != null ? String(Math.round(row.quality_index * 100)) : '',
  },
  {
    key: 'action',
    header: 'Action',
    render: (row) => (
      <span className={`lever-pill lever-pill--${row.action.tone}`}>{row.action.label}</span>
    ),
    sortValue: (row) => row.action?.label || '',
    exportValue: (row) => row.action?.label || '',
  },
];

export function TrafficSources() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const sources = analyzed.sources || [];
  const devices = analyzed.devices || [];
  const cities = analyzed.cities || [];
  const unique = analyzed.unique || {};
  const sourceQuadrant = unique.source_quadrant;
  const concentration = unique.concentration;
  const totalSiteSessions = analyzed.summary?.total_sessions || 0;
  const channelLeaders = rankChannels(sources, 6);
  const aiSummary = summarizeAiSources(sources, totalSiteSessions);
  const hasAiTraffic = aiSummary.matches.length > 0;

  const totalDeviceSessions = devices.reduce((acc, d) => acc + (d.sessions || 0), 0);
  const deviceData = devices
    .filter((d) => (d.sessions || 0) > 0)
    .map((d) => ({
      name: d.device,
      value: d.sessions || 0,
      pct: totalDeviceSessions ? (d.sessions / totalDeviceSessions) * 100 : 0,
    }));

  const storyCards = buildSourceStoryCards({
    sources,
    quadrant: sourceQuadrant,
    concentration,
  });

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Traffic Sources"
        subtitle="Annual aggregations across acquisition channels, devices, and cities."
      />

      <StoryCards
        eyebrow="Channel intelligence"
        title={<>Quality first, volume <em>second</em></>}
        cards={storyCards}
        ariaLabel="Channel intelligence callouts"
      />

      <h2 className="section-header">Channel <em>quality map</em></h2>
      <p className="section-subhead">
        Median splits classify every channel as Premium, Scale Opportunity,
        Volume Leak, or Marginal — telling you which traffic to feed and
        which to fix.
      </p>
      <QualityQuadrant
        quadrant={sourceQuadrant}
        title="Channel quality quadrant"
        subtitle="X = sessions, Y = Engagement Quality Score (0–100). Bubble size scales with volume."
        dimLabel="source"
      />

      {channelLeaders.length > 0 && (
        <>
          <h2 className="section-header">
            Channel <em>quality leaderboard</em>
            <span className="section-header__hint">
              <LuTrendingUp size={14} aria-hidden="true" /> action list
            </span>
          </h2>
          <p className="section-subhead">
            Top sources ranked by <strong>volume × engagement × time-on-site</strong>,
            excluding confirmed bots and AI assistants. Use the action column to decide
            where to spend marketing hours next week.
          </p>
          <div className="lever-table-card">
            <DataTable
              columns={channelLeaderColumns}
              rows={channelLeaders}
              defaultSort={{ key: 'sessions', dir: 'desc' }}
              exportFileStem="traffic-sources-channel-leaders"
            />
          </div>
        </>
      )}

      <h2 className="section-header">
        AI search <em>visibility</em>
        <span className="section-header__hint">
          <LuBrainCircuit size={14} aria-hidden="true" /> emerging channel
        </span>
      </h2>
      <p className="section-subhead">
        Sessions referred by AI assistants (ChatGPT, Perplexity, Claude, Copilot, etc.).
        These visits read content and leave without converting — high bounce here is{' '}
        <strong>expected</strong>, not a problem. They're separated from the leaderboard
        above so they don't drag down quality scores.
      </p>
      <article className="lever-card lever-card--info lever-card--list">
        <header className="lever-card__head">
          <span className="lever-card__icon" aria-hidden="true">
            <LuBrainCircuit size={18} />
          </span>
          <h3 className="lever-card__title">
            {hasAiTraffic
              ? 'AI assistants citing your content'
              : 'No AI assistant referrals detected'}
          </h3>
          {hasAiTraffic && (
            <span className="lever-card__hint">
              {formatInteger(aiSummary.total_sessions)} sessions ·{' '}
              {formatPercent(aiSummary.site_share, 2)} of site
            </span>
          )}
        </header>
        {hasAiTraffic ? (
          <>
            <ul className="lever-list">
              {aiSummary.matches.map((row) => (
                <li key={row.source}>
                  <span className="lever-list__primary" title={row.source}>
                    {row.assistant}{' '}
                    <span className="muted">· {row.source}</span>
                  </span>
                  <span className="lever-list__meta">
                    <strong>{formatInteger(row.sessions)}</strong> sessions ·{' '}
                    {formatPercent(row.bounce_rate, 1)} bounce ·{' '}
                    {formatSeconds(row.avg_engagement_time)} avg time
                  </span>
                </li>
              ))}
            </ul>
            <p className="lever-card__body">
              <strong>What to do:</strong> if these volumes grow, audit which pages are
              being cited and add structured data (FAQ, HowTo, breadcrumbs) plus a clear
              CTA above the fold — that's how AI-referred readers convert.
            </p>
          </>
        ) : (
          <p className="lever-card__body">
            None of your top sources match known AI assistants right now. Worth re-checking
            next quarter — AI-referred traffic is the fastest-growing referrer category in
            B2B SaaS, and it shows up as <em>chatgpt.com</em>, <em>perplexity.ai</em>,{' '}
            <em>claude.ai</em>, etc. in your GA4 source list.
          </p>
        )}
      </article>

      <h2 className="section-header">Top <em>sources</em></h2>
      <DataTable
        columns={sourceColumns}
        rows={sources.slice(0, 25)}
        hint={`${formatInteger(sources.length)} total sources`}
        defaultSort={{ key: 'sessions', dir: 'desc' }}
        exportFileStem="traffic-sources-top-sources"
      />

      <div className="card-grid card-grid--cols-2 sources-charts">
        <div className="sources-charts__cell">
          <h2 className="section-header">Device <em>breakdown</em></h2>
          {deviceData.length === 0 ? (
            <div className="empty-state">No device data available.</div>
          ) : (
            <ChartWrapper height={300}>
              <PieChart margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                <Pie
                  data={deviceData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={2}
                  minAngle={3}
                  labelLine={renderDeviceLabelLine}
                  label={renderDeviceLabel}
                >
                  {deviceData.map((_, idx) => (
                    <Cell key={idx} fill={DEVICE_COLORS[idx % DEVICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [formatInteger(value), name]}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
                  formatter={(value, entry) => {
                    const pct = entry?.payload?.pct ?? 0;
                    return `${value} · ${pct.toFixed(pct < 1 ? 1 : 0)}%`;
                  }}
                />
              </PieChart>
            </ChartWrapper>
          )}
        </div>
        <div className="sources-charts__cell">
          <h2 className="section-header">City <em>spread</em></h2>
          <p className="section-subhead">
            Shows whether sessions pile into one metro or stay spread across many cities — every
            value is a share of <strong>sessions</strong> by city in this file.
          </p>
          {concentration?.cities && (
            <ConcentrationCard
              title="City traffic concentration"
              dimension="cities"
              stats={concentration.cities}
            />
          )}
        </div>
      </div>

      <h2 className="section-header">Top <em>cities</em></h2>
      <DataTable
        columns={cityColumns}
        rows={cities.slice(0, 20)}
        hint={`Top 20 by sessions of ${cities.length} cities`}
        defaultSort={{ key: 'sessions', dir: 'desc' }}
        exportFileStem="traffic-sources-top-cities"
      />
    </>
  );
}
