import { LuFile, LuLayers, LuSparkles, LuTriangleAlert } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { ContentMix } from '../components/ContentMix/ContentMix.jsx';
import { ConcentrationCard } from '../components/ConcentrationCard/ConcentrationCard.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import { eqsGrade } from '../lib/uniqueAnalytics.js';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';

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

  // 1. Best-performing content DNA
  const bestRole = mix
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.engagement_quality_score - a.engagement_quality_score)[0];
  if (bestRole) {
    const grade = eqsGrade(bestRole.engagement_quality_score);
    cards.push({
      tone: grade.tone === 'good' ? 'green' : grade.tone === 'amber' ? 'amber' : 'red',
      icon: LuSparkles,
      label: 'Strongest content DNA',
      value: bestRole.role,
      headline: `Engagement Quality Score ${bestRole.engagement_quality_score} (${grade.grade})`,
      caption: `${bestRole.page_count} page${bestRole.page_count === 1 ? '' : 's'} drove ${formatPercent(bestRole.session_share, 0)} of sessions at ${formatPercent(bestRole.bounce_rate, 0)} bounce.`,
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
      headline: `Underperforming at EQS ${worstRole.engagement_quality_score}`,
      caption: `Bounce ${formatPercent(worstRole.bounce_rate, 0)} on ${formatInteger(worstRole.sessions)} sessions. Audit copy, layout, or CTAs across these ${worstRole.page_count} page${worstRole.page_count === 1 ? '' : 's'}.`,
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

      <h2 className="section-header">Top 25 <em>pages</em></h2>
      <DataTable
        columns={pageColumns}
        rows={pages.top_pages || []}
        emptyMessage="Page path data not provided in this upload."
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
