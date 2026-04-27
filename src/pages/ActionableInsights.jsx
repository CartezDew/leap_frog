import {
  LuLightbulb,
  LuCircleAlert,
  LuShieldAlert,
  LuSparkles,
  LuCheckCheck,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { PriorityBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import { formatInteger, formatPercent } from '../lib/formatters.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

  // Card 1 — overall briefing
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
    caption: 'Auto-extracted from your dataset by the rules in SKILL.md.',
    footer: (
      <>
        <strong>{high.length}</strong> high · <strong>{medium.length}</strong>{' '}
        medium · <strong>{low.length}</strong> wins
      </>
    ),
  };

  // Card 2 — top priority focus
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
  };

  // Card 4 — opportunities to leverage
  const highValueIds = num(usersSummary.high_engagement);
  const opportunityCount = unicorns.length + highValueIds;
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
  };

  return [insightsCard, topPriorityCard, riskCard, opportunitiesCard];
}

export function ActionableInsights() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const insights = analyzed.insights || [];
  const high = insights.filter((i) => i.priority === 'high');
  const medium = insights.filter((i) => i.priority === 'medium');
  const low = insights.filter(
    (i) => i.priority !== 'high' && i.priority !== 'medium',
  );

  const storyCards = buildStoryCards(analyzed);

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

      {insights.length === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No insights generated</h2>
          <p className="empty-state__body">
            Upload more complete data (Medium, Page Path, Source, City, User, Contact)
            to populate this list.
          </p>
        </div>
      ) : (
        <>
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
        </>
      )}
    </>
  );
}
