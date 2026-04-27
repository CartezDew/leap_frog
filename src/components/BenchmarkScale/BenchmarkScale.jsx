// Bounce-rate industry benchmark scale.
//
// Renders the 4-tier B2B services scale (Excellent / Good / Average / Poor)
// as a horizontal gradient with:
//   - tier band labels and percentage breakpoints,
//   - the industry median reference line,
//   - a marker pinned at the site's actual bounce rate, and
//   - optional channel/page comparison markers underneath.
//
// All positioning is class-based (1% buckets) — no inline styles.

import { LuTriangleAlert, LuTrophy } from 'react-icons/lu';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

const TIER_TONES = {
  excellent: 'green',
  good: 'green-soft',
  average: 'amber',
  poor: 'red',
};

function bucket(rate) {
  if (!Number.isFinite(rate)) return 0;
  const clamped = Math.max(0, Math.min(1, rate));
  return Math.round(clamped * 100); // 0..100 buckets, 1% precision
}

function tonePill(tier) {
  if (!tier) return 'amber';
  return TIER_TONES[tier.id] || 'amber';
}

function deltaCopy(delta) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.005) {
    return 'on the industry median';
  }
  const points = (Math.abs(delta) * 100).toFixed(1);
  if (delta > 0) return `${points} pts better than the industry median`;
  return `${points} pts worse than the industry median`;
}

function ChannelRow({ row }) {
  if (!row) return null;
  const pos = bucket(row.bounce_rate);
  const tone = tonePill(row.tier);
  return (
    <li className={`bench-row bench-row--${tone}`}>
      <div className="bench-row__head">
        <span className="bench-row__name">{row.name}</span>
        <span className="bench-row__meta">
          {formatInteger(row.sessions)} sessions · {formatPercent(row.bounce_rate, 1)}
        </span>
      </div>
      <div className="bench-row__track" aria-hidden="true">
        <div className="bench-row__gradient" />
        <span className={`bench-row__marker bench-row__marker--p-${pos}`} />
      </div>
    </li>
  );
}

export function BenchmarkScale({ benchmark, channels = [], pages = [] }) {
  if (!benchmark || !benchmark.site) return null;

  const { site, tiers, industry_median: median, distribution = [] } = benchmark;
  const sitePos = bucket(site.rate);
  const medianPos = bucket(median);
  const tone = tonePill(site.tier);

  const totalSessions = (distribution[0] && distribution[0].total_sessions) || 0;

  return (
    <section className="bench" aria-label="Bounce-rate industry benchmark">
      <header className="bench__head">
        <div className="bench__intro">
          <p className="bench__eyebrow">Industry benchmark — B2B services</p>
          <h3 className="bench__title">
            Where Leapfrog <em>actually</em> lands
          </h3>
          <p className="bench__sub">
            Site-wide bounce mapped against the four-tier B2B services scale
            (Excellent &lt; 30% · Good 30–40% · Average 40–55% · Poor &gt; 55%).
          </p>
        </div>
        <div className={`bench__verdict bench__verdict--${tone}`}>
          <span className="bench__verdict-icon" aria-hidden="true">
            {site.tier?.id === 'poor' || site.tier?.id === 'average' ? (
              <LuTriangleAlert size={20} />
            ) : (
              <LuTrophy size={20} />
            )}
          </span>
          <div className="bench__verdict-text">
            <p className="bench__verdict-rate">{formatPercent(site.rate, 1)}</p>
            <p className="bench__verdict-tier">{site.tier?.label}</p>
            <p className="bench__verdict-delta">{deltaCopy(site.delta_vs_median)}</p>
          </div>
        </div>
      </header>

      <div className={`bench__scale bench__scale--${tone}`}>
        <div className="bench__bands" aria-hidden="true">
          {tiers.map((t) => (
            <div
              key={t.id}
              className={`bench__band bench__band--${TIER_TONES[t.id]}`}
            >
              <span className="bench__band-label">{t.label}</span>
              <span className="bench__band-range">
                {Math.round(t.min * 100)}–{Math.round(t.max * 100)}%
              </span>
            </div>
          ))}
        </div>

        <div className="bench__track" aria-hidden="true">
          <div className="bench__track-gradient" />

          <span
            className={`bench__median bench__median--p-${medianPos}`}
            aria-hidden="true"
          >
            <span className="bench__median-label">Industry median</span>
          </span>

          <span
            className={`bench__marker bench__marker--p-${sitePos} bench__marker--${tone}`}
            role="img"
            aria-label={`Leapfrog site bounce rate ${formatPercent(site.rate, 1)} — ${site.tier?.label}`}
          >
            <span className="bench__marker-dot" />
            <span className="bench__marker-callout">
              <strong>Leapfrog</strong>
              <em>{formatPercent(site.rate, 1)}</em>
            </span>
          </span>
        </div>

        <div className="bench__axis" aria-hidden="true">
          <span>0%</span>
          <span>30%</span>
          <span>40%</span>
          <span>55%</span>
          <span>100%</span>
        </div>
      </div>

      {distribution.length > 0 && totalSessions > 0 && (
        <div className="bench__dist">
          <p className="bench__dist-head">Session volume by tier</p>
          <ul className="bench__dist-list">
            {distribution.map((d) => (
              <li
                key={d.id}
                className={`bench__dist-row bench__dist-row--${TIER_TONES[d.id]}`}
              >
                <span className="bench__dist-label">{d.label}</span>
                <span className="bench__dist-value">
                  {formatPercent(d.share, 0)} of sessions
                </span>
                <span className="bench__dist-meta">
                  {d.channel_count} {d.channel_count === 1 ? 'channel' : 'channels'}
                  {d.channels.length > 0 && d.channels.length <= 4 && (
                    <>: {d.channels.join(', ')}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {channels.length > 0 && (
        <div className="bench__rows">
          <p className="bench__rows-head">Top channels on the same scale</p>
          <ul className="bench__row-list">
            {channels.slice(0, 6).map((c) => (
              <ChannelRow key={c.name} row={c} />
            ))}
          </ul>
        </div>
      )}

      {pages.length > 0 && (
        <div className="bench__rows">
          <p className="bench__rows-head">High-traffic pages on the same scale</p>
          <ul className="bench__row-list">
            {pages.slice(0, 6).map((p) => (
              <ChannelRow key={p.name} row={p} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
