import { useState } from 'react';
import {
  LuBot,
  LuChevronDown,
  LuFingerprint,
  LuMapPin,
  LuRadioTower,
  LuShieldAlert,
  LuSigma,
  LuSparkles,
  LuUsers,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { BotBadge } from '../components/StatusBadge/StatusBadge.jsx';
import { BotAlertBanner } from '../components/BotAlertBanner/BotAlertBanner.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';
import { computeBotImpact } from '../lib/levers.js';

// Cleanest → dirtiest, used to give the Classification badge column a
// meaningful sort order instead of plain alphabetical.
const BOT_RANK = {
  human: 0,
  suspicious: 1,
  likely_bot: 2,
  confirmed_bot: 3,
};

// Visual order + tone for the score → classification ladder shown in the
// methodology section. Mirrors the strings produced by the analyzer's
// `methodology.thresholds` map but in dirtiest → cleanest reading order so the
// urgency reads top-to-bottom.
const THRESHOLD_LADDER = [
  { key: 'confirmed_bot', label: 'Confirmed bot', tone: 'red' },
  { key: 'likely_bot', label: 'Likely bot', tone: 'amber' },
  { key: 'suspicious', label: 'Suspicious', tone: 'amber' },
  { key: 'human', label: 'Human', tone: 'green' },
];

/** Parse a methodology rule string of the shape "<criteria> = +N" into its
 *  parts so we can render the points as a pill instead of inline text. */
function parseRule(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/\s=\s\+(\d+)\s*$/);
  if (!m) return { criteria: text, points: null };
  return {
    criteria: text.slice(0, m.index).trim(),
    points: Number(m[1]),
  };
}

function RuleList({ rules }) {
  if (!rules?.length) {
    return <p className="bot-method-empty">No rules configured for this dimension.</p>;
  }
  return (
    <ol className="bot-method-rules">
      {rules.map((raw, i) => {
        const { criteria, points } = parseRule(raw);
        return (
          <li key={i} className="bot-method-rule">
            <span className="bot-method-rule__criteria">{criteria}</span>
            {points != null && (
              <span className="bot-method-rule__points">+{points} pts</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MethodologyDisclosure({
  icon,
  title,
  summary,
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className={`bot-method-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="bot-method-card__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="bot-method-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="bot-method-card__copy">
          <span className="bot-method-card__title">{title}</span>
          {summary && (
            <span className="bot-method-card__summary">{summary}</span>
          )}
        </span>
        <LuChevronDown
          size={18}
          className="bot-method-card__chev"
          aria-hidden="true"
        />
      </button>
      {open && <div className="bot-method-card__body">{children}</div>}
    </article>
  );
}

const cityColumns = [
  { key: 'city', header: 'City', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  {
    key: 'avg_engagement_time',
    header: 'Avg Eng',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'bounce_rate',
    header: 'Bounce',
    align: 'right',
    render: (row) => (
      <span className={bounceClass(row.bounce_rate)}>
        {formatPercent(row.bounce_rate)}
      </span>
    ),
    exportValue: (row) => formatPercent(row.bounce_rate),
  },
  {
    key: 'return_rate',
    header: 'Return',
    align: 'right',
    format: (v) => formatPercent(v),
  },
  {
    key: 'bot_score',
    header: 'Score',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'classification',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
    sortValue: (row) => BOT_RANK[row.bot_classification] ?? -1,
    exportValue: (row) => row.bot_classification ?? '',
  },
];

const sourceColumns = [
  { key: 'source', header: 'Source', className: 'col-strong' },
  { key: 'sessions', header: 'Sessions', align: 'right', format: (v) => formatInteger(v) },
  {
    key: 'avg_engagement_time',
    header: 'Avg Eng',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'bounce_rate',
    header: 'Bounce',
    align: 'right',
    render: (row) => (
      <span className={bounceClass(row.bounce_rate)}>
        {formatPercent(row.bounce_rate)}
      </span>
    ),
    exportValue: (row) => formatPercent(row.bounce_rate),
  },
  {
    key: 'bot_score',
    header: 'Score',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'classification',
    header: 'Classification',
    render: (row) => <BotBadge classification={row.bot_classification} />,
    sortValue: (row) => BOT_RANK[row.bot_classification] ?? -1,
    exportValue: (row) => row.bot_classification ?? '',
  },
];

export function BotTraffic() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;
  const bots = analyzed.bots || {};
  const sum = bots.summary || {};
  const methodology = bots.methodology || {};
  const impact = computeBotImpact(analyzed.summary, bots);
  const showImpact =
    impact.confirmed_bot_sessions > 0 || impact.bot_user_ids > 0;

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Bot Traffic Intelligence"
        subtitle="City- and source-level scoring of probable bot/datacentre traffic."
      />

      <BotAlertBanner
        bots={bots}
        totalSessions={analyzed.summary?.total_sessions || 0}
        showLink={false}
      />

      <BotKpiGroups summary={sum} aiAssistants={bots.ai_assistants || []} />

      {showImpact && (
        <article className="lever-card lever-card--info lever-card--inline">
          <header className="lever-card__head">
            <span className="lever-card__icon" aria-hidden="true">
              <LuBot size={18} />
            </span>
            <h3 className="lever-card__title">Bot impact on reported metrics</h3>
            <span className="lever-card__hint">use this number with leadership</span>
          </header>
          <p className="lever-card__metric">
            <strong>{formatPercent(impact.bot_share_of_classified, 1)}</strong>
            <span className="lever-card__metric-label">
              of classified sessions originate from bot infrastructure
            </span>
          </p>
          <p className="lever-card__body">
            Filtering these {formatInteger(impact.confirmed_bot_sessions)} sessions
            out of GA4 lifts the reported engagement rate from{' '}
            {formatPercent(impact.reported_engagement, 1)} to{' '}
            <strong>{formatPercent(impact.clean_engagement, 1)}</strong>
            {impact.engagement_lift > 0 && (
              <>
                {' '}— a <strong>+{formatPercent(impact.engagement_lift, 1)}</strong> swing
              </>
            )}
            . The session count above and the bot user-ID count below are{' '}
            <em>different measurements</em> of the same problem (sessions are
            counted from bot-classified cities &amp; sources, user IDs are counted
            from the User sheet) — they will rarely be the same number, and
            that's expected. Use the cleaner engagement rate when reporting to
            leadership.
          </p>
        </article>
      )}

      <h2 className="section-header">City-level bot <em>scoring</em></h2>
      <DataTable
        columns={cityColumns}
        rows={bots.cities || []}
        hint="Top 60 by sessions"
        defaultSort={{ key: 'sessions', dir: 'desc' }}
        exportFileStem="bot-traffic-cities"
      />

      <h2 className="section-header">Source-level bot <em>scoring</em></h2>
      <DataTable
        columns={sourceColumns}
        rows={bots.sources || []}
        defaultSort={{ key: 'sessions', dir: 'desc' }}
        exportFileStem="bot-traffic-sources"
      />

      <h2 className="section-header"><em>Methodology</em></h2>
      <MethodologyExplainer summary={sum} methodology={methodology} />
    </>
  );
}

/** Three KPI groups that explicitly separate the three measurement angles
 *  (sessions, user IDs, AI assistants) so clients stop expecting them to add
 *  up to the same number. */
function BotKpiGroups({ summary, aiAssistants }) {
  const totalIds =
    Number(summary?.total_user_ids) ||
    (Number(summary?.confirmed_bot_user_ids) || 0) +
      (Number(summary?.likely_bot_user_ids) || 0) +
      (Number(summary?.suspicious_user_ids) || 0) +
      (Number(summary?.human_user_ids) || 0) +
      (Number(summary?.fractional_user_ids) || 0);

  const aiCount = Number(summary?.ai_assistant_count) || aiAssistants.length;
  const aiSessions = Number(summary?.ai_assistant_sessions) || 0;

  return (
    <>
      <div className="bot-kpi-group">
        <h3 className="bot-kpi-group__title">
          <LuShieldAlert size={14} aria-hidden="true" />
          Sessions by bot classification
          <span className="bot-kpi-group__hint">
            combined city + source detection — answers <em>“how dirty is the
            traffic in my GA4 view?”</em>
          </span>
        </h3>
        <div className="card-grid card-grid--cols-4">
          <KpiCard
            label="Confirmed bot sessions"
            value={formatInteger(summary?.confirmed_bot_sessions)}
            accent="red"
            sub="score ≥ 7 — datacenter / spam"
          />
          <KpiCard
            label="Confirmed bot sources"
            value={formatInteger(summary?.confirmed_bot_source_count)}
            accent="red"
            sub="distinct referrers crossing the confirmed threshold"
          />
          <KpiCard
            label="Suspicious"
            value={formatInteger(summary?.suspicious_sessions)}
            accent="amber"
            sub="score 2 – 3 — borderline sessions"
          />
          <KpiCard
            label="Human sessions"
            value={formatInteger(summary?.human_sessions)}
            accent="green"
            sub="score 0 – 1 — clean traffic"
          />
        </div>
      </div>

      <div className="bot-kpi-group">
        <h3 className="bot-kpi-group__title">
          <LuFingerprint size={14} aria-hidden="true" />
          User IDs by bot classification
          <span className="bot-kpi-group__hint">
            from the User sheet ({formatInteger(totalIds)} cookie identities) —
            answers <em>“how many cookies act like bots?”</em>
          </span>
        </h3>
        <div className="card-grid card-grid--cols-4">
          <KpiCard
            label="Confirmed bot IDs"
            value={formatInteger(summary?.confirmed_bot_user_ids)}
            accent="red"
            sub="score ≥ 7 across 6 signals"
          />
          <KpiCard
            label="Likely bot IDs"
            value={formatInteger(summary?.likely_bot_user_ids)}
            accent="amber"
            sub="score 4 – 6"
          />
          <KpiCard
            label="Suspicious IDs"
            value={formatInteger(summary?.suspicious_user_ids)}
            accent="amber"
            sub="score 2 – 3"
          />
          <KpiCard
            label="Fractional IDs"
            value={formatInteger(summary?.fractional_user_ids)}
            sub="GA4 cross-device / Google Signals — not bots, not unique humans either"
          />
        </div>
      </div>

      <div className="bot-kpi-group bot-kpi-group--ai">
        <h3 className="bot-kpi-group__title">
          <LuSparkles size={14} aria-hidden="true" />
          AI assistant traffic
          <span className="bot-kpi-group__hint">
            ChatGPT, Claude, Gemini, Perplexity, etc. — <em>not</em> bots, but
            don’t score them as humans either
          </span>
        </h3>
        <AiAssistantPanel
          sessionsTotal={aiSessions}
          assistantCount={aiCount}
          assistants={aiAssistants}
        />
      </div>
    </>
  );
}

function AiAssistantPanel({ sessionsTotal, assistantCount, assistants }) {
  if (!assistantCount && !sessionsTotal) {
    return (
      <div className="ai-traffic-panel ai-traffic-panel--empty">
        <p className="ai-traffic-panel__empty-msg">
          No referrer in this dataset matched a known AI assistant
          (ChatGPT, Claude, Gemini, Perplexity, Copilot, etc.). The dashboard
          will surface them automatically as soon as one shows up.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-traffic-panel">
      <div className="card-grid card-grid--cols-2">
        <KpiCard
          label="AI assistant sessions"
          value={formatInteger(sessionsTotal)}
          sub="excluded from bot session counts so they don’t skew the math"
        />
        <KpiCard
          label="Detected AI tools"
          value={formatInteger(assistantCount)}
          sub="distinct assistants sending traffic"
        />
      </div>
      {assistants.length > 0 && (
        <ol className="ai-traffic-list">
          {assistants.slice(0, 8).map((a) => (
            <li key={a.assistant} className="ai-traffic-list__row">
              <span className="ai-traffic-list__name">{a.assistant}</span>
              <span className="ai-traffic-list__meta">
                <span className="ai-traffic-list__sessions">
                  {formatInteger(a.sessions)} sessions
                </span>
                <span className="ai-traffic-list__bounce">
                  bounce {formatPercent(a.bounce_rate, 0)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MethodologyExplainer({ summary, methodology }) {
  const totalIds = Number(summary?.total_user_ids) || 0;
  const flaggedIds = Number(summary?.bot_user_ids) || 0;
  const fractionalIds = Number(summary?.fractional_user_ids) || 0;
  const humanIds = Number(summary?.human_user_ids) || 0;
  const flaggedShare = totalIds > 0 ? flaggedIds / totalIds : 0;
  const cleanIds = humanIds || Math.max(0, totalIds - flaggedIds - fractionalIds);

  const confirmedSessions = Number(summary?.confirmed_bot_sessions) || 0;
  const likelySessions = Number(summary?.likely_bot_sessions) || 0;
  const suspiciousSessions = Number(summary?.suspicious_sessions) || 0;
  const humanSessions = Number(summary?.human_sessions) || 0;
  const totalScoredSessions =
    confirmedSessions + likelySessions + suspiciousSessions + humanSessions;
  const confirmedShare =
    totalScoredSessions > 0 ? confirmedSessions / totalScoredSessions : 0;

  const datacenterCities = methodology?.datacenter_cities || [];
  const spamSources = methodology?.spam_sources || [];

  const aiSessions = Number(summary?.ai_assistant_sessions) || 0;
  const aiList = methodology?.ai_sources_detected || [];

  return (
    <section className="bot-method" aria-label="Bot intelligence methodology">
      <p className="bot-method__lede">
        The numbers up top come from <em>three different measurements</em> of
        the same dataset. They will rarely match — and that's expected. Read
        this once and the rest of the page makes sense in every report you
        hand to leadership.
      </p>

      <div className="bot-method__compare bot-method__compare--three">
        <article className="bot-method-callout bot-method-callout--sessions">
          <header className="bot-method-callout__head">
            <span className="bot-method-callout__icon" aria-hidden="true">
              <LuShieldAlert size={18} />
            </span>
            <span className="bot-method-callout__eyebrow">
              Angle 1 · Sessions
            </span>
          </header>
          <p className="bot-method-callout__metric">
            <strong>{formatInteger(confirmedSessions)}</strong>
            <span className="bot-method-callout__metric-of">
              confirmed bot sessions
            </span>
          </p>
          <p className="bot-method-callout__share">
            ≈ <strong>{formatPercent(confirmedShare, 1)}</strong> of classified
            sessions originated from confirmed bot cities &amp; sources.
          </p>
          <p className="bot-method-callout__body">
            Each <strong>city</strong> and each <strong>traffic source</strong>{' '}
            gets its own bot score. The headline KPI takes the higher of the
            two views per bucket so a binary city signal (datacenter vs. clean)
            doesn't hide a softer source-level gradient. Answers <em>“how dirty
            is the traffic in my GA4 view?”</em>
          </p>
        </article>

        <article className="bot-method-callout bot-method-callout--users">
          <header className="bot-method-callout__head">
            <span className="bot-method-callout__icon" aria-hidden="true">
              <LuFingerprint size={18} />
            </span>
            <span className="bot-method-callout__eyebrow">Angle 2 · User IDs</span>
          </header>
          <p className="bot-method-callout__metric">
            <strong>{formatInteger(flaggedIds)}</strong>
            <span className="bot-method-callout__metric-of">
              of {formatInteger(totalIds || flaggedIds)} user IDs
            </span>
          </p>
          <p className="bot-method-callout__share">
            ≈ <strong>{formatPercent(flaggedShare, 1)}</strong> of cookie
            identities on the site behave non-human.
          </p>
          <p className="bot-method-callout__body">
            Counted from the <strong>User sheet</strong> only — most bot
            sessions arrive anonymously and never get a user_id, so this number
            is almost always <em>much smaller</em> than the session count and
            the two should not be expected to match. Answers <em>“how many
            cookies act like bots?”</em>
          </p>
        </article>

        <article className="bot-method-callout bot-method-callout--ai">
          <header className="bot-method-callout__head">
            <span className="bot-method-callout__icon" aria-hidden="true">
              <LuSparkles size={18} />
            </span>
            <span className="bot-method-callout__eyebrow">
              Angle 3 · AI assistants
            </span>
          </header>
          <p className="bot-method-callout__metric">
            <strong>{formatInteger(aiSessions)}</strong>
            <span className="bot-method-callout__metric-of">
              AI-referred sessions
            </span>
          </p>
          <p className="bot-method-callout__share">
            {aiList.length > 0
              ? <>Detected: <strong>{aiList.join(', ')}</strong>.</>
              : <>No AI assistant referrers in this dataset yet.</>}
          </p>
          <p className="bot-method-callout__body">
            ChatGPT, Claude, Gemini, Perplexity &amp; co. read the page and
            leave fast — that looks like a bot to a generic rule, but it's a
            real, valuable visit. The dashboard <strong>excludes them from the
            bot session counts</strong> so they don't skew the “dirty traffic”
            number. Answers <em>“how much real traffic is AI sending me?”</em>
          </p>
        </article>
      </div>

      <p className="bot-method__bridge">
        Three angles, one dataset. <strong>Filter all three</strong> before
        sharing KPIs with leadership: exclude confirmed-bot cities &amp;
        sources from your GA4 view, exclude bot-flagged user IDs from any
        cohort or audience analysis, and report AI-assistant traffic as its
        own channel rather than rolling it into Direct or Organic.
      </p>

      <div className="bot-method__cards">
        <MethodologyDisclosure
          icon={<LuMapPin size={18} />}
          title="How city traffic gets scored"
          summary="Behavioral signals + known datacenter list per city row"
          defaultOpen
        >
          <p className="bot-method-card__intro">
            Every city in the City sheet is graded against the rules below. Points
            stack — a single city can pick up multiple flags. The total is mapped
            to a classification using the threshold ladder further down.
          </p>
          <RuleList rules={methodology?.city_rules} />
        </MethodologyDisclosure>

        <MethodologyDisclosure
          icon={<LuRadioTower size={18} />}
          title="How traffic sources get scored"
          summary="Behavioral signals + known spam-referrer list per source row"
        >
          <p className="bot-method-card__intro">
            Same logic as cities, applied to the Source / Medium sheet. A
            referrer that bounces hard, never engages, and matches our known
            spam list will pile up points fast. <strong>AI assistants are
            removed from this scoring</strong> before it runs (see the AI
            assistants card below) so they don't get mis-classified as bots.
          </p>
          <RuleList rules={methodology?.source_rules} />
        </MethodologyDisclosure>

        <MethodologyDisclosure
          icon={<LuSparkles size={18} />}
          title="How AI assistants get separated from bots"
          summary={
            aiList.length > 0
              ? `${aiList.length} detected in this dataset · ${formatInteger(aiSessions)} sessions`
              : 'No AI referrers in this dataset yet — list shows what we look for'
          }
        >
          <p className="bot-method-card__intro">
            ChatGPT-style assistants visit a page, summarize it, and leave —
            which looks identical to a bot under the source-scoring rules
            (high bounce, low engagement time). Before scoring runs, any
            referrer matching the patterns below is pulled into its own
            “AI assistant” bucket so it doesn't pollute the bot count or the
            human count.
          </p>
          <ul className="bot-method-chips bot-method-chips--mono">
            {[
              'chatgpt.com / chat.openai',
              'perplexity.ai',
              'claude.ai / anthropic',
              'gemini.google / bard.google',
              'copilot.microsoft / bing.com/chat',
              'you.com',
              'phind.com',
              'kagi.com',
              'poe.com',
              'huggingface.co/chat',
              'duck.ai',
              'meta.ai',
              'grok.x.ai',
            ].map((p) => (
              <li key={p} className="bot-method-chip">{p}</li>
            ))}
          </ul>
          {aiList.length > 0 && (
            <p className="bot-method-card__intro">
              <strong>Matched in this upload:</strong> {aiList.join(', ')}.
            </p>
          )}
        </MethodologyDisclosure>

        <MethodologyDisclosure
          icon={<LuUsers size={18} />}
          title="How user IDs get flagged"
          summary={`${formatInteger(flaggedIds)} flagged · ${formatInteger(fractionalIds)} fractional · ${formatInteger(cleanIds)} clean human`}
        >
          <p className="bot-method-card__intro">
            Run against the User sheet. A “bot-patterned” user ID is one whose
            entire session history looks automated — short visits, zero
            engagement, no return behavior. Fractional IDs (the <code>.2</code>,
            <code> .17</code>, <code> .18</code> cookies GA4 creates for
            cross-device merging) are flagged as <em>uncertain</em>, not bot —
            they distort counts but aren’t necessarily traffic.
          </p>
          <RuleList rules={methodology?.user_rules} />
        </MethodologyDisclosure>

        <MethodologyDisclosure
          icon={<LuSigma size={18} />}
          title="Score thresholds → classification labels"
          summary="What a score of 0, 3, 5, or 8 actually means on this page"
        >
          <p className="bot-method-card__intro">
            Once a row has its score, we bucket it into one of four classes. The
            badges in the tables above and the KPI cards at the top all use
            this ladder.
          </p>
          <ul className="bot-method-thresholds">
            {THRESHOLD_LADDER.map((tier) => {
              const range = methodology?.thresholds?.[tier.key];
              if (!range) return null;
              return (
                <li
                  key={tier.key}
                  className={`bot-method-threshold bot-method-threshold--${tier.tone}`}
                >
                  <span className="bot-method-threshold__range">{range}</span>
                  <span className="bot-method-threshold__label">{tier.label}</span>
                </li>
              );
            })}
          </ul>
        </MethodologyDisclosure>

        {datacenterCities.length > 0 && (
          <MethodologyDisclosure
            icon={<LuMapPin size={18} />}
            title="Datacenter cities we recognize"
            summary={`${datacenterCities.length} cities — automatic +3 to a city's score if matched`}
          >
            <p className="bot-method-card__intro">
              These are cities where Google, AWS, Microsoft, and Chinese cloud
              providers run major data centers. Sessions from these locations
              are far more likely to be automated traffic than local visitors.
            </p>
            <ul className="bot-method-chips">
              {datacenterCities.map((c) => (
                <li key={c} className="bot-method-chip">{c}</li>
              ))}
            </ul>
          </MethodologyDisclosure>
        )}

        {spamSources.length > 0 && (
          <MethodologyDisclosure
            icon={<LuShieldAlert size={18} />}
            title="Known spam sources we recognize"
            summary={`${spamSources.length} referrers — automatic +5 (instant confirmed-bot)`}
          >
            <p className="bot-method-card__intro">
              Referrers we’ve verified as spam, scraper, or hijack traffic in
              previous audits. Hitting this list alone clears the confirmed-bot
              threshold. Block these in GA4 filters before pulling fresh data.
            </p>
            <ul className="bot-method-chips bot-method-chips--mono">
              {spamSources.map((s) => (
                <li key={s} className="bot-method-chip">{s}</li>
              ))}
            </ul>
          </MethodologyDisclosure>
        )}
      </div>
    </section>
  );
}
