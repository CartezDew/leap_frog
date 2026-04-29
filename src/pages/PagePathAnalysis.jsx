import {
  LuFile,
  LuFilePen,
  LuLayers,
  LuSparkles,
  LuTrendingDown,
  LuTriangleAlert,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { ContentMix } from '../components/ContentMix/ContentMix.jsx';
import { ConcentrationCard } from '../components/ConcentrationCard/ConcentrationCard.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';
import { summarizeAiSources } from '../lib/levers.js';

const pageColumns = [
  { key: 'page', header: 'Page Path', className: 'col-strong' },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'total_users',
    header: 'Users',
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
    key: 'event_count',
    header: 'Events',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  { key: 'content_role', header: 'Role' },
];

function buildPageStoryCards({ analyzed }) {
  const cards = [];
  const pages = analyzed.pages?.top_pages || [];
  const unique = analyzed.unique || {};
  const mix = unique.content_mix || [];
  const conc = unique.concentration?.pages;
  const totalSessions = pages.reduce((acc, p) => acc + (p.sessions || 0), 0);
  const unicornCount = (analyzed.unicorns || []).length;
  const opportunityCount = (analyzed.opportunities || []).length;

  // 1. Best-performing content DNA — ranked by the underlying quality score
  // but described to the user in plain English (lowest bounce / strongest
  // engagement) so we never have to surface the abstract EQS number.
  const bestRole = mix
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.engagement_quality_score - a.engagement_quality_score)[0];
  if (bestRole) {
    const bestBounce = bestRole.bounce_rate || 0;
    const bestTone = bestBounce <= 0.35 ? 'green' : bestBounce <= 0.5 ? 'amber' : 'red';
    cards.push({
      tone: bestTone,
      icon: LuSparkles,
      label: 'Strongest content DNA',
      value: bestRole.role,
      headline: `Lowest bounce of any role at ${formatPercent(bestBounce, 0)}`,
      caption: `${bestRole.page_count} page${bestRole.page_count === 1 ? '' : 's'} drove ${formatPercent(bestRole.session_share, 0)} of sessions and held attention for ${(bestRole.avg_engagement_time || 0).toFixed(1)}s on average.`,
    });
  }

  // 2. Weakest content DNA — biggest fix
  const worstRole = mix
    .filter((r) => r.sessions > 0)
    .sort((a, b) => a.engagement_quality_score - b.engagement_quality_score)[0];
  if (worstRole && worstRole !== bestRole) {
    cards.push({
      tone: 'red',
      icon: LuTriangleAlert,
      label: 'Biggest fix',
      value: worstRole.role,
      headline: `Highest bounce of any role at ${formatPercent(worstRole.bounce_rate, 0)}`,
      caption: `${formatInteger(worstRole.sessions)} sessions on ${worstRole.page_count} page${worstRole.page_count === 1 ? '' : 's'}. Audit copy, layout, or CTAs — this is where attention is leaking fastest.`,
    });
  }

  // 3. Concentration / dependency risk
  if (conc && conc.count > 0) {
    let tone = 'green';
    if (conc.hhi >= 2500) tone = 'red';
    else if (conc.hhi >= 1500) tone = 'amber';
    cards.push({
      tone,
      icon: LuLayers,
      label: 'Page concentration',
      value: formatPercent(conc.top5, 0),
      headline: `Top 5 pages capture ${formatPercent(conc.top5, 0)} of sessions`,
      caption: `${conc.label} — site behaves as if it had ${conc.effective.toFixed(1)} equally-loaded pages. HHI ${conc.hhi.toLocaleString()}.`,
    });
  }

  // 4. Unicorns vs Opportunities
  cards.push({
    tone: unicornCount > opportunityCount ? 'green' : opportunityCount > unicornCount ? 'amber' : 'info',
    icon: LuFile,
    label: 'Page health balance',
    value: `${unicornCount} ⇄ ${opportunityCount}`,
    headline: unicornCount > opportunityCount
      ? `${unicornCount} unicorn page${unicornCount === 1 ? '' : 's'} outweigh ${opportunityCount} bleeders`
      : `${opportunityCount} bleeder${opportunityCount === 1 ? '' : 's'} need attention`,
    caption: `Unicorns = high traffic + low bounce. Bleeders = high traffic + high bounce. ${pages.length ? `Across ${formatInteger(totalSessions)} top-page sessions.` : ''}`,
  });

  return cards;
}

const monthlyColumns = [
  { key: 'month_name', header: 'Month', className: 'col-strong' },
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
];

export function PagePathAnalysis() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;
  const pages = analyzed.pages || {};
  const unique = analyzed.unique || {};
  const storyCards = buildPageStoryCards({ analyzed });
  const refreshCandidates = (analyzed.opportunities || []).slice(0, 5);
  const aiSummary = summarizeAiSources(
    analyzed.sources || [],
    analyzed.summary?.total_sessions || 0,
  );
  const hasAiTraffic = aiSummary.matches.length > 0;

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Page Path Analysis"
        subtitle={`Top pages out of ${formatInteger(pages.all_pages_count || 0)} unique paths.`}
      />

      <StoryCards
        eyebrow="Page DNA briefing"
        title={<>Where attention <em>actually</em> lives</>}
        cards={storyCards}
        ariaLabel="Page DNA briefing callouts"
      />

      <ContentMix
        rows={unique.content_mix || []}
        title="Content mix performance"
        subtitle="Performance grouped by page DNA — the kind of analysis GA4 leaves to humans."
      />

      <h2 className="section-header">Where traffic <em>piles up</em></h2>
      <p className="section-subhead">
        Each card answers one question: are sessions spread across many pages or cities, or
        concentrated in a few? Percentages are shares of <strong>all sessions</strong> in this
        upload.
      </p>
      <div className="card-grid card-grid--cols-2">
        {unique.concentration?.pages && (
          <ConcentrationCard
            title="Page traffic concentration"
            dimension="pages"
            stats={unique.concentration.pages}
          />
        )}
        {unique.concentration?.cities && (
          <ConcentrationCard
            title="City traffic concentration"
            dimension="cities"
            stats={unique.concentration.cities}
          />
        )}
      </div>

      <h2 className="section-header">
        Refresh <em>candidates</em>
        <span className="section-header__hint">
          <LuTrendingDown size={14} aria-hidden="true" /> action list
        </span>
      </h2>
      <p className="section-subhead">
        High-traffic pages bleeding engagement. Rewrite the intro and add a clear next step
        on these first.
      </p>
      <article className="lever-card lever-card--alert lever-card--list">
        <header className="lever-card__head">
          <span className="lever-card__icon" aria-hidden="true">
            <LuFilePen size={18} />
          </span>
          <h3 className="lever-card__title">Pages to refresh first</h3>
          <span className="lever-card__hint">
            <LuTrendingDown size={14} aria-hidden="true" /> high-traffic, high-bounce
          </span>
        </header>
        <p className="lever-card__body">
          Pages with <strong>≥ 100 sessions</strong> and a <strong>bounce rate ≥ 45%</strong>
          {' '}— visitors land but don't engage. Common causes: search-intent mismatch, weak
          hook above the fold, missing CTA, or content that's gone stale.
        </p>
        {hasAiTraffic && (
          <p className="lever-card__body lever-card__body--note">
            <strong>AI-traffic caveat:</strong> with{' '}
            {formatInteger(aiSummary.total_sessions)} sessions from AI assistants this period,
            some bounce here may be ChatGPT/Perplexity/Claude reading the page and citing it
            — not a content problem. Cross-reference with the AI search visibility section on
            the Traffic Sources page before rewriting.
          </p>
        )}
        {refreshCandidates.length === 0 ? (
          <p className="muted">No high-bounce opportunities flagged.</p>
        ) : (
          <ul className="lever-list">
            {refreshCandidates.map((p) => (
              <li key={p.page}>
                <span className="lever-list__primary" title={p.page}>
                  {p.page}
                </span>
                <span className="lever-list__meta">
                  <strong>{formatInteger(p.sessions)}</strong> sessions ·{' '}
                  <span className="bounce-high">{formatPercent(p.bounce_rate, 1)}</span>{' '}
                  bounce
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <h2 className="section-header">Top 25 <em>pages</em></h2>
      <DataTable
        columns={pageColumns}
        rows={pages.top_pages || []}
        emptyMessage="Page path data not provided in this upload."
        defaultSort={{ key: 'sessions', dir: 'desc' }}
      />

      <h2 className="section-header">Contact page monthly <em>performance</em></h2>
      <DataTable
        columns={monthlyColumns}
        rows={pages.contact_monthly || []}
        emptyMessage="No /contact/* page data detected."
      />
    </>
  );
}
