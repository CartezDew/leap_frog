import {
  LuUsers,
  LuStar,
  LuCalendarRange,
  LuShieldAlert,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { BotBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  formatInteger,
  formatPercent,
  formatSeconds,
} from '../lib/formatters.js';

const userColumns = [
  {
    key: 'user_id',
    header: 'User ID',
    className: 'col-strong text-mono',
    format: (v) => (v ? String(v).slice(0, 32) + (String(v).length > 32 ? '…' : '') : '—'),
  },
  { key: 'id_type', header: 'Type' },
  {
    key: 'persona',
    header: 'Persona',
  },
  {
    key: 'total_sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'avg_session_duration',
    header: 'Avg Duration',
    align: 'right',
    format: (v) => formatSeconds(v),
  },
  {
    key: 'engagement_rate',
    header: 'Engagement',
    align: 'right',
    format: (v) => formatPercent(v),
  },
  {
    key: 'months_active',
    header: 'Months',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'bot_classification',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
  },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildStoryCards({ usersSummary, benchmarks, users, multiMonth }) {
  const totalIds = num(usersSummary.total_ids);
  const cleanHuman = num(usersSummary.clean_human);
  const cleanRate = totalIds ? cleanHuman / totalIds : 0;

  const highEng = num(usersSummary.high_engagement);
  const highEngRate = totalIds ? highEng / totalIds : 0;

  const multiMonthCount = num(usersSummary.multi_month);
  const multiMonthRate = totalIds ? multiMonthCount / totalIds : 0;
  const avgMonthsActive = benchmarks?.avg_months_active || 0;

  const confirmed = num(usersSummary.confirmed_bot);
  const likely = num(usersSummary.likely_bot);
  const suspicious = num(usersSummary.suspicious);
  const botExposure = confirmed + likely;
  const botRate = totalIds ? botExposure / totalIds : 0;
  const botTone =
    botRate >= 0.2 ? 'red' : botRate >= 0.05 ? 'amber' : 'green';

  // Card 1 — Identifiable audience
  const audienceCard = {
    id: 'audience',
    tone: 'purple',
    icon: LuUsers,
    label: 'Identifiable audience',
    value: formatInteger(totalIds),
    headline:
      totalIds === 0
        ? 'No User IDs detected yet.'
        : cleanRate >= 0.7
          ? 'Strong signal-to-noise ratio.'
          : cleanRate >= 0.4
            ? 'Mixed quality — review the bot exposure card.'
            : 'Low signal — most IDs trip a bot or fractional rule.',
    caption: 'Distinct effective user IDs detected across the period.',
    footer: (
      <>
        <strong>{formatPercent(cleanRate, 0)}</strong> classified clean human
      </>
    ),
  };

  // Card 2 — High-value cohort
  const avgDuration = benchmarks?.avg_session_duration || 0;
  const avgEngagement = benchmarks?.avg_engagement_rate || 0;
  const highValueCard = {
    id: 'high-value',
    tone: 'green',
    icon: LuStar,
    label: 'High-value cohort',
    value: formatInteger(highEng),
    headline:
      highEng === 0
        ? 'No high-engagement users yet.'
        : `Avg ${formatSeconds(avgDuration)} per session.`,
    caption:
      highEng === 0
        ? 'Need more sessions per ID to qualify them as high-engagement.'
        : 'Returning IDs with deep sessions and meaningful engagement.',
    footer:
      highEng > 0 ? (
        <>
          <strong>{formatPercent(highEngRate, 0)}</strong> of all IDs ·{' '}
          {formatPercent(avgEngagement, 0)} engagement
        </>
      ) : (
        <>Use as targeting templates once they appear.</>
      ),
  };

  // Card 3 — Long-funnel researchers
  const longestUser = [...(users || [])]
    .filter((u) => u.is_multi_month)
    .sort((a, b) => num(b.months_active) - num(a.months_active))[0];
  const longestPersona = longestUser?.persona;

  const longFunnelCard = {
    id: 'long-funnel',
    tone: 'info',
    icon: LuCalendarRange,
    label: 'Long-funnel researchers',
    value: formatInteger(multiMonthCount),
    headline:
      multiMonthCount === 0
        ? 'No multi-month researchers yet.'
        : avgMonthsActive >= 4
          ? `Active ${avgMonthsActive.toFixed(1)} months on average.`
          : `Active across ${avgMonthsActive.toFixed(1)} months on average.`,
    caption:
      multiMonthCount === 0
        ? 'Users active across 3+ months will appear here as data accumulates.'
        : 'IDs returning across 3+ months — sequence remarketing accordingly.',
    footer:
      multiMonthCount > 0 ? (
        <>
          <strong>{formatPercent(multiMonthRate, 0)}</strong> of IDs
          {longestPersona ? (
            <>
              {' '}· top persona <strong>{longestPersona}</strong>
            </>
          ) : null}
        </>
      ) : (
        <>Long-funnel B2B research behaviour.</>
      ),
  };

  // Card 4 — Bot exposure
  const botCard = {
    id: 'bot-exposure',
    tone: botTone,
    icon: LuShieldAlert,
    label: 'Bot exposure',
    value: formatInteger(botExposure),
    headline:
      botExposure === 0 && suspicious === 0
        ? 'No bot-flagged IDs detected.'
        : botRate >= 0.2
          ? 'Heavy bot pressure — exclude before reporting.'
          : botRate >= 0.05
            ? 'Some bot pressure — keep an eye on it.'
            : 'Low bot pressure.',
    caption: `Confirmed + likely-bot IDs. ${suspicious} additional ID${suspicious === 1 ? '' : 's'} flagged suspicious.`,
    footer: (
      <>
        <strong>{formatPercent(botRate, 0)}</strong> of all IDs ·{' '}
        {formatInteger(confirmed)} confirmed · {formatInteger(likely)} likely
      </>
    ),
  };

  return [audienceCard, highValueCard, longFunnelCard, botCard];
}

export function UserEngagement() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const sum = analyzed.users_summary || {};
  const benchmarks = analyzed.users_benchmarks;
  const users = analyzed.users || [];
  const top50 = users.slice(0, 50);
  const multiMonth = users.filter((u) => u.is_multi_month).slice(0, 50);

  if (users.length === 0) {
    return (
      <EmptyState
        title="No User sheet detected"
        body="Upload a workbook that includes a User sheet (Effective User ID + Sessions + Engaged sessions) to populate this view."
      />
    );
  }

  const storyCards = buildStoryCards({
    usersSummary: sum,
    benchmarks,
    users,
    multiMonth,
  });

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="User ID Engagement"
        subtitle="Per-user behaviour, persona assignment, and bot screening."
      />

      <StoryCards
        cards={storyCards}
        columns={4}
        eyebrow="Audience snapshot"
        title={
          <>
            Who's <em>actually</em> behind the IDs
          </>
        }
      />

      <div className="card-grid card-grid--cols-4">
        <KpiCard label="Total IDs" value={formatInteger(sum.total_ids)} />
        <KpiCard label="Clean Human" value={formatInteger(sum.clean_human)} accent="green" />
        <KpiCard label="High-Engagement" value={formatInteger(sum.high_engagement)} accent="green" />
        <KpiCard label="Multi-Month" value={formatInteger(sum.multi_month)} />
      </div>

      <div className="card-grid card-grid--cols-4">
        <KpiCard label="Confirmed Bot" value={formatInteger(sum.confirmed_bot)} accent="red" />
        <KpiCard label="Likely Bot" value={formatInteger(sum.likely_bot)} accent="amber" />
        <KpiCard label="Suspicious" value={formatInteger(sum.suspicious)} accent="amber" />
        <KpiCard label="Fractional / AMP" value={`${formatInteger(sum.fractional)} / ${formatInteger(sum.amp)}`} />
      </div>

      {benchmarks && (
        <>
          <h2 className="section-header">High-engagement <em>benchmarks</em></h2>
          <p className="section-subhead">
            Average behaviour of the {formatInteger(benchmarks.user_count)} highest-quality
            user IDs — use these as targeting templates.
          </p>
          <div className="card-grid card-grid--cols-4">
            <KpiCard
              label="Avg Session Duration"
              value={formatSeconds(benchmarks.avg_session_duration)}
            />
            <KpiCard
              label="Views / Session"
              value={(benchmarks.avg_views_per_session || 0).toFixed(1)}
            />
            <KpiCard
              label="Events / Session"
              value={(benchmarks.avg_events_per_session || 0).toFixed(1)}
            />
            <KpiCard
              label="Engagement Rate"
              value={formatPercent(benchmarks.avg_engagement_rate)}
            />
          </div>
        </>
      )}

      <h2 className="section-header">Top engaged <em>user IDs</em></h2>
      <DataTable columns={userColumns} rows={top50} hint="Top 50 by total sessions." />

      {multiMonth.length > 0 && (
        <>
          <h2 className="section-header">Multi-month <em>researchers</em></h2>
          <p className="section-subhead">
            Users active across 3+ months — long-funnel B2B research behaviour.
          </p>
          <DataTable columns={userColumns} rows={multiMonth} hint="Up to 50 shown." />
        </>
      )}
    </>
  );
}
