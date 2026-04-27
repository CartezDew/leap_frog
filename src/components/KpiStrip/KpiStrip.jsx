// Executive Summary KPI strip — eight tiles arranged under a green header
// bar, matching the printed-report look of the manual GA4 callout cards.
//
// Each tile renders:
//   - A small uppercase label (color-coded to the tile)
//   - A large display number (color-coded)
//   - A short caption explaining what it measures
//   - An optional secondary line (a percentage or a "good rate" qualifier)
//
// Tones map to the metric's nature, not arbitrary slots:
//   green  → headline volume (sessions, users, contacts)
//   amber  → site-wide bounce
//   green-bounce → organic bounce (best-quality channel)
//   red    → direct bounce (poor-engagement channel)

import { LuTrendingUp } from 'react-icons/lu';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

function bounceQualifier(rate) {
  if (rate < 0.4) return { label: 'great rate', tone: 'good' };
  if (rate < 0.5) return { label: 'good rate', tone: 'good' };
  if (rate < 0.6) return { label: 'watch closely', tone: 'amber' };
  return { label: 'needs work', tone: 'bad' };
}

function Tile({ tone = 'green', label, value, caption, footer }) {
  return (
    <div className={`kstrip__tile kstrip__tile--${tone}`}>
      <p className="kstrip__label">{label}</p>
      <p className="kstrip__value">{value}</p>
      <p className="kstrip__caption">{caption}</p>
      {footer && <p className="kstrip__footer">{footer}</p>}
    </div>
  );
}

export function KpiStrip({ summary, year }) {
  if (!summary) return null;

  const sessions = summary.total_sessions || 0;
  const totalUsers = summary.total_users || 0;
  const newUsers = summary.new_users || 0;
  const engaged = summary.engaged_sessions || 0;
  const siteBounce = summary.site_bounce_rate || 0;
  const organicBounce = summary.organic_bounce_rate || 0;
  const directBounce = summary.direct_bounce_rate || 0;
  const contactSessions = summary.contact_page_sessions || 0;

  const newUserPct = totalUsers ? newUsers / totalUsers : 0;
  const engagementRate = sessions ? engaged / sessions : 0;
  const contactShare = sessions ? contactSessions / sessions : 0;

  const siteBounceQ = bounceQualifier(siteBounce);
  const yearLabel = year ? `Full Year ${year}` : 'Full Period';

  return (
    <section className="kstrip" aria-label="Key performance metrics">
      <header className="kstrip__head">
        <span className="kstrip__head-icon" aria-hidden="true">
          <LuTrendingUp size={18} />
        </span>
        <span className="kstrip__head-title">Key Performance Metrics</span>
        <span className="kstrip__head-divider" aria-hidden="true">
          —
        </span>
        <span className="kstrip__head-period">{yearLabel}</span>
      </header>

      <div className="kstrip__grid">
        <Tile
          tone="green"
          label="Total Sessions"
          value={formatInteger(sessions)}
          caption="Sum of all medium sessions"
        />
        <Tile
          tone="green"
          label="Total Users"
          value={formatInteger(totalUsers)}
          caption="Unique visitors (all channels)"
        />
        <Tile
          tone="green"
          label="New Users"
          value={formatInteger(newUsers)}
          caption="First-time visitors this year"
          footer={
            totalUsers > 0 ? (
              <span className="kstrip__meta kstrip__meta--good">
                {formatPercent(newUserPct, 0)} of users
              </span>
            ) : null
          }
        />
        <Tile
          tone="green"
          label="Engaged Sessions"
          value={formatInteger(engaged)}
          caption="Sessions with meaningful activity"
          footer={
            sessions > 0 ? (
              <span className="kstrip__meta kstrip__meta--good">
                {formatPercent(engagementRate, 0)} of sessions
              </span>
            ) : null
          }
        />
        <Tile
          tone="amber"
          label="Site Avg Bounce"
          value={formatPercent(siteBounce, 1)}
          caption="All-medium weighted average"
          footer={
            <span className={`kstrip__meta kstrip__meta--${siteBounceQ.tone}`}>
              <em>{siteBounceQ.label}</em>
            </span>
          }
        />
        <Tile
          tone="good-bounce"
          label="Organic Bounce"
          value={
            summary.organic_sessions > 0 ? formatPercent(organicBounce, 1) : '—'
          }
          caption="Google + Bing — best quality channel"
        />
        <Tile
          tone="bad-bounce"
          label="Direct Bounce"
          value={
            summary.direct_sessions > 0 ? formatPercent(directBounce, 1) : '—'
          }
          caption="Direct traffic — poor engagement"
        />
        <Tile
          tone="green"
          label="Contact Sessions"
          value={formatInteger(contactSessions)}
          caption="/contact/ page entries"
          footer={
            sessions > 0 ? (
              <span className="kstrip__meta kstrip__meta--good">
                {formatPercent(contactShare, 0)} of sessions
              </span>
            ) : null
          }
        />
      </div>
    </section>
  );
}
