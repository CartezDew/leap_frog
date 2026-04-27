// Concentration / Diversification card
//
// Borrowed from antitrust economics: the Herfindahl-Hirschman Index (HHI)
// for traffic distribution. Maps each "what % of sessions is the top X
// driving?" into a portfolio risk story:
//   < 1500 — diversified
//   1500-2500 — moderate dependency
//   > 2500 — high concentration / single point of failure
//
// Plus an "effective number" — how many distinct (equally-weighted) sources
// the site behaves as if it has.
//
// GA4 doesn't surface this. It's the missing portfolio question: "If our
// top page disappears tomorrow, how exposed are we?"

import { LuLayers, LuTrendingDown, LuTrendingUp } from 'react-icons/lu';
import { formatPercent } from '../../lib/formatters.js';

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

export function ConcentrationCard({ title = 'Traffic concentration', dimension = 'pages', stats }) {
  if (!stats || !stats.count) return null;
  const tone = toneFor(stats.hhi);

  return (
    <article className={`concentration concentration--${tone}`}>
      <header className="concentration__head">
        <span className="concentration__icon" aria-hidden="true">{iconFor(stats.hhi)}</span>
        <div>
          <p className="concentration__eyebrow">{title}</p>
          <p className="concentration__label">{stats.label}</p>
        </div>
        <span className="concentration__hhi">
          <strong>{stats.hhi.toLocaleString()}</strong>
          <em>HHI</em>
        </span>
      </header>

      <dl className="concentration__grid">
        <div>
          <dt>Top 1</dt>
          <dd>{formatPercent(stats.top1, 0)}</dd>
        </div>
        <div>
          <dt>Top 3</dt>
          <dd>{formatPercent(stats.top3, 0)}</dd>
        </div>
        <div>
          <dt>Top 5</dt>
          <dd>{formatPercent(stats.top5, 0)}</dd>
        </div>
        <div>
          <dt>Top 10</dt>
          <dd>{formatPercent(stats.top10, 0)}</dd>
        </div>
      </dl>

      <p className="concentration__effective">
        Site behaves as if it had{' '}
        <strong>{stats.effective.toFixed(1)}</strong> equally-weighted {dimension}.
      </p>
    </article>
  );
}
