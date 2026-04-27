// Anomaly list — flags months that diverge from the year's baseline.
//
// GA4 has Insights but they don't run on this dataset and they're often
// noisy. This view computes a Z-score per metric across the monthly
// trend and highlights the top deviations with direction (spike vs dip)
// and which metric drove it.

import { LuTriangleAlert, LuTrendingDown, LuTrendingUp } from 'react-icons/lu';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

function metricLabel(metric) {
  switch (metric) {
    case 'sessions': return 'Sessions';
    case 'engaged_sessions': return 'Engaged Sessions';
    case 'bounce_rate': return 'Bounce Rate';
    case 'engagement_rate': return 'Engagement Rate';
    case 'total_users': return 'Users';
    case 'new_users': return 'New Users';
    case 'event_count': return 'Events';
    default: return metric;
  }
}

function formatMetric(metric, value) {
  if (metric === 'bounce_rate' || metric === 'engagement_rate') {
    return formatPercent(value, 1);
  }
  return formatInteger(value);
}

export function AnomalyList({ anomalies = [], stats = {}, title = 'Monthly anomalies' }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <article className="anomalies anomalies--empty">
        <header className="anomalies__head">
          <span className="anomalies__icon" aria-hidden="true">
            <LuTriangleAlert size={18} />
          </span>
          <div>
            <h3 className="anomalies__title">{title}</h3>
            <p className="anomalies__sub">No months exceeded the volatility threshold — the year was steady.</p>
          </div>
        </header>
      </article>
    );
  }

  // Show top 6 by absolute Z so the page isn't overwhelmed.
  const top = anomalies.slice(0, 6);

  return (
    <article className="anomalies">
      <header className="anomalies__head">
        <span className="anomalies__icon" aria-hidden="true">
          <LuTriangleAlert size={18} />
        </span>
        <div>
          <h3 className="anomalies__title">{title}</h3>
          <p className="anomalies__sub">
            Months where a metric deviated more than 1.5σ from the year's average.
          </p>
        </div>
      </header>
      <ul className="anomalies__list">
        {top.map((a, idx) => {
          const tone = a.direction === 'spike' ? 'spike' : 'dip';
          const Icon = a.direction === 'spike' ? LuTrendingUp : LuTrendingDown;
          const baselineValue = stats[a.metric]?.mean;
          return (
            <li key={`${a.month}-${a.metric}-${idx}`} className={`anomalies__item anomalies__item--${tone}`}>
              <div className="anomalies__item-icon" aria-hidden="true">
                <Icon size={16} />
              </div>
              <div className="anomalies__item-body">
                <p className="anomalies__item-title">
                  <strong>{a.month}</strong> · {metricLabel(a.metric)} {a.direction}
                </p>
                <p className="anomalies__item-meta">
                  {formatMetric(a.metric, a.value)} vs.{' '}
                  baseline {formatMetric(a.metric, baselineValue)}{' '}
                  · z-score {a.z_score > 0 ? '+' : ''}{a.z_score}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
