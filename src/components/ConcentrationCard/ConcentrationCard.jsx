// Concentration / diversification card — portfolio-style view of how much
// traffic piles into a few pages, sources, or cities vs spreading out.
//
// We lead with plain language and "% of sessions" (what clients care about),
// then optional depth: "effective number" + HHI in a footnote for analysts.

import { LuLayers, LuTrendingDown, LuTrendingUp } from 'react-icons/lu';
import { formatPercent } from '../../lib/formatters.js';

const DIMENSION_COPY = {
  pages: {
    singular: 'page',
    plural: 'pages',
    sessionPhrase: 'sessions landing on each page',
    largestLabel: 'busiest page',
  },
  sources: {
    singular: 'source',
    plural: 'sources',
    sessionPhrase: 'sessions by acquisition source',
    largestLabel: 'top source',
  },
  cities: {
    singular: 'city',
    plural: 'cities',
    sessionPhrase: 'sessions by city',
    largestLabel: 'busiest city',
  },
};

function toneFor(hhi) {
  if (hhi < 1500) return 'green';
  if (hhi < 2500) return 'amber';
  return 'red';
}

function iconFor(hhi) {
  if (hhi < 1500) return <LuLayers size={20} />;
  if (hhi < 2500) return <LuTrendingDown size={20} />;
  return <LuTrendingUp size={20} />;
}

function LeadStory({ tone, copy, stats }) {
  const p1 = formatPercent(stats.top1, 0);
  const p3 = formatPercent(stats.top3, 0);
  const name = stats.top1_name;

  if (tone === 'green') {
    return (
      <p className="concentration__lead">
        Traffic is <strong>spread across many {copy.plural}</strong>. Your {copy.largestLabel}{' '}
        accounts for only <strong>{p1}</strong> of sessions
        {name ? (
          <>
            {' '}
            (<span className="concentration__name">{name}</span>)
          </>
        ) : null}
        , so you are not over-dependent on a single place in the list.
      </p>
    );
  }

  if (tone === 'amber') {
    return (
      <p className="concentration__lead">
        A <strong>noticeable share</strong> of sessions clusters in a few {copy.plural}: the top
        three together reach <strong>{p3}</strong>. That is fine if it matches your strategy; keep
        an eye on it if campaigns or budgets are tied to only a handful of {copy.plural}.
      </p>
    );
  }

  return (
    <p className="concentration__lead">
      Sessions are <strong>heavily concentrated</strong> in a small set of {copy.plural}.
      {name ? (
        <>
          {' '}
          <span className="concentration__name">{name}</span> alone drives <strong>{p1}</strong> of
          traffic
        </>
      ) : (
        <>
          {' '}
          Your largest {copy.singular} drives <strong>{p1}</strong> of traffic
        </>
      )}
      — a change in that slice would move overall numbers quickly.
    </p>
  );
}

const HHI_ABBR =
  'Herfindahl-Hirschman Index: each location’s share of sessions is squared and summed (scaled to 10,000). Lower means more spread out; higher means a few winners dominate. Antitrust benchmarks often treat under 1,500 as unconcentrated — we use the same cutoffs for session mix.';

export function ConcentrationCard({ title = 'Traffic concentration', dimension = 'pages', stats }) {
  if (!stats || !stats.count) return null;
  const tone = toneFor(stats.hhi);
  const copy = DIMENSION_COPY[dimension] || DIMENSION_COPY.pages;

  return (
    <article className={`concentration concentration--${tone}`}>
      <header className="concentration__head">
        <span className="concentration__icon" aria-hidden="true">{iconFor(stats.hhi)}</span>
        <div className="concentration__head-text">
          <p className="concentration__eyebrow">{title}</p>
          <p className="concentration__label">{stats.label}</p>
          <p className="concentration__scope">Based on {copy.sessionPhrase} in this export.</p>
        </div>
        <div className="concentration__head-stat" aria-label={`Largest ${copy.singular} share of sessions`}>
          <span className="concentration__head-stat-value">{formatPercent(stats.top1, 0)}</span>
          <span className="concentration__head-stat-label">from largest {copy.singular}</span>
        </div>
      </header>

      <LeadStory tone={tone} copy={copy} stats={stats} />

      <p className="concentration__grid-title">Cumulative share of all sessions</p>
      <dl className="concentration__grid">
        <div>
          <dt>Top 1 {copy.singular}</dt>
          <dd>{formatPercent(stats.top1, 0)}</dd>
        </div>
        <div>
          <dt>Top 3 {copy.plural}</dt>
          <dd>{formatPercent(stats.top3, 0)}</dd>
        </div>
        <div>
          <dt>Top 5 {copy.plural}</dt>
          <dd>{formatPercent(stats.top5, 0)}</dd>
        </div>
        <div>
          <dt>Top 10 {copy.plural}</dt>
          <dd>{formatPercent(stats.top10, 0)}</dd>
        </div>
      </dl>

      <p className="concentration__effective">
        <strong>Spread index:</strong> if every {copy.singular} sent the same traffic, you would need
        about <strong>{stats.effective.toFixed(1)}</strong> of them to match today’s pattern.{' '}
        <span className="concentration__effective-hint">
          (Higher = more even spread; lower = more “winner takes most”.)
        </span>
      </p>

      <p className="concentration__technical">
        <abbr title={HHI_ABBR}>HHI {stats.hhi.toLocaleString()}</abbr>
        <span aria-hidden="true"> · </span>
        <span className="concentration__technical-meta">
          {stats.count.toLocaleString()} {copy.plural} in data
        </span>
      </p>
    </article>
  );
}
