// Content Mix performance — page DNA pivot
//
// Pages have a `content_role` (Homepage, Editorial, Service, Conversion
// Page, etc.). Pivoting performance per role answers questions GA4 leaves
// to humans: "is the blog actually pulling its weight?", "are service pages
// converting attention into engagement?".
//
// Each row shows count, session share, average bounce, and average
// engagement time. The colored dot beside the role name is a quick visual
// health cue (green/amber/red) derived from the underlying quality score.
//
// Rows are clickable. Expanding a row reveals a per-DNA playbook answering
// the three questions the client asked us to make explicit:
//   1. What does this row mean?
//   2. Why is it useful?
//   3. What should I do next?
// Some roles also deep-link to the most relevant tab on the dashboard.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LuArrowRight, LuChevronDown, LuFile } from 'react-icons/lu';

import { bounceClass, formatInteger, formatPercent } from '../../lib/formatters.js';
import {
  OPPORTUNITY_MIN_BOUNCE,
  OPPORTUNITY_MIN_SESSIONS,
  UNICORN_MAX_BOUNCE,
  UNICORN_MIN_SESSIONS,
} from '../../lib/skillConfig.js';
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

// Per-DNA explainer shown when a row is expanded.
// `meaning`  — what the bucket actually is
// `why`      — why this row is useful to look at
// `actions`  — concrete next steps the user can take
// `whereTo`  — optional deep-link to a more specialized tab
const ROLE_PLAYBOOKS = {
  homepage: {
    meaning:
      'Your main entry point — the page most visitors meet your brand on first.',
    why:
      "Bounce here sets the baseline mood for every other page. If the homepage owns a big slice of sessions but bounce is high, you're paying for traffic that never sees a second page.",
    actions: [
      'Read the first 5 seconds: does the headline answer "what you do, who it\'s for, why now"?',
      'Confirm there is a primary CTA above the fold pointing to a service or contact page.',
      "Compare this row's share of sessions to the Conversion Page row — a wide gap means internal links aren't feeding visitors forward.",
    ],
  },
  'conversion page': {
    meaning:
      'Pages where the visitor is expected to act — typically /contact, demo or quote requests.',
    why:
      'Bounce here means "they arrived ready to convert and changed their mind." Engagement time tells you whether they read the form or bailed instantly.',
    actions: [
      "Cross-check this row's sessions against actual form submissions on the Contact Form Intel tab — the gap is friction you can fix.",
      'If bounce is above 35%, audit the form: too many fields, missing trust signals, or a vague headline are the usual suspects.',
      'If avg engagement is under 15s, the form likely loads below the fold or the page is slow.',
    ],
    whereTo: { route: '/contact', label: 'Contact Form Intel' },
  },
  service: {
    meaning:
      'Pages that describe what you sell — the rooms in your storefront.',
    why:
      'Sessions show where demand is concentrated; bounce shows which descriptions answer the question and which create more questions.',
    actions: [
      'Sort the Top Pages table below by sessions, then look for service pages with bounce above 50% — those are silent losses.',
      'On any high-bounce service page, add a one-line "who this is for" under the headline plus a clear CTA.',
      'If a service has long engagement but low sessions, surface it from the homepage and editorial pages.',
    ],
  },
  unicorn: {
    meaning: `Pages with at least ${UNICORN_MIN_SESSIONS} sessions and bounce at or below ${Math.round(
      UNICORN_MAX_BOUNCE * 100,
    )}% — your quietly heavy lifters.`,
    why:
      'Whatever these pages are doing — headline, length, CTA, layout — is what your audience actually responds to. They are templates worth cloning.',
    actions: [
      'Open the Unicorn Pages tab and read the top three end-to-end.',
      'Note the pattern (intro hook, case-study format, FAQ block) and apply it to your weakest service or editorial page next quarter.',
      'Add internal links from your homepage and high-traffic posts to these pages — they convert better than average.',
    ],
    whereTo: { route: '/unicorns', label: 'Unicorn Pages' },
  },
  editorial: {
    meaning:
      'Blog posts, articles, case studies — top-of-funnel content built to attract and warm up cold visitors.',
    why:
      "Editorial is expected to bounce more than a service page, but engagement time should be longer. High bounce AND short engagement means the post isn't earning the read.",
    actions: [
      'On posts with bounce above 70%, rewrite the intro paragraph — most are too long or too generic.',
      'Add a "related service" callout on every editorial page above the comments or footer.',
      'Promote your top-engagement editorial pages by linking to them from the homepage.',
    ],
    whereTo: { route: '/unicorns', label: 'Refresh Candidates' },
  },
  'high-bounce opportunity': {
    meaning: `Pages with at least ${OPPORTUNITY_MIN_SESSIONS} sessions but bounce of ${Math.round(
      OPPORTUNITY_MIN_BOUNCE * 100,
    )}% or higher — traffic arrives, attention leaks.`,
    why:
      'This is the highest-leverage row on the dashboard. You already paid for the traffic; the page itself is the bottleneck.',
    actions: [
      'Open the Refresh Candidates list on the Unicorn Pages tab and rewrite the top 3 first.',
      'Audit search-intent match: does the page answer the question that brought visitors there?',
      'Add a clear next step — CTA, related read, or contact link — within the first 1.5 screens.',
    ],
    whereTo: { route: '/unicorns', label: 'Refresh Candidates' },
  },
  supporting: {
    meaning:
      'Everything else — about, careers, legal, utility pages, and long-tail content.',
    why:
      'Individually small; collectively often the largest share of sessions. Worth a glance to spot anything that should really live in another bucket.',
    actions: [
      'If supporting pages own more than 25% of sessions, scan the Top Pages table for ones that look mis-classified — they may deserve to be Service or Editorial.',
      "Don't optimize each supporting page individually; optimize the navigation that surfaces them.",
    ],
  },
};

const FALLBACK_PLAYBOOK = {
  meaning: 'A custom page DNA classification produced by the analyzer.',
  why:
    "Compare this row's share, bounce, and engagement against the others to see whether it's a strength or a leak.",
  actions: [
    'If bounce is above 50% and the share is meaningful, treat it like a refresh candidate.',
    'If the share is small, focus on the rows above first.',
  ],
};

function lookupPlaybook(role) {
  const key = String(role || '').toLowerCase();
  return ROLE_PLAYBOOKS[key] || FALLBACK_PLAYBOOK;
}

// Single contextual sentence at the top of the expanded panel that mirrors
// the *actual* numbers shown in the row, so the panel doesn't feel canned.
function summarizeRow(row) {
  const share = formatPercent(row.session_share || 0, 0);
  const bounce = formatPercent(row.bounce_rate || 0, 0);
  const eng = (row.avg_engagement_time || 0).toFixed(1);
  const pages = formatInteger(row.page_count || 0);
  const sessions = formatInteger(row.sessions || 0);
  const pageWord = row.page_count === 1 ? 'page' : 'pages';
  return `In this period: ${pages} ${pageWord} drove ${sessions} sessions (${share} of total) with ${bounce} bounce and ${eng}s average engagement.`;
}

export function ContentMix({ rows = [], title = 'Content mix performance', subtitle }) {
  const [expanded, setExpanded] = useState(() => new Set());

  if (!Array.isArray(rows) || rows.length === 0) return null;

  function toggle(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="cmx" aria-label={title}>
      <header className="cmx__head">
        <span className="cmx__icon" aria-hidden="true"><LuFile size={18} /></span>
        <div>
          <h3 className="cmx__title">{title}</h3>
          {subtitle && <p className="cmx__sub">{subtitle}</p>}
          <p className="cmx__hint">
            Click any row to see what it means, why it matters, and what to do next.
          </p>
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
              <th aria-label="Expand details" />
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) => {
              const grade = eqsGrade(r.engagement_quality_score);
              const key = r.role;
              const isOpen = expanded.has(key);
              const playbook = lookupPlaybook(r.role);
              const where = playbook.whereTo;
              const elements = [
                <tr
                  key={key}
                  className={`cmx__row cmx__row--clickable${isOpen ? ' is-open' : ''}`}
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                >
                  <td className="cmx__role">
                    <span className="cmx__role-inner">
                      <span
                        className={`cmx__role-dot cmx__role-dot--${grade.tone}`}
                        aria-hidden="true"
                      />
                      {r.role}
                    </span>
                  </td>
                  <td className="num">{formatInteger(r.page_count)}</td>
                  <td className="num">{formatInteger(r.sessions)}</td>
                  <td><ShareBar pct={r.session_share} /></td>
                  <td className="num">
                    <span className={bounceClass(r.bounce_rate)}>{formatPercent(r.bounce_rate, 0)}</span>
                  </td>
                  <td className="num">{(r.avg_engagement_time || 0).toFixed(1)}s</td>
                  <td className="cmx__chev-cell">
                    <button
                      type="button"
                      className={`cmx__chev${isOpen ? ' is-open' : ''}`}
                      aria-label={isOpen ? `Hide details for ${r.role}` : `Show details for ${r.role}`}
                      aria-expanded={isOpen}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(key);
                      }}
                    >
                      <LuChevronDown size={16} />
                    </button>
                  </td>
                </tr>,
              ];
              if (isOpen) {
                elements.push(
                  <tr key={`${key}-detail`} className="cmx__detail-row">
                    <td colSpan={7}>
                      <div className="cmx__playbook">
                        <p className="cmx__playbook-summary">{summarizeRow(r)}</p>
                        <div className="cmx__playbook-grid">
                          <div className="cmx__playbook-block">
                            <h4 className="cmx__playbook-heading">What this means</h4>
                            <p className="cmx__playbook-text">{playbook.meaning}</p>
                          </div>
                          <div className="cmx__playbook-block">
                            <h4 className="cmx__playbook-heading">Why it&rsquo;s useful</h4>
                            <p className="cmx__playbook-text">{playbook.why}</p>
                          </div>
                          <div className="cmx__playbook-block">
                            <h4 className="cmx__playbook-heading">What to do next</h4>
                            <ol className="cmx__playbook-steps">
                              {playbook.actions.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        </div>
                        {where?.route && where?.label && (
                          <Link className="cmx__playbook-link" to={where.route}>
                            Open {where.label}
                            <LuArrowRight size={14} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>,
                );
              }
              return elements;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
