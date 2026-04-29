import {
  LuUsers,
  LuStar,
  LuCalendarRange,
  LuShieldAlert,
  LuUserCheck,
  LuFlame,
  LuTarget,
  LuBookOpen,
  LuSearch,
  LuCrown,
  LuSparkles,
  LuActivity,
  LuClock,
  LuCalendar,
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
import { pickWarmProspects, shortenId } from '../lib/levers.js';

// Cleanest → dirtiest, used to sort the Classification badge column by the
// underlying severity instead of alphabetically.
const BOT_RANK = {
  human: 0,
  suspicious: 1,
  likely_bot: 2,
  confirmed_bot: 3,
};

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
    sortValue: (row) => BOT_RANK[row.bot_classification] ?? -1,
  },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// --- Warm prospects shortlist helpers -------------------------------------
// Persona → icon mapping. Falls back to LuUserCheck so a new persona never
// renders as a blank tile.
const PERSONA_ICON = {
  'Deep Researcher': LuSearch,
  'Intensive Evaluator': LuTarget,
  'High-Value Prospect': LuCrown,
  'Engaged Returning User': LuActivity,
  'Deep Reader': LuBookOpen,
  'Site Explorer': LuSparkles,
  'Strong Prospect': LuFlame,
  'Engaged Visitor': LuUserCheck,
};

// Tier mapping by rank index (0-based). Each tier picks a tone, a label, and
// the icon to show beside the rank number. Tiers compress as the list grows
// so the top half of any 8-card grid always reads as "act now".
const WARM_TIERS = [
  { tone: 'red', tag: 'Top pick', icon: LuCrown, top: true }, // rank 0
  { tone: 'amber', tag: 'Hot', icon: LuFlame }, // ranks 1-2
  { tone: 'amber', tag: 'Hot', icon: LuFlame },
  { tone: 'green', tag: 'Warm', icon: LuStar }, // ranks 3-4
  { tone: 'green', tag: 'Warm', icon: LuStar },
  { tone: 'purple', tag: 'Engaged', icon: LuSparkles }, // ranks 5+
  { tone: 'purple', tag: 'Engaged', icon: LuSparkles },
  { tone: 'purple', tag: 'Engaged', icon: LuSparkles },
];

function warmTierFor(rank) {
  return WARM_TIERS[rank] || WARM_TIERS[WARM_TIERS.length - 1];
}

// Mirrors the score used by pickWarmProspects() in levers.js so the warmth
// bar reflects the same ordering the list is sorted by.
function warmthScore(u) {
  return (
    num(u.engagement_rate) * num(u.total_sessions) +
    num(u.months_active) * 5 +
    num(u.avg_session_duration) / 30
  );
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
    caption: `Confirmed + likely-bot IDs. ${formatInteger(suspicious)} additional ID${suspicious === 1 ? '' : 's'} flagged suspicious.`,
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
  const warmProspects = pickWarmProspects(users, 8);
  const fractionalCount = num(sum.fractional);
  const ampCount = num(sum.amp);

  if (users.length === 0) {
    const meta = analyzed?.metadata || {};
    const classifications = meta.classifications || {};
    const sheetsByCategory = Object.entries(classifications).reduce(
      (acc, [name, cat]) => {
        acc[cat] = acc[cat] || [];
        acc[cat].push(name);
        return acc;
      },
      {},
    );
    const userSheets = sheetsByCategory.user || [];
    const analysisSheets = sheetsByCategory.analysis || [];
    const userWarnings = (meta.warnings || []).filter((w) =>
      /user/i.test(w),
    );

    const diag = (
      <>
        <p>
          Upload a workbook that includes a User sheet with at minimum{' '}
          <strong>User ID</strong> and <strong>Sessions</strong>. Optional but
          recommended: <em>Engaged Sessions</em> or <em>Engagement Rate</em>,{' '}
          <em>Months Active</em> / <em>Months List</em> / <em>Month</em>,{' '}
          <em>Avg Duration</em>, <em>Total Views</em>, <em>Total Events</em>.
        </p>
        {(userSheets.length > 0 || analysisSheets.length > 0) && (
          <ul className="empty-state__diag">
            {userSheets.length > 0 && (
              <li>
                <strong>Detected user sheets:</strong> {userSheets.join(', ')}
              </li>
            )}
            {analysisSheets.length > 0 && (
              <li>
                <strong>Treated as analysis tabs (passed through):</strong>{' '}
                {analysisSheets.join(', ')}
              </li>
            )}
            {userWarnings.length > 0 && (
              <li>
                <strong>Parser notes:</strong>
                <ul>
                  {userWarnings.slice(0, 4).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}
      </>
    );

    return (
      <EmptyState
        title={
          userSheets.length > 0
            ? 'User sheet detected but no rows extracted'
            : 'No User sheet detected'
        }
        body={diag}
        bodyAlign="start"
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

      {(fractionalCount > 0 || ampCount > 0) && (
        <article className="lever-card lever-card--alert lever-card--inline">
          <header className="lever-card__head">
            <span className="lever-card__icon" aria-hidden="true">
              <LuShieldAlert size={18} />
            </span>
            <h3 className="lever-card__title">Filter internal &amp; cross-device traffic</h3>
            <span className="lever-card__hint">action item</span>
          </header>
          <p className="lever-card__body">
            <strong>{formatInteger(fractionalCount)}</strong> fractional cookie IDs (.2 cross-device, .17/.18 Google Signals)
            {ampCount > 0 && <> and <strong>{formatInteger(ampCount)}</strong> AMP-wrapped IDs</>} are inflating
            your unique-user count. These are usually staff browsing on multiple devices or AMP cache hits, not new prospects.
            Add the Leapfrog office IP ranges in <em>GA4 Admin → Data Filters → Internal Traffic</em> and exclude these
            ID types from outbound lists.
          </p>
        </article>
      )}

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
      <DataTable
        columns={userColumns}
        rows={top50}
        hint="Top 50 by total sessions."
        defaultSort={{ key: 'total_sessions', dir: 'desc' }}
      />

      {multiMonth.length > 0 && (
        <>
          <h2 className="section-header">Multi-month <em>researchers</em></h2>
          <p className="section-subhead">
            Users active across 3+ months — long-funnel B2B research behaviour.
          </p>
          <DataTable
            columns={userColumns}
            rows={multiMonth}
            hint="Up to 50 shown."
            defaultSort={{ key: 'months_active', dir: 'desc' }}
          />
        </>
      )}

      <h2 className="section-header">
        Warm <em>prospects shortlist</em>
        <span className="section-header__hint">
          <LuUserCheck size={14} aria-hidden="true" />
          {warmProspects.length > 0
            ? `${warmProspects.length} to call`
            : 'action list'}
        </span>
      </h2>
      <p className="section-subhead">
        The cleanest IDs to hand-pick for proactive outreach this week — real humans
        showing buying behaviour, ranked by warmth.
      </p>

      <ul className="warm-filters" aria-label="Filters applied to this shortlist">
        <li className="warm-filter">
          <span className="warm-filter__dot" aria-hidden="true" />
          Bots excluded
        </li>
        <li className="warm-filter">
          <span className="warm-filter__dot" aria-hidden="true" />
          No fractional / cross-device IDs
        </li>
        <li className="warm-filter">
          <span className="warm-filter__dot" aria-hidden="true" />
          No AMP wrappers
        </li>
        <li className="warm-filter">
          <span className="warm-filter__dot" aria-hidden="true" />
          Bounce &lt; 70%
        </li>
        <li className="warm-filter">
          <span className="warm-filter__dot" aria-hidden="true" />
          Avg session ≥ 30s
        </li>
      </ul>

      {warmProspects.length === 0 ? (
        <p className="muted">No high-engagement clean human IDs detected yet.</p>
      ) : (
        <>
          <ul className="warm-grid">
            {warmProspects.map((u, i) => {
              const tier = warmTierFor(i);
              const Icon = PERSONA_ICON[u.persona] || LuUserCheck;
              const RankIcon = tier.icon;
              const topScore = warmthScore(warmProspects[0]) || 1;
              const fillPct = Math.max(
                35,
                Math.min(100, Math.round((warmthScore(u) / topScore) * 100)),
              );
              const cardClass = [
                'warm-card',
                `warm-card--${tier.tone}`,
                tier.top ? 'warm-card--top' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={u.user_id} className={cardClass}>
                  <div className="warm-card__head">
                    <span className="warm-card__rank">
                      <RankIcon size={14} aria-hidden="true" />#{i + 1}
                    </span>
                    <span className="warm-card__tag">{tier.tag}</span>
                  </div>

                  <div className="warm-card__persona">
                    <span className="warm-card__icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <div className="warm-card__persona-body">
                      <p className="warm-card__persona-name">
                        {u.persona || 'Engaged Visitor'}
                      </p>
                      <code className="warm-card__id" title={u.user_id}>
                        {shortenId(u.user_id)}
                      </code>
                    </div>
                  </div>

                  <div className="warm-card__warmth">
                    <div
                      className="warm-card__warmth-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={fillPct}
                      aria-label="Warmth score"
                    >
                      <div
                        className="warm-card__warmth-fill"
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                    <p className="warm-card__warmth-meta">
                      <span>Warmth</span>
                      <strong>{fillPct}%</strong>
                    </p>
                  </div>

                  <dl className="warm-card__stats">
                    <div className="warm-card__stat">
                      <dt>
                        <LuActivity size={11} aria-hidden="true" /> Sessions
                      </dt>
                      <dd>{formatInteger(u.total_sessions)}</dd>
                    </div>
                    <div className="warm-card__stat">
                      <dt>
                        <LuCalendar size={11} aria-hidden="true" /> Months
                      </dt>
                      <dd>{formatInteger(u.months_active)}</dd>
                    </div>
                    <div className="warm-card__stat">
                      <dt>
                        <LuFlame size={11} aria-hidden="true" /> Engaged
                      </dt>
                      <dd>{formatPercent(u.engagement_rate, 0)}</dd>
                    </div>
                    <div className="warm-card__stat">
                      <dt>
                        <LuClock size={11} aria-hidden="true" /> Avg time
                      </dt>
                      <dd>{formatSeconds(u.avg_session_duration)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <p className="warm-grid__footnote">
            Ranked by composite warmth = engagement × sessions + months × 5 + duration ÷ 30.
            Top {warmProspects.length} shown.
          </p>
        </>
      )}
    </>
  );
}
