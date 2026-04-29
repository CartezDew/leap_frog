import {
  LuLightbulb,
  LuCircleAlert,
  LuShieldAlert,
  LuSparkles,
  LuCheckCheck,
  LuSearch,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { EmptyState, NeedsGA4EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { PriorityBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import { formatInteger, formatPercent } from '../lib/formatters.js';
import { runKeywordAnalysis } from '../lib/keywordAnalyzer.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Map an insight `id` to the dashboard route most relevant to it.
// Used as a fallback when the insight doesn't ship its own
// `playbook.where_to_look.route`.
function routeForInsight(insight) {
  if (!insight) return null;
  const fromPlaybook = insight.playbook?.where_to_look?.route;
  if (fromPlaybook) return fromPlaybook;

  const id = String(insight.id || '');
  if (id.startsWith('site-bounce') || id.startsWith('homepage-spike'))
    return '/bounce';
  if (id.startsWith('worst-channel') || id.startsWith('scale-channel'))
    return '/sources';
  if (id === 'ai-search-emerging' || id === 'email-quality') return '/sources';
  if (id === 'new-users-low' || id === 'new-users-very-high') return '/sources';
  if (id === 'refresh-candidates' || id === 'page-concentration')
    return '/pages';
  if (id === 'unicorn-pages') return '/unicorns';
  if (id.startsWith('sales-leads') || id === 'contact-spam') return '/contact';
  if (id === 'multi-month-research' || id === 'fractional-cookies')
    return '/users';
  if (id === 'bot-filter') return '/bots';
  if (id === 'monthly-anomalies' || id === 'trust-score') return '/overview';
  return '/overview';
}

function buildStoryCards(analyzed) {
  const insights = analyzed?.insights || [];
  const summary = analyzed?.summary || {};
  const opportunities = analyzed?.opportunities || [];
  const unicorns = analyzed?.unicorns || [];
  const usersSummary = analyzed?.users_summary || {};
  const bots = analyzed?.bots?.summary || {};

  const high = insights.filter((i) => i.priority === 'high');
  const medium = insights.filter((i) => i.priority === 'medium');
  const low = insights.filter(
    (i) => i.priority !== 'high' && i.priority !== 'medium',
  );

  const totalSessions = num(summary.total_sessions);

  // Card 1 — overall briefing. Clicking jumps to the full insights list
  // further down the page (anchor lives above the High priority section).
  const insightsCard = {
    id: 'insights-generated',
    tone: high.length > 0 ? 'red' : medium.length > 0 ? 'amber' : 'green',
    icon: LuLightbulb,
    label: 'Insights generated',
    value: formatInteger(insights.length),
    headline:
      insights.length === 0
        ? 'No insights yet — upload more data.'
        : high.length > 0
          ? `${high.length} need attention this week.`
          : medium.length > 0
            ? 'Mostly stable — a few things worth tracking.'
            : 'All systems healthy.',
    caption:
      'Detected automatically from patterns in your uploaded workbook.',
    footer: (
      <>
        <strong>{high.length}</strong> high · <strong>{medium.length}</strong>{' '}
        medium · <strong>{low.length}</strong> wins
      </>
    ),
    to: insights.length > 0 ? '#insights-list' : null,
    ctaLabel: 'See full list',
  };

  // Card 2 — top priority focus. Clicking jumps to the dashboard page that
  // backs that specific insight (uses the playbook hint when the signal
  // ships one, otherwise an id-based fallback).
  const top = high[0] || medium[0] || low[0];
  const topPriorityCard = top
    ? {
        id: 'top-priority',
        tone:
          top.priority === 'high'
            ? 'red'
            : top.priority === 'medium'
              ? 'amber'
              : 'green',
        icon: LuCircleAlert,
        label: 'Top priority',
        value:
          top.priority === 'high'
            ? 'Critical'
            : top.priority === 'medium'
              ? 'Watch'
              : 'Low',
        headline: top.title,
        caption: top.evidence,
        footer:
          high.length > 1
            ? `+${high.length - 1} more high-priority item${high.length - 1 === 1 ? '' : 's'}`
            : medium.length > 0
              ? `+${medium.length} medium-priority follow-up${medium.length === 1 ? '' : 's'}`
              : 'No further high-priority items.',
        to: routeForInsight(top),
        ctaLabel:
          top.playbook?.where_to_look?.label
            ? `Open ${top.playbook.where_to_look.label}`
            : 'Open the data',
      }
    : {
        id: 'top-priority',
        tone: 'green',
        icon: LuCheckCheck,
        label: 'Top priority',
        value: 'Clear',
        headline: 'Nothing critical detected.',
        caption: 'Keep monitoring for changes month-over-month.',
        footer: 'Re-run after the next GA4 export.',
      };

  // Card 3 — risk concentration
  const confirmedBotSessions = num(bots.confirmed_bot_sessions);
  const likelyBotSessions = num(bots.likely_bot_sessions);
  const opportunitySessions = opportunities.reduce(
    (acc, p) => acc + num(p.sessions),
    0,
  );
  const atRiskSessions =
    confirmedBotSessions + likelyBotSessions + opportunitySessions;
  const atRiskShare = totalSessions ? atRiskSessions / totalSessions : 0;

  const riskTone =
    atRiskShare >= 0.25 ? 'red' : atRiskShare >= 0.1 ? 'amber' : 'green';

  // Send the user to whichever page best explains the risk: bots tab when
  // bot traffic dominates the at-risk pool, page-path tab when bleeding
  // pages do.
  const botSessionsTotal = confirmedBotSessions + likelyBotSessions;
  const riskRoute = botSessionsTotal > opportunitySessions ? '/bots' : '/pages';
  const riskCtaLabel =
    riskRoute === '/bots' ? 'Open bot intelligence' : 'Open page analysis';
  const riskCard = {
    id: 'sessions-at-risk',
    tone: riskTone,
    icon: LuShieldAlert,
    label: 'Sessions at risk',
    value: formatInteger(atRiskSessions),
    headline:
      opportunities.length > 0 || confirmedBotSessions + likelyBotSessions > 0
        ? `${opportunities.length} bleeding pages + bot traffic.`
        : 'No major risk signals detected.',
    caption: 'High-bounce traffic + sessions from confirmed and likely bots.',
    footer: (
      <>
        <strong>{formatPercent(atRiskShare, 1)}</strong> of total sessions
      </>
    ),
    to: atRiskSessions > 0 ? riskRoute : null,
    ctaLabel: riskCtaLabel,
  };

  // Card 4 — opportunities to leverage
  const highValueIds = num(usersSummary.high_engagement);
  const opportunityCount = unicorns.length + highValueIds;
  // Prefer the Unicorn Pages tab when there are unicorns; otherwise drop
  // into the User ID Engagement tab where the high-value IDs live.
  const opportunitiesRoute =
    unicorns.length > 0 ? '/unicorns' : highValueIds > 0 ? '/users' : null;
  const opportunitiesCtaLabel =
    opportunitiesRoute === '/unicorns'
      ? 'See unicorn pages'
      : 'See top user IDs';
  const opportunitiesCard = {
    id: 'opportunities',
    tone: 'green',
    icon: LuSparkles,
    label: 'Assets to leverage',
    value: formatInteger(opportunityCount),
    headline:
      opportunityCount === 0
        ? 'No standout assets identified yet.'
        : `${unicorns.length} unicorn page${unicorns.length === 1 ? '' : 's'} + ${highValueIds} elite user ID${highValueIds === 1 ? '' : 's'}.`,
    caption:
      'Pages with strong engagement and IDs that return repeatedly — copy what works.',
    footer:
      unicorns[0]?.page
        ? (
            <>
              Best page <strong>{unicorns[0].page}</strong>
            </>
          )
        : 'Replicate winning patterns across the site.',
    to: opportunitiesRoute,
    ctaLabel: opportunitiesCtaLabel,
  };

  return [insightsCard, topPriorityCard, riskCard, opportunitiesCard];
}

function buildKeywordCard(analyzed) {
  const kw = runKeywordAnalysis(analyzed);
  const trend = kw.trend.national || [];
  const latest = trend[trend.length - 1];
  if (!latest) return null;

  const quickWin = kw.insights.quick_wins[0];
  const mover = kw.insights.movers[0];
  const decliner = kw.insights.decliners[0];
  const headlineParts = [];
  if (mover) {
    headlineParts.push(
      `${mover.keyword} climbed to #${mover.latest.position}`,
    );
  } else if (quickWin) {
    headlineParts.push(
      `${quickWin.keyword} is one push from page 1 (#${quickWin.latest.position})`,
    );
  }
  const tone =
    decliner && decliner.mom_delta < -10 ? 'amber' : mover ? 'green' : 'purple';

  return {
    id: 'keyword-intel',
    tone,
    icon: LuSearch,
    label: 'SEO keyword intel',
    value: `${formatInteger(latest.top10)} on page 1`,
    headline:
      headlineParts.length > 0
        ? headlineParts.join('. ')
        : `${formatInteger(latest.tracked)} keywords tracked across Semrush exports.`,
    caption: `Avg national position #${(latest.avg_position || 0).toFixed(1)} · est. value $${formatInteger(latest.est_monthly_value)}/mo`,
    footer: kw.cross.underperforming.length
      ? `${kw.cross.underperforming.length} ranked page${
          kw.cross.underperforming.length === 1 ? '' : 's'
        } bleeding visitors — fix on-page first`
      : `${kw.cross.page_matches.length} keyword/landing-page match${
          kw.cross.page_matches.length === 1 ? '' : 'es'
        } found`,
    to: '/keywords',
    ctaLabel: 'Open Keyword Intel',
  };
}

export function ActionableInsights() {
  const { hasData, hasGA4, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;
  // Insights are derived from the GA4 Excel workbook; if only a Semrush PDF
  // was uploaded there is nothing to show here.
  if (!hasGA4) return <NeedsGA4EmptyState pageLabel="Actionable Insights" icon={LuLightbulb} />;

  const insights = analyzed.insights || [];
  const high = insights.filter((i) => i.priority === 'high');
  const medium = insights.filter((i) => i.priority === 'medium');
  const low = insights.filter(
    (i) => i.priority !== 'high' && i.priority !== 'medium',
  );

  const storyCards = buildStoryCards(analyzed);
  const keywordCard = buildKeywordCard(analyzed);

  const Section = ({ title, list }) =>
    list.length ? (
      <>
        <h2 className="section-header">{title}</h2>
        <div className="card-grid">
          {list.map((ins, i) => (
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
    ) : null;

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Actionable Insights"
        subtitle="Auto-generated playbook from your dataset. Each insight ties back to specific cells, pages, or user IDs."
      />

      <StoryCards
        cards={storyCards}
        columns={4}
        eyebrow="At a glance"
        title={
          <>
            What the data is <em>telling you</em>
          </>
        }
      />

      {keywordCard && (
        <StoryCards
          cards={[keywordCard]}
          columns={1}
          eyebrow="Search · Semrush"
          title={
            <>
              SEO momentum <em>connected</em> to your traffic
            </>
          }
          ariaLabel="SEO keyword intelligence callout"
        />
      )}

      {insights.length === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No insights generated</h2>
          <p className="empty-state__body">
            Upload more complete data (Medium, Page Path, Source, City, User, Contact)
            to populate this list.
          </p>
        </div>
      ) : (
        <div id="insights-list">
          <Section
            title={
              <>
                High <em>priority</em>
              </>
            }
            list={high}
          />
          <Section
            title={
              <>
                Medium <em>priority</em>
              </>
            }
            list={medium}
          />
          <Section
            title={
              <>
                Wins &amp; <em>lower priority</em>
              </>
            }
            list={low}
          />
        </div>
      )}
    </>
  );
}
