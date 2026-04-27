import {
  Cell,
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
import { eqsGrade } from '../lib/uniqueAnalytics.js';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';
import { LuShieldAlert, LuTrendingUp, LuLayers, LuGoal } from 'react-icons/lu';

const DEVICE_COLORS = ['#522e91', '#9aca3c', '#d97706', '#2563eb', '#dc2626'];

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
    key: 'engagement_quality_score',
    header: 'EQS',
    align: 'right',
    render: (row) => {
      const grade = eqsGrade(row.engagement_quality_score || 0);
      return (
        <span className={`eqs-pill eqs-pill--${grade.tone}`}>
          <strong>{row.engagement_quality_score || 0}</strong>
          <em>{grade.grade}</em>
        </span>
      );
    },
  },
  {
    key: 'tier',
    header: 'Bounce Tier',
    render: (row) => <BounceBadge value={row.bounce_rate} />,
  },
  {
    key: 'bot',
    header: 'Bot Class',
    render: (row) => <BotBadge classification={row.bot_classification} />,
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
      : 'Premium = above-median volume AND above-median engagement quality.',
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
      : 'High EQS at low volume = candidates for paid lift or SEO investment.',
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

  const totalDeviceSessions = devices.reduce((acc, d) => acc + (d.sessions || 0), 0);
  const deviceData = devices.map((d) => ({
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

      <h2 className="section-header">Top <em>sources</em></h2>
      <DataTable
        columns={sourceColumns}
        rows={sources.slice(0, 25)}
        hint={`${sources.length} total sources`}
      />

      <div className="card-grid card-grid--cols-2">
        <div>
          <h2 className="section-header">Device <em>breakdown</em></h2>
          {deviceData.length === 0 ? (
            <div className="empty-state">No device data available.</div>
          ) : (
            <ChartWrapper height={260}>
              <PieChart>
                <Pie
                  data={deviceData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  label={(entry) => `${entry.name}: ${entry.pct.toFixed(0)}%`}
                >
                  {deviceData.map((_, idx) => (
                    <Cell key={idx} fill={DEVICE_COLORS[idx % DEVICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [formatInteger(value), name]}
                />
              </PieChart>
            </ChartWrapper>
          )}
        </div>
        <div>
          <h2 className="section-header">City <em>concentration</em></h2>
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
      />
    </>
  );
}
