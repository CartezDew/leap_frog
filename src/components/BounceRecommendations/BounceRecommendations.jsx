// Bounce-rate recommendations panel.
//
// Every entry is generated from the actual analyzed payload — channel names,
// page paths, session totals, bounce rates, month names. There is no generic
// copy; if a particular pattern doesn't appear in the data, the panel hides
// that recommendation entirely.

import {
  LuTriangleAlert,
  LuOctagonAlert,
  LuLightbulb,
  LuSparkles,
} from 'react-icons/lu';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

const SEVERITY_TONE = {
  critical: 'red',
  high: 'amber',
  medium: 'amber',
  opportunity: 'green',
  low: 'info',
};

function severityIcon(sev) {
  if (sev === 'critical') return LuOctagonAlert;
  if (sev === 'high' || sev === 'medium') return LuTriangleAlert;
  if (sev === 'opportunity') return LuSparkles;
  return LuLightbulb;
}

function severityLabel(sev) {
  if (sev === 'critical') return 'Critical fix';
  if (sev === 'high') return 'High-impact fix';
  if (sev === 'medium') return 'Investigate';
  if (sev === 'opportunity') return 'Opportunity';
  return 'Note';
}

function OffendersList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="bounce-rec__offenders">
      {items.map((o) => (
        <li key={o.name}>
          <span className="bounce-rec__offender-name">{o.name}</span>
          <span className="bounce-rec__offender-meta">
            {formatInteger(o.sessions)} sessions ·{' '}
            <span className={o.bounce_rate >= 0.55 ? 'br-bad' : 'br-warn'}>
              {formatPercent(o.bounce_rate, 1)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BounceRecommendations({ recommendations = [] }) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <section className="bounce-rec bounce-rec--empty" aria-label="Bounce-rate recommendations">
        <header className="bounce-rec__head">
          <p className="bounce-rec__eyebrow">Bounce-rate playbook</p>
          <h3 className="bounce-rec__title">
            No high-priority bounce issues <em>detected</em>
          </h3>
          <p className="bounce-rec__sub">
            Every channel is at or below the industry "Good" band, no
            high-traffic page is leaking visitors, and bot share is under
            threshold. Keep monitoring monthly trends.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="bounce-rec" aria-label="Bounce-rate recommendations">
      <header className="bounce-rec__head">
        <p className="bounce-rec__eyebrow">Bounce-rate playbook</p>
        <h3 className="bounce-rec__title">
          What <em>this dataset</em> says to fix next
        </h3>
        <p className="bounce-rec__sub">
          Each card is grounded in your uploaded data — channel names, page
          paths, and month-over-month deltas come straight from the workbook.
        </p>
      </header>

      <ol className="bounce-rec__list">
        {recommendations.map((rec, idx) => {
          const Icon = severityIcon(rec.severity);
          const tone = SEVERITY_TONE[rec.severity] || 'info';
          return (
            <li
              key={rec.id || idx}
              className={`bounce-rec__item bounce-rec__item--${tone}`}
            >
              <div className="bounce-rec__rank" aria-hidden="true">
                {idx + 1}
              </div>
              <div className="bounce-rec__body">
                <header className="bounce-rec__row">
                  <span
                    className={`bounce-rec__sev bounce-rec__sev--${tone}`}
                    title={severityLabel(rec.severity)}
                  >
                    <Icon size={16} />
                    <span>{severityLabel(rec.severity)}</span>
                  </span>
                  <h4 className="bounce-rec__heading">{rec.title}</h4>
                </header>
                <p className="bounce-rec__copy">{rec.body}</p>
                {rec.evidence && (
                  <p className="bounce-rec__evidence">
                    <span className="bounce-rec__evidence-label">Evidence</span>{' '}
                    {rec.evidence}
                  </p>
                )}
                <OffendersList items={rec.other_offenders} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
