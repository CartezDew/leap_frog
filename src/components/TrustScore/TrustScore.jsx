// Data Trust Grade — a banner that puts a single A–F letter on the
// dashboard's overall reliability. GA4 will happily show pretty graphs over
// junk data; this surfaces the "should I trust this?" question up front
// alongside the top contributing penalties (bots, fractional IDs, verifier
// errors, etc.).
//
// Renders nothing if `trust` is missing.

import { LuShieldCheck, LuShieldAlert, LuShieldX } from 'react-icons/lu';
import { formatPercent } from '../../lib/formatters.js';

function Icon({ tone }) {
  const size = 22;
  if (tone === 'green') return <LuShieldCheck size={size} />;
  if (tone === 'red') return <LuShieldX size={size} />;
  return <LuShieldAlert size={size} />;
}

export function TrustScore({ trust }) {
  if (!trust) return null;
  const { score, grade, tone, label, factors = [] } = trust;

  return (
    <section
      className={`trust-score trust-score--${tone}`}
      aria-label="Data Trust Grade"
    >
      <div className="trust-score__grade-block">
        <div className="trust-score__icon" aria-hidden="true">
          <Icon tone={tone} />
        </div>
        <div className="trust-score__grade-text">
          <p className="trust-score__eyebrow">Data Trust Grade</p>
          <p className="trust-score__grade">{grade}</p>
        </div>
        <div className="trust-score__score-text">
          <p className="trust-score__score">{score}<span>/100</span></p>
          <p className="trust-score__label">{label}</p>
        </div>
      </div>

      <div className="trust-score__detail">
        <div className="trust-score__bars">
          <Bar
            label="Bot session share"
            value={trust.bot_share || 0}
            invert
          />
          <Bar
            label="Suspicious sources"
            value={trust.suspicious_share || 0}
            invert
          />
          <Bar
            label="Fractional IDs"
            value={trust.fractional_share || 0}
            invert
          />
        </div>
        {factors.length > 0 && (
          <div className="trust-score__factors">
            <p className="trust-score__factors-head">Top trust drag</p>
            <ul>
              {factors.map((f) => (
                <li key={f.key}>
                  <span className="trust-score__factor-label">{f.label}</span>
                  <span className="trust-score__factor-penalty">
                    −{f.penalty}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Bar({ label, value, invert }) {
  const pct = Math.min(1, Math.max(0, value));
  let tone = 'good';
  if (invert) {
    if (pct >= 0.25) tone = 'bad';
    else if (pct >= 0.1) tone = 'warn';
  } else {
    if (pct < 0.5) tone = 'bad';
    else if (pct < 0.75) tone = 'warn';
  }
  return (
    <div className={`trust-bar trust-bar--${tone}`}>
      <div className="trust-bar__head">
        <span className="trust-bar__label">{label}</span>
        <span className="trust-bar__value">{formatPercent(value, 1)}</span>
      </div>
      <progress
        className={`trust-bar__track trust-bar__track--${tone}`}
        value={pct}
        max={1}
        aria-label={`${label} ${formatPercent(value, 1)}`}
      />
    </div>
  );
}
