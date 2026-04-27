// Content Mix performance — page DNA pivot
//
// Pages have a `content_role` (Homepage, Editorial, Service, Conversion
// Page, etc.). Pivoting performance per role answers questions GA4 leaves
// to humans: "is the blog actually pulling its weight?", "are service pages
// converting attention into engagement?".
//
// Each row shows count, session share, average bounce, average engagement
// time, and a single composite Engagement Quality Score so the reader can
// rank roles at a glance.

import { LuFile } from 'react-icons/lu';
import { bounceClass, formatInteger, formatPercent } from '../../lib/formatters.js';
import { eqsGrade } from '../../lib/uniqueAnalytics.js';

function shareWidth(pct) {
  // Snap session share into 5% buckets so we can drive width via a class
  // without inline styles.
  const clamped = Math.max(0, Math.min(1, pct));
  return Math.round(clamped * 20) * 5;
}

function ShareBar({ pct }) {
  const w = shareWidth(pct);
  return (
    <div className="cmx-share">
      <div className="cmx-share__track">
        <span className={`cmx-share__fill cmx-share__fill--w-${w}`} />
      </div>
      <span className="cmx-share__value">{formatPercent(pct, 0)}</span>
    </div>
  );
}

export function ContentMix({ rows = [], title = 'Content mix performance', subtitle }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return (
    <section className="cmx" aria-label={title}>
      <header className="cmx__head">
        <span className="cmx__icon" aria-hidden="true"><LuFile size={18} /></span>
        <div>
          <h3 className="cmx__title">{title}</h3>
          {subtitle && <p className="cmx__sub">{subtitle}</p>}
        </div>
      </header>
      <div className="cmx__table-wrap">
        <table className="cmx__table">
          <thead>
            <tr>
              <th>Page DNA</th>
              <th className="num">Pages</th>
              <th className="num">Sessions</th>
              <th>Share of sessions</th>
              <th className="num">Bounce</th>
              <th className="num">Avg Engagement</th>
              <th className="num">EQS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const grade = eqsGrade(r.engagement_quality_score);
              return (
                <tr key={r.role}>
                  <td className="cmx__role">
                    <span className={`cmx__role-dot cmx__role-dot--${grade.tone}`} aria-hidden="true" />
                    {r.role}
                  </td>
                  <td className="num">{formatInteger(r.page_count)}</td>
                  <td className="num">{formatInteger(r.sessions)}</td>
                  <td><ShareBar pct={r.session_share} /></td>
                  <td className="num">
                    <span className={bounceClass(r.bounce_rate)}>{formatPercent(r.bounce_rate, 0)}</span>
                  </td>
                  <td className="num">{(r.avg_engagement_time || 0).toFixed(1)}s</td>
                  <td className="num">
                    <span className={`cmx__eqs cmx__eqs--${grade.tone}`}>
                      <strong>{r.engagement_quality_score}</strong>
                      <em>{grade.grade}</em>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
