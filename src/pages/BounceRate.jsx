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
import { useMemo } from 'react';
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
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
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
    key: 'total_users',
    header: 'Users',
    align: 'right',
    format: (v) => formatInteger(v),
  },
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
    exportValue: (row) => formatPercent(row.bounce_rate),
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
    sortValue: (row) => row.bounce_rate,
    exportValue: (row) => row.tier ?? formatPercent(row.bounce_rate),
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
    exportValue: (row) => formatPercent(row.bounce_rate),
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
    exportValue: (row) => row.content_role ?? '',
  },
];

const highReachColumns = [
  { key: 'page', header: 'Page', className: 'col-strong' },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'engaged_reach',
    header: 'Engaged Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'clean_engagement_rate',
    header: 'Engagement',
    align: 'right',
    format: (v) => formatPercent(v),
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
    exportValue: (row) => formatPercent(row.bounce_rate),
  },
  {
    key: 'avg_engagement_time',
    header: 'Avg Engagement',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
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
      to: '#bounce-benchmark-scale',
      ctaLabel: 'Open benchmark scale',
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
      to: '#bounce-by-channel',
      ctaLabel: 'Jump to channel table',
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
      to: '#bounce-by-channel',
      ctaLabel: 'Jump to channel table',
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
      to: '#bounce-homepage-trend',
      ctaLabel: 'Open homepage trend',
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
      to: '#bounce-by-channel',
      ctaLabel: 'Jump to channel table',
    });
  }

  return cards;
}

function CleanTrafficBouncePanel({ summary, bots }) {
  const botSummary = bots?.summary || {};
  const classifiedSessions = Number(botSummary.classified_sessions) || 0;
  if (!classifiedSessions) return null;

  const confirmed = Number(botSummary.confirmed_bot_sessions) || 0;
  const likely = Number(botSummary.likely_bot_sessions) || 0;
  const aiSessions = Number(botSummary.ai_assistant_sessions) || 0;

  return (
    <article className="lever-card lever-card--info lever-card--inline">
      <header className="lever-card__head">
        <span className="lever-card__icon" aria-hidden="true">
          <LuShield size={18} />
        </span>
        <h3 className="lever-card__title">Bounce rate after bot cleanup</h3>
        <span className="lever-card__hint">city-classified session model</span>
      </header>

      <div className="card-grid card-grid--cols-4">
        <KpiCard
          label="Reported site bounce"
          value={formatPercent(summary?.site_bounce_rate || 0, 1)}
          sub="raw Medium/Source site total"
        />
        <KpiCard
          label="City-classified bounce"
          value={formatPercent(botSummary.classified_bounce_rate || 0, 1)}
          sub={`${formatInteger(classifiedSessions)} city-classified sessions`}
        />
        <KpiCard
          label="Confirmed bots removed"
          value={formatPercent(botSummary.confirmed_removed_bounce_rate || 0, 1)}
          accent="green"
          sub={`${formatInteger(confirmed)} confirmed sessions removed`}
        />
        <KpiCard
          label="Confirmed + likely removed"
          value={formatPercent(
            botSummary.confirmed_likely_removed_bounce_rate || 0,
            1,
          )}
          accent="green"
          sub={`${formatInteger(confirmed + likely)} bot-likely sessions removed`}
        />
      </div>

      <p className="lever-card__body">
        Use the confirmed-bot number as the conservative cleanup view and the
        confirmed + likely number as the operational cleanup view. AI/AEO tools
        such as ChatGPT, Claude, Gemini, and Perplexity are shown separately
        ({formatInteger(aiSessions)} sessions here) because they can look bot-like
        but represent discovery traffic, not spam.
      </p>
    </article>
  );
}

/** Monthly points with peak/trough markers for chart labels (↑ high, ↓ low). */
function buildHomepageTrendSeries(homepageMonthly) {
  const rows = (homepageMonthly || []).map((m) => ({
    month: m.month_name,
    bouncePct: Math.round((m.bounce_rate || 0) * 1000) / 10,
  }));
  if (rows.length === 0) return [];
  const pcts = rows.map((r) => r.bouncePct);
  const maxVal = Math.max(...pcts);
  const minVal = Math.min(...pcts);
  const maxIdx = pcts.indexOf(maxVal);
  const minIdx = pcts.indexOf(minVal);
  const flat = maxVal === minVal;
  return rows.map((r, i) => ({
    ...r,
    peakNum: i === maxIdx ? maxVal : null,
    troughNum: !flat && i === minIdx ? minVal : null,
  }));
}

function HomepageTrendDot(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const peak = payload?.peakNum;
  const trough = payload?.troughNum;
  const isPeak = peak != null;
  const isTrough = trough != null;
  const dy = isPeak ? -12 : isTrough ? 18 : 0;
  const val = isPeak ? peak : trough;
  const label = isPeak
    ? `↑ ${Number(val).toFixed(1)}%`
    : isTrough
      ? `↓ ${Number(val).toFixed(1)}%`
      : null;
  const fill = isPeak ? '#dc2626' : '#16a34a';
  return (
    <g>
      <circle cx={cx} cy={cy} r={3} fill="#dc2626" />
      {label != null && (
        <text
          x={cx}
          y={cy}
          dy={dy}
          textAnchor="middle"
          fill={fill}
          fontSize={11}
          fontWeight={700}
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

export function BounceRate() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const bounce = analyzed.bounce || {};
  const summary = analyzed.summary || {};
  const bots = analyzed.bots || {};
  const benchmark = bounce.benchmark || null;

  const homepage = useMemo(
    () => buildHomepageTrendSeries(bounce.homepage_monthly),
    [bounce.homepage_monthly],
  );

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
      />

      <StoryCards
        eyebrow="Benchmark briefing"
        title={<>How Leapfrog stacks up <em>against the industry</em></>}
        cards={storyCards}
        ariaLabel="Bounce-rate benchmark callouts"
      />

      <CleanTrafficBouncePanel summary={summary} bots={bots} />

      <div id="bounce-benchmark-scale" className="scroll-anchor">
        <BenchmarkScale
          benchmark={benchmark}
          channels={benchChannels}
          pages={benchPages}
        />
      </div>

      <BounceRecommendations recommendations={benchmark?.recommendations || []} />

      <h2 id="bounce-by-channel" className="section-header scroll-anchor">
        Bounce by <em>channel</em>
      </h2>
      <DataTable
        columns={channelColumns}
        rows={bounce.by_channel || []}
        emptyMessage="Medium data not provided in this upload."
        defaultSort={{ key: 'sessions', dir: 'desc' }}
        exportFileStem="bounce-by-channel"
      />

      {homepage.length > 0 && (
        <>
          <h2 id="bounce-homepage-trend" className="section-header scroll-anchor">
            Homepage bounce <em>trend</em>
          </h2>
          <p className="section-subhead">
            Shaded bands show industry tiers. The dashed line is the B2B services
            median (47.5%). Anything below the green band is best-in-class.
          </p>
          <ChartWrapper subtitle="Monthly bounce % for the homepage path, plotted against the industry tier scale.">
            <LineChart data={homepage} margin={{ top: 22, right: 16, left: 0, bottom: 10 }}>
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
                dot={HomepageTrendDot}
                name="Homepage bounce"
              />
            </LineChart>
          </ChartWrapper>
        </>
      )}

      <h2 className="section-header">Pages with <em>high</em> bounce</h2>
      <p className="section-subhead">
        High-traffic pages where most visitors leave on arrival
        (<strong>≥ 100 sessions</strong> and <strong>bounce ≥ 45%</strong>).
        Strong candidates for CTAs, internal links, or content rewrites.
      </p>
      <DataTable
        columns={opportunityColumns}
        rows={bounce.high_bounce_opportunities || []}
        emptyMessage="No high-traffic, high-bounce pages — congrats."
        defaultSort={{ key: 'bounce_rate', dir: 'desc' }}
        exportFileStem="bounce-high-bounce-pages"
      />

      <h2 className="section-header">Highest-reach <em>engaged</em> pages</h2>
      <p className="section-subhead">
        Pages ranked by engaged sessions from the raw Page Path sheet. This is
        the cleanest aggregate proxy for human reach after bot cleanup: exact
        page-level bot subtraction requires session-level GA4 rows that include
        page, city, and source on the same visit.
      </p>
      <DataTable
        columns={highReachColumns}
        rows={bounce.high_reach_engagement_pages || []}
        emptyMessage="No high-reach engaged pages detected yet."
        defaultSort={{ key: 'engaged_reach', dir: 'desc' }}
        exportFileStem="bounce-high-reach-engaged-pages"
      />

      <h2 className="section-header">Pages with <em>low</em> bounce</h2>
      <p className="section-subhead">
        High-traffic pages that hold visitors' attention
        (<strong>≥ 100 sessions</strong> and <strong>bounce ≤ 25%</strong>).
        Mine the messaging, layout, and CTAs from these and reuse them on the
        weaker pages above.
      </p>
      <DataTable
        columns={opportunityColumns}
        rows={analyzed.unicorns || []}
        emptyMessage="No high-traffic, low-bounce pages detected yet."
        defaultSort={{ key: 'bounce_rate', dir: 'asc' }}
        exportFileStem="bounce-low-bounce-pages"
      />
    </>
  );
}
