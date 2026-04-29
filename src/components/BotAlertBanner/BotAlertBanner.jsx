// Confirmed-bot alert banner.
//
// A compact, alert-style callout. Default state is a single line:
//
//   [pulse] ⚠ 3 confirmed bots detected — take action.   [View details ▾]
//
// The headline number is the count of *distinct dimensions* (sources +
// cities) that crossed the confirmed-bot threshold — e.g. one row per
// `search.webnavigator.com`, not the session totals those bots generated.
// Session counts / share-of-traffic are surfaced inside the expanded panel.
//
// Two visual modes:
//   variant="default" — red-accented alert (use on the Bot Traffic page).
//   variant="subtle"  — muted amber/neutral version that does not dominate
//                       the Overview header (still animated, just quieter).
//
// Renders nothing when there are no confirmed bots in the upload.

import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuArrowRight,
  LuChevronDown,
  LuShieldAlert,
} from 'react-icons/lu';

import { formatInteger, formatPercent } from '../../lib/formatters.js';

const MAX_PREVIEW_ROWS = 8;

function confirmedBotRows(rows = [], labelKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r?.bot_classification === 'confirmed_bot')
    .map((r) => ({
      label: String(r?.[labelKey] ?? '').trim() || '—',
      sessions: Number(r?.sessions) || 0,
      score: Number(r?.bot_score) || 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

function BotList({ title, rows, emptyLabel }) {
  if (!rows.length) {
    return (
      <div className="bot-alert__list">
        <h4 className="bot-alert__list-title">{title}</h4>
        <p className="bot-alert__list-empty">{emptyLabel}</p>
      </div>
    );
  }
  const visible = rows.slice(0, MAX_PREVIEW_ROWS);
  const remainder = rows.length - visible.length;
  return (
    <div className="bot-alert__list">
      <h4 className="bot-alert__list-title">
        {title}
        <span className="bot-alert__list-count">{rows.length}</span>
      </h4>
      <ol className="bot-alert__rows">
        {visible.map((row) => (
          <li key={`${row.label}-${row.sessions}`} className="bot-alert__row">
            <span className="bot-alert__row-label" title={row.label}>
              {row.label}
            </span>
            <span className="bot-alert__row-meta">
              <span className="bot-alert__row-sessions">
                {formatInteger(row.sessions)} sessions
              </span>
              <span
                className="bot-alert__row-score"
                aria-label={`Bot score ${row.score}`}
              >
                score {row.score}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {remainder > 0 && (
        <p className="bot-alert__list-more">
          +{remainder} more — full list on the Bot Traffic page.
        </p>
      )}
    </div>
  );
}

export function BotAlertBanner({
  bots,
  totalSessions = 0,
  variant = 'default',
  showLink = true,
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const detailId = useId();

  const summary = bots?.summary || {};
  const confirmedSessions = Number(summary.confirmed_bot_sessions) || 0;

  const sources = useMemo(
    () => confirmedBotRows(bots?.sources, 'source'),
    [bots?.sources],
  );
  const cities = useMemo(
    () => confirmedBotRows(bots?.cities, 'city'),
    [bots?.cities],
  );

  if (
    confirmedSessions <= 0 &&
    sources.length === 0 &&
    cities.length === 0
  ) {
    return null;
  }

  // Headline = how many distinct sources + cities crossed the confirmed-bot
  // threshold. e.g. `search.webnavigator.com` = 1 confirmed bot.
  const confirmedBotCount = sources.length + cities.length;
  const sharePct = totalSessions > 0 ? confirmedSessions / totalSessions : 0;

  return (
    <section
      className={`bot-alert bot-alert--${variant}${open ? ' is-open' : ''}`}
      role="alert"
      aria-labelledby={titleId}
    >
      <div className="bot-alert__bar">
        <span className="bot-alert__pulse" aria-hidden="true">
          <span className="bot-alert__pulse-dot" />
          <span className="bot-alert__pulse-ring" />
        </span>

        <span className="bot-alert__icon" aria-hidden="true">
          <LuShieldAlert size={16} />
        </span>

        <p id={titleId} className="bot-alert__message">
          <strong className="bot-alert__count">{formatInteger(confirmedBotCount)}</strong>{' '}
          confirmed bot{confirmedBotCount === 1 ? '' : 's'} detected
          <span className="bot-alert__cta-text"> — take action to remove</span>
        </p>

        <button
          type="button"
          className={`bot-alert__toggle${open ? ' is-open' : ''}`}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{open ? 'Hide details' : 'View details'}</span>
          <LuChevronDown size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div id={detailId} className="bot-alert__detail">
          <p className="bot-alert__lede">
            These <strong>{formatInteger(confirmedBotCount)}</strong>{' '}
            source{confirmedBotCount === 1 ? '' : 's'}/cit
            {confirmedBotCount === 1 ? 'y' : 'ies'} match the dashboard’s
            confirmed-bot rules
            {confirmedSessions > 0 && (
              <>
                {' '}and account for{' '}
                <strong>{formatInteger(confirmedSessions)}</strong> session
                {confirmedSessions === 1 ? '' : 's'}
                {totalSessions > 0 && (
                  <>
                    {' '}(<strong>{formatPercent(sharePct, 1)}</strong> of all
                    traffic)
                  </>
                )}
              </>
            )}
            . Filter them out of the dataset before sharing reports so your KPIs
            reflect real visitors only.
          </p>

          <div className="bot-alert__lists">
            <BotList
              title="Confirmed-bot sources"
              rows={sources}
              emptyLabel="No source crossed the confirmed-bot threshold."
            />
            <BotList
              title="Confirmed-bot cities"
              rows={cities}
              emptyLabel="No city crossed the confirmed-bot threshold."
            />
          </div>

          <div className="bot-alert__footer">
            <p className="bot-alert__hint">
              Recommended next step: exclude these dimensions in GA4 (or your
              warehouse view), re-export, and re-upload so the dashboard reports
              a clean baseline.
            </p>
            {showLink && (
              <Link to="/bots" className="bot-alert__link">
                Open Bot Traffic page{' '}
                <LuArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
