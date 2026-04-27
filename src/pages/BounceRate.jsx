import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  LuChartLine,
  LuGauge,
  LuShield,
  LuTrendingDown,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { BounceBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { BenchmarkScale } from '../components/BenchmarkScale/BenchmarkScale.jsx';
import { BounceRecommendations } from '../components/BounceRecommendations/BounceRecommendations.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';

const channelColumns = [
  { key: 'medium', header: 'Channel', className: 'col-strong' },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'engaged_sessions',
    header: 'Engaged',
    align: 'right',
    format: (v) => formatInteger(v),
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
    key: 'engagement_rate',
    header: 'Engagement',
    align: 'right',
    format: (v) => formatPercent(v),
  },
  {
    key: 'tier',
    header: 'Assessment',
    render: (row) => <BounceBadge value={row.bounce_rate} />,
  },
];

const opportunityColumns = [
  { key: 'page', header: 'Page', className: 'col-strong' },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
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
    key: 'avg_engagement_time',
    header: 'Avg Engagement',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'content_role',
    header: 'Role',
  },
];

function buildBounceStoryCards({ benchmark, bounce, summary }) {
  const cards = [];
  const site = benchmark?.site;
  const median = benchmark?.industry_median ?? 0.475;

  if (site) {
    const tier = site.tier;
    const delta = (median - site.rate) * 100;
    const deltaText =
      Math.abs(delta) < 0.5
        ? 'matches the B2B services median'
        : delta > 0
          ? `${delta.toFixed(1)} pts better than the median`
          : `${Math.abs(delta).toFixed(1)} pts worse than the median`;
    cards.push({
      tone:
        tier?.id === 'excellent' || tier?.id === 'good'
          ? 'green'
          : tier?.id === 'average'
            ? 'amber'
            : 'red',
      icon: LuGauge,
      label: 'Site bounce vs industry',
      value: formatPercent(site.rate, 1),
      headline: `${tier?.label || 'Average'} band`,
      caption: deltaText,
      footer: `Industry median: ${formatPercent(median, 1)}`,
    });
  }

  const channels = benchmark?.channels || [];
  const worst = [...channels]
    .filter((c) => c.sessions >= 50)
    .sort((a, b) => b.bounce_rate - a.bounce_rate)[0];
  if (worst) {
    cards.push({
      tone: 'red',
      icon: LuTrendingDown,
      label: 'Worst channel',
      value: formatPercent(worst.bounce_rate, 1),
      headline: worst.name,
      caption: `${formatInteger(worst.sessions)} sessions sitting in the "${worst.tier?.label}" band.`,
      footer: 'Top recommendation below tackles this.',
    });
  }

  const best = [...channels]
    .filter((c) => c.sessions >= 50)
    .sort((a, b) => a.bounce_rate - b.bounce_rate)[0];
  if (best) {
    cards.push({
      tone: 'green',
      icon: LuShield,
      label: 'Best channel',
      value: formatPercent(best.bounce_rate, 1),
      headline: best.name,
      caption: `${formatInteger(best.sessions)} sessions in the "${best.tier?.label}" band — copy what works.`,
      footer: best.tier?.id === 'excellent' ? 'Best-in-class' : 'Above average',
    });
  }

  const homepage = bounce?.homepage_monthly || [];
  if (homepage.length >= 2) {
    const sorted = [...homepage].sort(
      (a, b) => (b.bounce_rate || 0) - (a.bounce_rate || 0),
    );
    const peak = sorted[0];
    const trough = sorted[sorted.length - 1];
    const swing = ((peak.bounce_rate || 0) - (trough.bounce_rate || 0)) * 100;
    cards.push({
      tone: swing >= 10 ? 'amber' : 'info',
      icon: LuChartLine,
      label: 'Homepage volatility',
      value: `${swing.toFixed(1)} pts`,
      headline: `${peak.month_name} peak vs ${trough.month_name} trough`,
      caption: `Peak ${formatPercent(peak.bounce_rate, 1)} · Trough ${formatPercent(trough.bounce_rate, 1)}`,
      footer:
        swing >= 10
          ? 'Investigate campaigns or layout changes in peak month.'
          : 'Healthy month-over-month consistency.',
    });
  } else if (summary) {
    cards.push({
      tone: 'info',
      icon: LuChartLine,
      label: 'Engaged sessions',
      value: formatInteger(summary.engaged_sessions || 0),
      headline: `${formatPercent(summary.engagement_rate || 0, 1)} engagement rate`,
      caption: 'The other side of bounce — sessions that stuck around.',
      footer: `${formatInteger(summary.total_sessions || 0)} total sessions`,
    });
  }

  return cards;
}

export function BounceRate() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const bounce = analyzed.bounce || {};
  const summary = analyzed.summary || {};
  const benchmark = bounce.benchmark || null;

  const homepage = (bounce.homepage_monthly || []).map((m) => ({
    month: m.month_name,
    bouncePct: Math.round((m.bounce_rate || 0) * 1000) / 10,
  }));

  const storyCards = buildBounceStoryCards({ benchmark, bounce, summary });

  // Top 6 high-traffic pages for the comparison strip on the benchmark scale.
  const benchPages = (benchmark?.pages || [])
    .filter((p) => p.sessions >= 100)
    .slice(0, 6);
  const benchChannels = benchmark?.channels || [];

  return (
    <>
      <PageHeader
        badge="Industry benchmarked"
        badgeVariant="green"
        title="Bounce Rate"
        subtitle={bounce.definition || '1 − Engaged Sessions ÷ Sessions'}
      />

      <StoryCards
        eyebrow="Benchmark briefing"
        title={<>How Leapfrog stacks up <em>against the industry</em></>}
        cards={storyCards}
        ariaLabel="Bounce-rate benchmark callouts"
      />

      <BenchmarkScale
        benchmark={benchmark}
        channels={benchChannels}
        pages={benchPages}
      />

      <BounceRecommendations recommendations={benchmark?.recommendations || []} />

      <h2 className="section-header">Bounce by <em>channel</em></h2>
      <DataTable
        columns={channelColumns}
        rows={bounce.by_channel || []}
        emptyMessage="Medium data not provided in this upload."
      />

      {homepage.length > 0 && (
        <>
          <h2 className="section-header">Homepage bounce <em>trend</em></h2>
          <p className="section-subhead">
            Shaded bands show industry tiers. The dashed line is the B2B services
            median (47.5%). Anything below the green band is best-in-class.
          </p>
          <ChartWrapper subtitle="Monthly bounce % for the homepage path, plotted against the industry tier scale.">
            <LineChart data={homepage} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#6b7280" />
              <YAxis stroke="#dc2626" tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip formatter={(v) => `${v}%`} />
              <ReferenceArea y1={0} y2={30} fill="#16a34a" fillOpacity={0.08} />
              <ReferenceArea y1={30} y2={40} fill="#84cc16" fillOpacity={0.08} />
              <ReferenceArea y1={40} y2={55} fill="#f59e0b" fillOpacity={0.08} />
              <ReferenceArea y1={55} y2={100} fill="#dc2626" fillOpacity={0.1} />
              <ReferenceLine
                y={47.5}
                stroke="#6b7280"
                strokeDasharray="4 4"
                label={{
                  value: 'Industry median 47.5%',
                  position: 'right',
                  fill: '#6b7280',
                  fontSize: 11,
                }}
              />
              <Line
                type="monotone"
                dataKey="bouncePct"
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="Homepage bounce"
              />
            </LineChart>
          </ChartWrapper>
        </>
      )}

      <h2 className="section-header">High-bounce opportunity <em>pages</em></h2>
      <p className="section-subhead">
        Sessions ≥ 100 and bounce ≥ 45% — strong candidates for CTAs, internal links,
        or content rewrites.
      </p>
      <DataTable
        columns={opportunityColumns}
        rows={bounce.high_bounce_opportunities || []}
        emptyMessage="No high-traffic, high-bounce pages — congrats."
      />
    </>
  );
}
