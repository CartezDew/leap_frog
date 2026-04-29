// Frog Chat — fully client-side question answering grounded in the uploaded
// GA4 data.
//
// This module exposes a single entry point — `answerQuestion(analyzed, q)` —
// that tokenises the user's question, walks an ordered list of intent
// matchers, and returns a structured answer:
//
//   {
//     answer: string (markdown),         // what to render in the bubble
//     source: 'data' | 'web',            // grounding tag for the badge
//     suggestions: string[],             // follow-up prompts to render
//     webSearchUrl: string | null,       // present when source === 'web'
//     intent: string,                    // for analytics / debugging
//   }
//
// Design philosophy:
//   - Every numeric claim must come from `analyzed`. Numbers never get
//     hallucinated. If we don't know, we say so and offer a web search.
//   - Intents are small, focused handlers. Adding a new question type is a
//     matter of writing one more matcher + handler at the bottom.
//   - The handlers receive a normalised (`q`) string AND the original
//     question so they can pluck out entity names like page paths, device
//     types, source names, months, etc.
//   - We bias toward "show your work": every answer includes the underlying
//     numbers so a user can audit the response against their pivot table.
//
// All formatting helpers live at the top so handlers stay short.

import {
  KNOWN_DATACENTER_CITIES,
  KNOWN_SPAM_SOURCES,
  MONTH_NAMES,
} from './skillConfig.js';
import {
  detectAiSource,
  pickWarmProspects,
  summarizeAiSources,
} from './levers.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function num(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtInt(v) {
  const n = num(v, NaN);
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function fmtPct(v, decimals = 1) {
  const n = num(v, NaN);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtDelta(v) {
  const n = num(v, 0);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtInt(Math.abs(n))}`;
}

function pct(part, whole) {
  const w = num(whole, 0);
  if (!w) return 0;
  return num(part, 0) / w;
}

function bullet(items) {
  return items
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n');
}

function table(headers, rows) {
  if (!rows || rows.length === 0) return '';
  const sep = headers.map(() => '---').join(' | ');
  const head = headers.join(' | ');
  const body = rows
    .map((r) => r.map((c) => (c === null || c === undefined ? '—' : String(c))).join(' | '))
    .join('\n');
  return `| ${head} |\n| ${sep} |\n${body
    .split('\n')
    .map((line) => `| ${line} |`)
    .join('\n')}`;
}

function normalize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9/.\-_\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function any(q, words) {
  return words.some((w) => q.includes(w));
}

function all(q, words) {
  return words.every((w) => q.includes(w));
}

const ROUTES = {
  overview: { label: 'Executive Summary', path: '/overview' },
  insights: { label: 'Actionable Insights', path: '/insights' },
  bounce: { label: 'Bounce Rate', path: '/bounce' },
  users: { label: 'User ID Engagement', path: '/users' },
  sources: { label: 'Traffic Sources', path: '/sources' },
  pages: { label: 'Page Path Analysis', path: '/pages' },
  unicorns: { label: 'Unicorn Pages', path: '/unicorns' },
  contact: { label: 'Contact Form Intel', path: '/contact' },
  bots: { label: 'Bot Traffic Intelligence', path: '/bots' },
  upload: { label: 'Upload Data', path: '/upload' },
  keywords: { label: 'Keywords', path: '/keywords' },
};

function routeLink(key, label = null) {
  const route = ROUTES[key];
  if (!route) return '';
  return `[${label || route.label}](${route.path})`;
}

function seeAlso(key, extra = '') {
  const link = routeLink(key);
  if (!link) return '';
  return `\n\nSee the full breakdown on the ${link} page.${extra}`;
}

function normalizeName(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstValue(row, keys, fallback = undefined) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return fallback;
}

function cleanTrafficEstimate(analyzed) {
  const s = analyzed?.summary || {};
  const b = analyzed?.bots?.summary || {};
  const totalSessions = num(s.total_sessions);
  const humanSessions = num(b.human_sessions);
  const confirmed = num(b.confirmed_bot_sessions);
  const likely = num(b.likely_bot_sessions);
  const suspicious = num(b.suspicious_sessions);
  const reportedEngagement = num(s.engagement_rate);
  const reportedBounce = num(s.site_bounce_rate);
  const botSessions = confirmed + likely;
  const cleanBounce = totalSessions > botSessions
    ? Math.max(0, (reportedBounce * totalSessions - botSessions) / (totalSessions - botSessions))
    : reportedBounce;
  const cleanEngagement = 1 - cleanBounce;
  return {
    reported_bounce: reportedBounce,
    clean_bounce: cleanBounce,
    reported_engagement: reportedEngagement,
    clean_engagement: cleanEngagement,
    human_sessions: humanSessions,
    confirmed_bot_sessions: confirmed,
    likely_bot_sessions: likely,
    suspicious_sessions: suspicious,
    bot_sessions: botSessions,
    bot_share: pct(botSessions, totalSessions),
    total_sessions: totalSessions,
  };
}

function conversionLiftTarget(current, lift = 0.5) {
  const base = num(current);
  return Math.ceil(base * (1 + lift));
}

function bounceReductionTarget(rate, reduction = 0.2) {
  return num(rate) * (1 - reduction);
}

function findByName(list, key, names) {
  const wanted = names.map(normalizeName).filter(Boolean);
  return (list || []).find((row) => {
    const name = normalizeName(firstValue(row, [key, key[0].toUpperCase() + key.slice(1)]));
    return wanted.some((needle) => name.includes(needle));
  });
}

function filterByNames(list, key, names) {
  const wanted = names.map(normalizeName).filter(Boolean);
  return (list || []).filter((row) => {
    const name = normalizeName(firstValue(row, [key, key[0].toUpperCase() + key.slice(1)]));
    return wanted.some((needle) => name.includes(needle));
  });
}

function sortBy(list, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...(list || [])].sort((a, b) => sign * (num(a?.[key]) - num(b?.[key])));
}

function sourceName(row) {
  return row?.source || row?.Source || '—';
}

function pageName(row) {
  return row?.page || row?.Page || '—';
}

function routeForMetric(kind) {
  if (kind === 'bots') return 'bots';
  if (kind === 'bounce') return 'bounce';
  if (kind === 'source') return 'sources';
  if (kind === 'page') return 'pages';
  if (kind === 'users') return 'users';
  if (kind === 'contact') return 'contact';
  return 'overview';
}

// Word-boundary aware contains. Used when a substring would create false
// positives (e.g. "form" inside "performing"). Pattern: the keyword must be
// surrounded by start/end-of-string or non-word characters.
function anyWord(q, words) {
  for (const w of words) {
    const re = new RegExp(`(^|[^a-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`);
    if (re.test(q)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Web fallback
// ---------------------------------------------------------------------------

function webFallback(question, opts = {}) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    `${question} Google Analytics GA4`,
  )}`;
  const note =
    opts.note ||
    `That question goes beyond what's in your uploaded GA4 export. ` +
      `I only answer with numbers I can prove from your data — so for general industry guidance, ` +
      `definitions, or how-to steps, here's a curated web search.`;
  return {
    answer:
      `${note}\n\n` +
      `**[Search the web for "${question}" →](${url})**\n\n` +
      `Or try one of the data-grounded prompts below.`,
    source: 'web',
    webSearchUrl: url,
    intent: opts.intent || 'web_fallback',
    suggestions: defaultSuggestions(),
  };
}

// ---------------------------------------------------------------------------
// Default follow-up suggestions
// ---------------------------------------------------------------------------

function defaultSuggestions() {
  return [
    'Tell me something I don’t know',
    'What is our current homepage bounce rate?',
    'How much of our traffic is bots?',
    'Which recommendation has the biggest impact?',
    'How many genuine leads did we get?',
    'What should we prioritize first?',
  ];
}

// ---------------------------------------------------------------------------
// Empty-data guard
// ---------------------------------------------------------------------------

function emptyDataResponse() {
  return {
    answer:
      `I don't have any analytics data loaded yet. ` +
      `Drop a GA4 Excel export on the **Upload** page, hit **Run analysis**, ` +
      `and then come back — I'll be able to answer questions specific to *your* data.`,
    source: 'data',
    suggestions: [
      'How do I upload my GA4 data?',
      'What questions can you answer?',
      'What is a bounce rate?',
    ],
    webSearchUrl: null,
    intent: 'no_data',
  };
}

// ---------------------------------------------------------------------------
// Entity extraction helpers
// ---------------------------------------------------------------------------

function findMonth(q) {
  // Long names first (they're unambiguous), then short — but match on word
  // boundaries so we never trip on "Mar" inside "summary" or "May" inside
  // "maybe".
  const longNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  for (let i = 0; i < longNames.length; i += 1) {
    if (anyWord(q, [longNames[i]])) return i + 1;
  }
  for (let i = 0; i < MONTH_NAMES.length; i += 1) {
    const short = MONTH_NAMES[i].toLowerCase();
    if (anyWord(q, [short])) return i + 1;
  }
  return null;
}

function monthLabel(num1to12) {
  if (!num1to12) return '—';
  return MONTH_NAMES[num1to12 - 1] || `Month ${num1to12}`;
}

// Match an entity name (source / medium / page / device / city) inside q.
// Returns the matching record, preferring longest-name matches first.
//
// We also strip enclosing punctuation like parentheses from the candidate
// name (so "(direct)" still matches the word "direct" in the question)
// and require the match to fall on a word boundary so common short tokens
// like "may" don't accidentally claim every other question.
function findEntity(q, list, key) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = [...list]
    .filter((r) => r && r[key])
    .sort((a, b) => String(b[key]).length - String(a[key]).length);
  for (const r of sorted) {
    const raw = String(r[key]).toLowerCase();
    if (!raw) continue;
    if (raw === '/' && q.includes('homepage')) return r;
    const stripped = raw.replace(/[()[\]{}]/g, '').trim();
    if (stripped.length < 3) continue;
    if (anyWord(q, [stripped])) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intent: greeting / capabilities
// ---------------------------------------------------------------------------

function intentGreeting(q) {
  return /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/.test(q);
}

function answerGreeting(_q, analyzed) {
  const sums = analyzed?.summary;
  const period = sums?.report_period
    ? `${sums.report_period}${sums.report_year ? ` ${sums.report_year}` : ''}`
    : 'your uploaded period';
  return {
    answer:
      `Hey — I'm the Frog. I can answer any question grounded in your GA4 data ` +
      `(${period}). Ask me about traffic, sources, pages, bounce rate, contacts, bots, ` +
      `users, monthly trends, or industry benchmarks. Pick a starter below or type your own.`,
    source: 'data',
    intent: 'greeting',
    suggestions: defaultSuggestions(),
    webSearchUrl: null,
  };
}

function intentCapabilities(q) {
  return (
    any(q, ['what can you', 'what do you', 'help me', 'how do you work', 'what questions']) ||
    q === 'help'
  );
}

function answerCapabilities(_q, analyzed) {
  const sheets = (analyzed?.metadata?.sheets_found || []).join(', ') || 'your loaded sheets';
  return {
    answer:
      `I'm grounded in your uploaded data — I never make up numbers. I can answer questions across:\n\n` +
      bullet([
        '**Top-line KPIs** — sessions, users, new users, engagement rate, bounce rate.',
        '**Traffic sources & mediums** — organic, direct, paid, referral, by channel.',
        '**Pages** — best/worst pages, unicorn pages, high-bounce opportunities.',
        '**Bounce rate** — site, by channel, vs industry benchmark, recommendations.',
        '**Monthly trends** — best month, worst month, anomalies, month-by-month comparisons.',
        '**Contacts & leads** — submissions, intent breakdown, lead routing.',
        '**Bots / fake traffic** — confirmed bot sessions, suspicious sources & cities.',
        '**User IDs** — high-engagement IDs, multi-month researchers.',
        '**Devices & geography** — mobile vs desktop, top cities, anomalies.',
        '**Calculation accuracy** — why dashboard numbers may differ from your pivot.',
      ]) +
      `\n\nIf the question isn't in your data, I'll point you to a web search.\n\n` +
      `*Sheets I'm currently reading from: ${sheets}.*`,
    source: 'data',
    intent: 'capabilities',
    suggestions: defaultSuggestions(),
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: top-line KPIs
// ---------------------------------------------------------------------------

function intentSummary(q) {
  return (
    any(q, ['summary', 'overview', 'snapshot', 'big picture', 'recap', 'tldr', 'overall']) ||
    all(q, ['how', 'doing']) ||
    all(q, ['how', 'site'])
  );
}

function answerSummary(_q, analyzed) {
  const s = analyzed.summary || {};
  const benchTier = analyzed?.bounce?.benchmark?.site?.tier?.label || null;
  return {
    answer:
      `Here's the high-level snapshot for **${s.report_period || 'your period'}${
        s.report_year ? ` ${s.report_year}` : ''
      }**:\n\n` +
      bullet([
        `**${fmtInt(s.total_sessions)}** total sessions`,
        `**${fmtInt(s.total_users)}** total users (${fmtInt(s.new_users)} new — ${fmtPct(
          s.new_user_rate,
        )} of users)`,
        `**${fmtInt(s.engaged_sessions)}** engaged sessions (${fmtPct(
          s.engagement_rate,
        )} engagement rate)`,
        `**${fmtPct(s.site_bounce_rate)}** site bounce rate${
          benchTier ? ` — *${benchTier} for B2B services*` : ''
        }`,
        `**${fmtInt(s.organic_sessions)}** organic sessions (${fmtPct(
          s.organic_bounce_rate,
        )} bounce)`,
        `**${fmtInt(s.direct_sessions)}** direct sessions (${fmtPct(
          s.direct_bounce_rate,
        )} bounce)`,
        `**${fmtInt(s.contact_page_sessions)}** sessions hit /contact (${fmtPct(
          s.contact_session_share,
        )} of all sessions)`,
        `**${fmtInt(s.total_contact_submissions)}** contact-form leads captured`,
      ]) +
      `\n\nWant me to drill into anything specific?`,
    source: 'data',
    intent: 'summary',
    suggestions: [
      'What are my top traffic sources?',
      'How does bounce compare to industry?',
      'What was my best month?',
      'How many leads came in?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: sessions (total / count)
// ---------------------------------------------------------------------------

function intentSessions(q) {
  return (
    (q.includes('session') &&
      any(q, ['total', 'how many', 'count', 'number of', 'sum', 'all'])) ||
    /how many sessions/.test(q)
  );
}

function answerSessions(_q, analyzed) {
  const s = analyzed.summary || {};
  return {
    answer:
      `You had **${fmtInt(s.total_sessions)} total sessions** in ${
        s.report_period || 'the period'
      }${s.report_year ? ` ${s.report_year}` : ''}.\n\n` +
      `Of those, **${fmtInt(s.engaged_sessions)} (${fmtPct(
        s.engagement_rate,
      )})** were engaged sessions — meaning users spent ≥10 seconds, fired ≥2 events, ` +
      `or converted. The remaining **${fmtInt(
        num(s.total_sessions) - num(s.engaged_sessions),
      )} (${fmtPct(s.site_bounce_rate)})** bounced.`,
    source: 'data',
    intent: 'sessions_total',
    suggestions: [
      'Show me the monthly sessions trend',
      'What are my top sources?',
      'What was my best month for sessions?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: users / new users
// ---------------------------------------------------------------------------

function intentUsers(q) {
  if (!q.includes('user')) return false;
  return any(q, ['how many', 'total', 'count', 'number of', 'new']);
}

function answerUsers(q, analyzed) {
  const s = analyzed.summary || {};
  if (q.includes('new')) {
    return {
      answer:
        `You had **${fmtInt(s.new_users)} new users** — that's **${fmtPct(
          s.new_user_rate,
        )}** of your **${fmtInt(s.total_users)}** total users.\n\n` +
        `A high new-user rate (>60%) means strong top-of-funnel acquisition; a low rate ` +
        `means most traffic is returning visitors. Yours is *${
          num(s.new_user_rate) > 0.6
            ? 'acquisition-heavy'
            : num(s.new_user_rate) > 0.4
              ? 'balanced'
              : 'returning-visitor heavy'
        }*.`,
      source: 'data',
      intent: 'new_users',
      suggestions: [
        'Where are my new users coming from?',
        'Are returning visitors converting?',
        'Show me high-engagement user IDs',
      ],
      webSearchUrl: null,
    };
  }
  return {
    answer:
      `You had **${fmtInt(s.total_users)} total users** in ${
        s.report_period || 'the period'
      }. ${fmtInt(s.new_users)} of those (${fmtPct(s.new_user_rate)}) were brand-new visitors.\n\n` +
      `*Note:* GA4 deduplicates users within a period. The dashboard sums monthly uniques, ` +
      `so a user active in Jan and Feb is counted twice in this number — your true annual unique ` +
      `count will usually be smaller.`,
    source: 'data',
    intent: 'users_total',
    suggestions: [
      'How many were new users?',
      'Who are my high-engagement user IDs?',
      'Are any users active across multiple months?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: bounce rate
// ---------------------------------------------------------------------------

function intentBounce(q) {
  return q.includes('bounce');
}

function answerBounce(q, analyzed) {
  const s = analyzed.summary || {};
  const bench = analyzed?.bounce?.benchmark || null;
  const byChannel = analyzed?.bounce?.by_channel || [];

  // Channel-specific bounce
  if (q.includes('organic')) {
    return {
      answer:
        `Your organic bounce rate is **${fmtPct(s.organic_bounce_rate)}** across ` +
        `**${fmtInt(s.organic_sessions)} organic sessions** (Google + Bing). ` +
        `${num(s.organic_bounce_rate) < num(s.site_bounce_rate) ? '✅ Better' : '⚠️ Worse'} ` +
        `than your site average of ${fmtPct(s.site_bounce_rate)}.`,
      source: 'data',
      intent: 'bounce_organic',
      suggestions: ['How does bounce compare to industry?', 'Show me bounce by channel'],
      webSearchUrl: null,
    };
  }

  if (q.includes('direct')) {
    return {
      answer:
        `Direct traffic bounce rate is **${fmtPct(s.direct_bounce_rate)}** across ` +
        `**${fmtInt(s.direct_sessions)} sessions**. Direct traffic includes typed-URL ` +
        `visits and untracked links — high bounce here often means stale URLs in ` +
        `email signatures or incorrect UTM tagging.`,
      source: 'data',
      intent: 'bounce_direct',
      suggestions: ['Where is my best traffic from?', 'How does bounce compare to industry?'],
      webSearchUrl: null,
    };
  }

  // Industry benchmark
  if (any(q, ['industry', 'benchmark', 'compare', 'average', 'good', 'bad', 'vs'])) {
    if (!bench) {
      return {
        answer:
          `Your site bounce rate is **${fmtPct(s.site_bounce_rate)}**. ` +
          `Industry benchmark data hasn't loaded — open the **Bounce Rate** tab for the full breakdown.`,
        source: 'data',
        intent: 'bounce_benchmark',
        suggestions: defaultSuggestions(),
        webSearchUrl: null,
      };
    }
    const tierLabel = bench.site?.tier?.label || bench.site?.tier?.id || '—';
    const median = num(bench.industry_median, NaN);
    const siteRate = num(s.site_bounce_rate);
    let comparisonLine = `Industry median: **—** (no benchmark median loaded).`;
    if (Number.isFinite(median) && median > 0) {
      const diff = siteRate - median;
      const pctOf = Math.abs(diff / median) * 100;
      comparisonLine = `Industry median: **${fmtPct(median)}**. ${
        diff < 0
          ? `You are **${pctOf.toFixed(0)}% below** the median (lower is better — that's good).`
          : diff > 0
            ? `You are **${pctOf.toFixed(0)}% above** the median (room to improve).`
            : `You're sitting right on the median.`
      }`;
    }
    return {
      answer:
        `Your site bounce rate is **${fmtPct(
          s.site_bounce_rate,
        )}** — *${tierLabel}* for B2B services.\n\n` +
        `**Industry context (B2B services):**\n` +
        bullet([
          comparisonLine,
          `Excellent: ≤ 35% · Good: 35–50% · Average: 50–65% · Poor: > 65%`,
        ]) +
        `\n\nOpen the **Bounce Rate** tab for the full benchmark scale and a list of ` +
        `data-driven recommendations specific to your traffic.`,
      source: 'data',
      intent: 'bounce_benchmark',
      suggestions: [
        'How can I improve my bounce rate?',
        'Which pages bleed the most visitors?',
        'Show me bounce by channel',
      ],
      webSearchUrl: null,
    };
  }

  // Bounce by channel / by source
  if (any(q, ['channel', 'by source', 'by medium', 'breakdown'])) {
    const top = byChannel.slice(0, 6).map((c) => [
      c.medium || c.source || c.Medium || c.Source || '—',
      fmtInt(c.sessions),
      fmtPct(c.bounce_rate),
    ]);
    return {
      answer:
        `**Bounce rate by channel:**\n\n` +
        table(['Channel', 'Sessions', 'Bounce'], top) +
        `\n\n*Site average: ${fmtPct(s.site_bounce_rate)}.* ` +
        `Channels above the site average are dragging your overall bounce rate up.`,
      source: 'data',
      intent: 'bounce_by_channel',
      suggestions: [
        'How does bounce compare to industry?',
        'How can I improve my bounce rate?',
        'Which pages have the highest bounce?',
      ],
      webSearchUrl: null,
    };
  }

  // Default bounce answer
  return {
    answer:
      `Your **site bounce rate** is **${fmtPct(s.site_bounce_rate)}** ` +
      `(1 − engaged sessions ÷ total sessions).\n\n` +
      bullet([
        `Organic bounce: **${fmtPct(s.organic_bounce_rate)}** (${fmtInt(s.organic_sessions)} sessions)`,
        `Direct bounce: **${fmtPct(s.direct_bounce_rate)}** (${fmtInt(s.direct_sessions)} sessions)`,
        bench ? `B2B services tier: **${bench.site?.tier || '—'}**` : null,
      ]) +
      `\n\nWant a channel-by-channel breakdown or recommendations to improve it?`,
    source: 'data',
    intent: 'bounce_overall',
    suggestions: [
      'Show me bounce by channel',
      'How does bounce compare to industry?',
      'How can I improve my bounce rate?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: how to improve bounce rate (recommendations)
// ---------------------------------------------------------------------------

function intentImprove(q) {
  return (
    any(q, ['improve', 'fix', 'reduce', 'lower', 'decrease', 'how do i', 'how can i', 'what should']) &&
    any(q, ['bounce', 'engagement', 'session', 'traffic'])
  );
}

function answerImprove(_q, analyzed) {
  const recs = analyzed?.bounce?.benchmark?.recommendations || [];
  if (recs.length === 0) {
    return webFallback('how to improve bounce rate B2B services', {
      intent: 'improve_no_recs',
      note:
        `I don't have data-specific recommendations cached yet. Open the **Bounce Rate** ` +
        `tab to generate them, or here's a curated web search for B2B-services best practices.`,
    });
  }
  const top = recs.slice(0, 5);
  return {
    answer:
      `Here are the top recommendations *generated from your data* (Bounce Rate tab has more):\n\n` +
      top
        .map(
          (r, i) =>
            `**${i + 1}. ${r.title}** ${r.severity ? `*(${r.severity})*` : ''}\n` +
            `${r.detail || r.description || ''}`,
        )
        .join('\n\n'),
    source: 'data',
    intent: 'improve_bounce',
    suggestions: [
      'Which pages need attention first?',
      'How does bounce compare to industry?',
      'Show me high-engagement pages',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: top traffic sources / channels / mediums
// ---------------------------------------------------------------------------

function intentTopSources(q) {
  return (
    (any(q, ['top', 'best', 'biggest', 'most', 'main', 'leading']) &&
      any(q, ['source', 'channel', 'traffic', 'medium'])) ||
    /where.*traffic/.test(q) ||
    /traffic.*coming/.test(q)
  );
}

function answerTopSources(q, analyzed) {
  const sources = analyzed?.sources || [];
  const wantsCount = q.match(/top\s+(\d+)/);
  const limit = wantsCount ? Math.min(20, Number(wantsCount[1])) : 8;
  const top = sources.slice(0, limit);
  if (top.length === 0) {
    return {
      answer: `I don't see any source-level data in this upload — try the **Traffic Sources** tab.`,
      source: 'data',
      intent: 'top_sources_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const rows = top.map((s) => {
    const name = s.source || s.Source || '—';
    return [
      name,
      fmtInt(s.sessions),
      fmtPct(s.engagement_rate),
      fmtPct(s.bounce_rate),
    ];
  });
  const totalSessions = num(analyzed?.summary?.total_sessions);
  const topShare = totalSessions
    ? pct(num(top[0]?.sessions), totalSessions)
    : 0;
  return {
    answer:
      `**Top ${top.length} traffic sources** (by sessions):\n\n` +
      table(['Source', 'Sessions', 'Engagement', 'Bounce'], rows) +
      `\n\n` +
      `Your #1 source — **${top[0].source || top[0].Source}** — drives **${fmtPct(
        topShare,
      )}** of all sessions.`,
    source: 'data',
    intent: 'top_sources',
    suggestions: [
      'How is google performing?',
      'Compare organic vs direct',
      'Which source has the best engagement?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: specific source lookup ("tell me about google", "how is linkedin")
// ---------------------------------------------------------------------------

function intentSourceLookup(q, analyzed) {
  const sources = analyzed?.sources || [];
  if (sources.length === 0) return false;
  // Trigger if question mentions a known source name AND asks for info.
  const named = findEntity(q, sources, 'source') || findEntity(q, sources, 'Source');
  if (!named) return false;
  if (
    any(q, [
      'how is',
      'how are',
      "how's",
      'tell me',
      'about',
      'performance',
      'performing',
      'doing',
      'show me',
      'breakdown',
      'overview',
      'analyze',
      'analysis',
      'metrics',
      'stats',
    ])
  ) {
    return named;
  }
  return false;
}

function answerSourceLookup(_q, analyzed, source) {
  const totalSessions = num(analyzed?.summary?.total_sessions);
  const share = pct(num(source.sessions), totalSessions);
  const name = source.source || source.Source;
  const eqs = source.engagement_quality_score ?? source.eqs;
  return {
    answer:
      `**${name}** — performance breakdown:\n\n` +
      bullet([
        `**${fmtInt(source.sessions)}** sessions (${fmtPct(share)} of site total)`,
        `**${fmtInt(source.engaged_sessions)}** engaged sessions`,
        `**${fmtPct(source.engagement_rate)}** engagement rate`,
        `**${fmtPct(source.bounce_rate)}** bounce rate`,
        eqs != null
          ? `**Engagement Quality Score:** ${num(eqs).toFixed(0)}/100`
          : null,
        source.bot_classification && source.bot_classification !== 'human'
          ? `⚠️ Flagged as **${source.bot_classification.replace('_', ' ')}** — ` +
            `treat with caution.`
          : null,
      ]),
    source: 'data',
    intent: 'source_lookup',
    suggestions: [
      'Compare top sources',
      'Which source has the best engagement?',
      'Show me bounce by channel',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: top pages / unicorn pages / problem pages
// ---------------------------------------------------------------------------

function intentTopPages(q) {
  return (
    any(q, ['top page', 'best page', 'most viewed', 'most visited', 'popular page', 'top urls']) ||
    (q.includes('page') && any(q, ['top', 'best', 'most']))
  );
}

function answerTopPages(q, analyzed) {
  const pages = analyzed?.pages?.top_pages || [];
  if (pages.length === 0) {
    return {
      answer: `I don't see Page Path data in this upload.`,
      source: 'data',
      intent: 'top_pages_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const wantsCount = q.match(/top\s+(\d+)/);
  const limit = wantsCount ? Math.min(20, Number(wantsCount[1])) : 8;
  const rows = pages.slice(0, limit).map((p) => [
    p.page || p.Page || '—',
    fmtInt(p.sessions),
    fmtPct(p.bounce_rate),
  ]);
  return {
    answer:
      `**Top ${rows.length} pages** by sessions:\n\n` +
      table(['Page', 'Sessions', 'Bounce'], rows) +
      `\n\nOpen the **Page Path Analysis** tab for the full list of ${analyzed.pages.all_pages_count} pages.`,
    source: 'data',
    intent: 'top_pages',
    suggestions: [
      'Show me unicorn pages',
      'Which pages bleed visitors?',
      'How is the homepage performing?',
    ],
    webSearchUrl: null,
  };
}

function intentUnicorns(q) {
  return q.includes('unicorn') || all(q, ['high', 'engagement', 'page']) || all(q, ['best', 'engaging']);
}

function answerUnicorns(_q, analyzed) {
  const u = analyzed?.unicorns || [];
  if (u.length === 0) {
    return {
      answer:
        `No unicorn pages found in this dataset. *(Definition: ≥ 100 sessions and ≤ 25% bounce — ` +
        `pages that pull weight AND keep people engaged.)* Try lowering the bar on the ` +
        `**Unicorn Pages** tab.`,
      source: 'data',
      intent: 'unicorns_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const rows = u
    .slice(0, 8)
    .map((p) => [p.page || p.Page || '—', fmtInt(p.sessions), fmtPct(p.bounce_rate)]);
  const winner = u[0];
  return {
    answer:
      `Found **${u.length} unicorn pages** (high traffic + low bounce):\n\n` +
      table(['Page', 'Sessions', 'Bounce'], rows) +
      `\n\nThese pages are doing the engagement work for you. Mine the messaging and CTAs ` +
      `from the top one — **${winner.page || winner.Page}** (${fmtPct(
        winner.bounce_rate,
      )} bounce) — and apply the patterns to your high-bounce pages.`,
    source: 'data',
    intent: 'unicorns',
    suggestions: [
      'Which pages need the most help?',
      'How can I improve the homepage?',
      'Show me top traffic sources',
    ],
    webSearchUrl: null,
  };
}

function intentProblemPages(q) {
  return (
    any(q, [
      'high bounce',
      'bleed',
      'bleeding',
      'losing visitor',
      'losing traffic',
      'worst page',
      'problem page',
      'drop off',
      'drop-off',
      'underperforming',
    ]) ||
    (q.includes('page') && any(q, ['fix', 'improve', 'opportunity', 'attention']))
  );
}

function answerProblemPages(_q, analyzed) {
  const opps = analyzed?.bounce?.high_bounce_opportunities || analyzed?.opportunities || [];
  if (opps.length === 0) {
    return {
      answer: `No high-bounce, high-traffic pages flagged. That's good news — you don't have any obvious bleeders.`,
      source: 'data',
      intent: 'problem_pages_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const rows = opps
    .slice(0, 6)
    .map((p) => [p.page || p.Page || '—', fmtInt(p.sessions), fmtPct(p.bounce_rate)]);
  return {
    answer:
      `**${opps.length} pages** are pulling traffic AND losing visitors fast (≥ 50% bounce, ≥ 100 sessions):\n\n` +
      table(['Page', 'Sessions', 'Bounce'], rows) +
      `\n\nFix order is usually: **headline + above-the-fold CTA** → **page speed** → **content match for the inbound query**.`,
    source: 'data',
    intent: 'problem_pages',
    suggestions: [
      'Show me unicorn pages for inspiration',
      'How does my bounce compare to industry?',
      'Are bots inflating my bounce?',
    ],
    webSearchUrl: null,
  };
}

function intentPageLookup(q, analyzed) {
  const pages = analyzed?.pages?.top_pages || [];
  if (pages.length === 0) return false;
  // Match "/something" path tokens
  const pathMatch = q.match(/\/[a-z0-9._\-/]+\/?/);
  if (pathMatch) {
    const wanted = pathMatch[0].toLowerCase();
    const exact = pages.find(
      (p) => String(p.page || p.Page || '').toLowerCase() === wanted,
    );
    if (exact) return exact;
    const partial = pages.find((p) =>
      String(p.page || p.Page || '').toLowerCase().includes(wanted),
    );
    if (partial) return partial;
  }
  // "homepage" alias
  if (q.includes('homepage') || q.includes('home page')) {
    return pages.find((p) => (p.page || p.Page) === '/') || null;
  }
  return false;
}

function answerPageLookup(_q, analyzed, page) {
  const totalSessions = num(analyzed?.summary?.total_sessions);
  const share = pct(num(page.sessions), totalSessions);
  const eqs = page.engagement_quality_score ?? page.eqs;
  return {
    answer:
      `**${page.page || page.Page}** — page breakdown:\n\n` +
      bullet([
        `**${fmtInt(page.sessions)}** sessions (${fmtPct(share)} of site total)`,
        `**${fmtPct(page.bounce_rate)}** bounce rate`,
        page.engagement_rate != null
          ? `**${fmtPct(page.engagement_rate)}** engagement rate`
          : null,
        page.avg_engagement_time != null
          ? `**${num(page.avg_engagement_time).toFixed(1)}s** avg engagement time`
          : null,
        eqs != null
          ? `**Engagement Quality Score:** ${num(eqs).toFixed(0)}/100`
          : null,
        page.content_role
          ? `**Role:** ${page.content_role}`
          : null,
      ]),
    source: 'data',
    intent: 'page_lookup',
    suggestions: ['Show me unicorn pages', 'Which pages need attention?', 'Top traffic sources'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: monthly trends / best month / worst month
// ---------------------------------------------------------------------------

function intentMonth(q) {
  if (!q.includes('month')) return false;
  return any(q, ['best', 'worst', 'highest', 'lowest', 'top', 'peak', 'most', 'least']);
}

// Monthly rows expose `Month` (1–12 integer) and `month_name` (e.g. "Jan").
function monthlyLabel(row) {
  if (!row) return '—';
  if (row.month_name) return row.month_name;
  const n = num(row.Month || row.month_num || row.month, 0);
  return monthLabel(n);
}

function answerMonth(q, analyzed) {
  const monthly = analyzed?.monthly || [];
  if (monthly.length === 0) {
    return {
      answer: `I don't have monthly data for this upload.`,
      source: 'data',
      intent: 'month_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const wantsWorst = any(q, ['worst', 'lowest', 'least']);
  const sorted = [...monthly].sort((a, b) =>
    wantsWorst ? num(a.sessions) - num(b.sessions) : num(b.sessions) - num(a.sessions),
  );
  const winner = sorted[0];
  const loser = sorted[sorted.length - 1];
  return {
    answer:
      `**${wantsWorst ? 'Lowest' : 'Highest'} month for sessions:** ` +
      `**${monthlyLabel(winner)}** with **${fmtInt(winner.sessions)}** sessions ` +
      `(${fmtPct(winner.bounce_rate)} bounce).\n\n` +
      `For contrast, your ${wantsWorst ? 'highest' : 'lowest'} month was **${monthlyLabel(
        loser,
      )}** with **${fmtInt(loser.sessions)}** sessions.\n\n` +
      `Open the **Executive Summary** for the full monthly trend chart.`,
    source: 'data',
    intent: wantsWorst ? 'worst_month' : 'best_month',
    suggestions: [
      'Show me monthly anomalies',
      'How did sessions trend over the year?',
      'Compare May vs the rest of the year',
    ],
    webSearchUrl: null,
  };
}

function intentMonthLookup(q, analyzed) {
  const monthly = analyzed?.monthly || [];
  if (monthly.length === 0) return false;
  const wanted = findMonth(q);
  if (!wanted) return false;
  const row = monthly.find(
    (m) => num(m.Month || m.month_num) === wanted,
  );
  return row || false;
}

function answerMonthLookup(_q, _analyzed, row) {
  return {
    answer:
      `**${monthlyLabel(row)}** performance:\n\n` +
      bullet([
        `**${fmtInt(row.sessions)}** sessions`,
        `**${fmtInt(row.engaged_sessions)}** engaged sessions (${fmtPct(
          row.engagement_rate ?? pct(row.engaged_sessions, row.sessions),
        )} engagement)`,
        `**${fmtInt(row.total_users)}** total users (${fmtInt(row.new_users)} new)`,
        row.bounce_rate != null
          ? `**${fmtPct(row.bounce_rate)}** bounce rate`
          : null,
        row.event_count != null ? `**${fmtInt(row.event_count)}** events` : null,
        row.sessions_mom_pct != null && row.sessions_mom_pct !== 0
          ? `**${num(row.sessions_mom_pct) > 0 ? '+' : ''}${(num(row.sessions_mom_pct) * 100).toFixed(
              1,
            )}%** sessions vs prior month`
          : null,
      ]),
    source: 'data',
    intent: 'month_lookup',
    suggestions: ['What was my best month?', 'Show me monthly anomalies', 'Compare to other months'],
    webSearchUrl: null,
  };
}

function intentAnomalies(q) {
  return any(q, ['anomal', 'spike', 'dip', 'unusual', 'outlier', 'abnormal']);
}

function answerAnomalies(_q, analyzed) {
  const a = analyzed?.unique?.anomalies?.anomalies || [];
  if (a.length === 0) {
    return {
      answer: `No statistically significant anomalies (>1.5σ from baseline) detected in your monthly data.`,
      source: 'data',
      intent: 'anomalies_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const rows = a.slice(0, 6).map((x) => {
    const monthName =
      x.month && typeof x.month === 'string' && x.month.length > 0
        ? x.month
        : monthLabel(num(x.month_number || x.month_num, 0));
    const dir =
      x.direction === 'spike' || x.direction === 'up'
        ? '🔼 spike'
        : '🔽 dip';
    const isPct = x.metric && /rate|bounce/i.test(x.metric);
    return [
      monthName,
      x.metric || '—',
      dir,
      isPct ? fmtPct(x.value) : fmtInt(x.value),
      x.z_score != null ? num(x.z_score).toFixed(2) : '—',
    ];
  });
  return {
    answer:
      `Detected **${a.length} monthly anomalies** (>1.5σ from baseline):\n\n` +
      table(['Month', 'Metric', 'Direction', 'Value', 'Z-score'], rows),
    source: 'data',
    intent: 'anomalies',
    suggestions: ['What was my best month?', 'Show me monthly trend', 'Are bots driving the spikes?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: contacts / leads
// ---------------------------------------------------------------------------

function intentContacts(q) {
  // Use word-boundary matching so "perFORMing" doesn't trip "form", and
  // ignore mentions of /contact/ as a path (those are page lookups, not
  // contact-form questions).
  if (/\/contact\//.test(q) && !any(q, ['lead', 'submission', 'inquir', 'sales'])) {
    return false;
  }
  return anyWord(q, [
    'contacts',
    'contact',
    'leads',
    'lead',
    'submission',
    'submissions',
    'form',
    'forms',
    'inquiry',
    'inquiries',
    'sales',
    'prospects',
  ]);
}

function answerContacts(_q, analyzed) {
  const s = analyzed?.summary || {};
  const cs = analyzed?.contacts_summary || {};
  const contacts = analyzed?.contacts || [];
  if (!contacts.length && !s.total_contact_submissions) {
    return {
      answer: `I don't see any contact-form submissions in this dataset.`,
      source: 'data',
      intent: 'contacts_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const intentRows = Object.entries(cs.by_intent || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([k, v]) => [k, fmtInt(v), fmtPct(v / (cs.total || s.total_contact_submissions || 1))]);
  return {
    answer:
      `You captured **${fmtInt(s.total_contact_submissions || cs.total)}** contact-form submissions, ` +
      `from **${fmtInt(s.contact_page_sessions)}** sessions on /contact (${fmtPct(
        s.contact_session_share,
      )} of all traffic).\n\n` +
      (intentRows.length
        ? `**Lead intent breakdown:**\n\n` + table(['Intent', 'Leads', 'Share'], intentRows)
        : '') +
      `\n\nOpen the **Contact Form Intel** tab to see the actual messages and route them to sales.`,
    source: 'data',
    intent: 'contacts',
    suggestions: [
      'How many were sales-ready leads?',
      'Where are leads coming from?',
      'Show me the contact page bounce rate',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: bots / fake traffic
// ---------------------------------------------------------------------------

function intentBots(q) {
  return any(q, ['bot', 'fake', 'spam', 'fraud', 'crawler', 'scraper']);
}

function answerBots(_q, analyzed) {
  const b = analyzed?.bots?.summary;
  if (!b) {
    return {
      answer: `No bot-detection results available in this upload.`,
      source: 'data',
      intent: 'bots_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const totalSessions = num(analyzed?.summary?.total_sessions);
  const botShare = pct(b.confirmed_bot_sessions + b.likely_bot_sessions, totalSessions);
  const topBotCities = (analyzed?.bots?.cities || [])
    .filter(
      (c) =>
        c.bot_classification === 'confirmed_bot' ||
        c.bot_classification === 'likely_bot',
    )
    .slice(0, 5)
    .map((c) => [
      c.city || c.City || '—',
      fmtInt(c.sessions),
      c.bot_classification,
    ]);
  return {
    answer:
      `**Bot traffic intelligence:**\n\n` +
      bullet([
        `**${fmtInt(b.confirmed_bot_sessions)}** confirmed-bot sessions`,
        `**${fmtInt(b.likely_bot_sessions)}** likely-bot sessions`,
        `**${fmtInt(b.suspicious_sessions)}** suspicious sessions`,
        `**${fmtInt(b.human_sessions)}** confirmed-human sessions`,
        `**${fmtPct(botShare)}** of all sessions are bot/likely-bot`,
        `**${fmtInt(b.bot_user_ids)}** user IDs flagged as bots`,
        `**${fmtInt(b.fractional_user_ids)}** fractional user IDs detected (data integrity issue)`,
      ]) +
      (topBotCities.length
        ? `\n\n**Top bot-traffic origins:**\n\n` +
          table(['City', 'Sessions', 'Class'], topBotCities)
        : '') +
      `\n\nThe **Bot Traffic Intelligence** tab has the scoring methodology and full city/source list.`,
    source: 'data',
    intent: 'bots',
    suggestions: [
      'Are bots inflating my bounce rate?',
      'Which sources should I block?',
      'How is bot traffic scored?',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: devices (mobile / desktop / tablet)
// ---------------------------------------------------------------------------

function intentDevices(q) {
  return any(q, ['device', 'mobile', 'desktop', 'tablet']);
}

function answerDevices(q, analyzed) {
  const devices = analyzed?.devices || [];
  if (devices.length === 0) {
    return {
      answer: `No device-level data in this upload.`,
      source: 'data',
      intent: 'devices_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  // If the question is clearly a comparison ("mobile vs desktop"), defer
  // to answerCompare so we get a side-by-side table.
  if (intentCompare(q)) {
    const cmp = answerCompare(q, analyzed);
    if (cmp) return cmp;
  }
  // Specific device lookup — only when the device word stands alone (avoid
  // matching "mobile" inside an unrelated phrase).
  const wanted = ['mobile', 'desktop', 'tablet'].find((d) => anyWord(q, [d]));
  if (wanted) {
    const row = devices.find(
      (d) => String(d.device || d.Device || '').toLowerCase() === wanted,
    );
    if (row) {
      const total = num(analyzed?.summary?.total_sessions);
      return {
        answer:
          `**${wanted.charAt(0).toUpperCase() + wanted.slice(1)}** breakdown:\n\n` +
          bullet([
            `**${fmtInt(row.sessions)}** sessions (${fmtPct(pct(row.sessions, total))} of site total)`,
            `**${fmtPct(row.bounce_rate)}** bounce rate`,
            `**${fmtPct(row.engagement_rate)}** engagement rate`,
          ]),
        source: 'data',
        intent: 'device_lookup',
        suggestions: ['Compare mobile vs desktop', 'Show me top sources', 'Which pages do mobile users hit?'],
        webSearchUrl: null,
      };
    }
  }
  const rows = devices.map((d) => [
    d.device || d.Device || '—',
    fmtInt(d.sessions),
    fmtPct(d.bounce_rate),
    fmtPct(d.engagement_rate),
  ]);
  return {
    answer:
      `**Device breakdown:**\n\n` +
      table(['Device', 'Sessions', 'Bounce', 'Engagement'], rows),
    source: 'data',
    intent: 'devices',
    suggestions: ['Compare mobile vs desktop', 'Top traffic sources', 'Which pages need help?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: cities / geography
// ---------------------------------------------------------------------------

function intentCities(q) {
  return any(q, ['city', 'cities', 'geographic', 'location', 'where are users', 'country', 'region']);
}

function answerCities(_q, analyzed) {
  const cities = (analyzed?.cities || [])
    .filter((c) => c.bot_classification === 'human' || !c.bot_classification)
    .slice(0, 8);
  if (cities.length === 0) {
    return {
      answer: `No city-level data available — or all cities were classified as bot/suspicious traffic.`,
      source: 'data',
      intent: 'cities_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  const rows = cities.map((c) => [
    c.city || c.City || '—',
    fmtInt(c.sessions),
    fmtPct(c.bounce_rate),
  ]);
  return {
    answer:
      `**Top human-traffic cities:**\n\n` +
      table(['City', 'Sessions', 'Bounce'], rows) +
      `\n\n*GA4 drops long-tail cities, so this list is a sample — open the dashboard for the full set.*`,
    source: 'data',
    intent: 'cities',
    suggestions: ['Are bots concentrated in any city?', 'Show me top sources', 'Top pages'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: comparison ("compare X vs Y")
// ---------------------------------------------------------------------------

function intentCompare(q) {
  return q.includes(' vs ') || q.includes(' versus ') || q.startsWith('compare ');
}

function answerCompare(q, analyzed) {
  // Try sources, devices, channels, mediums
  const sources = analyzed?.sources || [];
  const devices = analyzed?.devices || [];
  const channels = analyzed?.bounce?.by_channel || [];
  const pool = [...sources, ...devices, ...channels];
  const matches = [];
  for (const r of pool) {
    const name = String(
      r.source || r.device || r.medium || r.Source || r.Device || r.Medium || '',
    ).toLowerCase();
    if (name && name.length > 1 && anyWord(q, [name])) {
      if (!matches.find((m) => m._name === name)) {
        matches.push({ ...r, _name: name });
      }
    }
    if (matches.length >= 4) break;
  }
  if (matches.length < 2) return null;
  const rows = matches.slice(0, 4).map((m) => [
    m.source || m.device || m.medium || m.Source || m.Device || m.Medium,
    fmtInt(m.sessions),
    fmtPct(m.bounce_rate),
    fmtPct(m.engagement_rate),
  ]);
  const winner = [...matches].sort((a, b) => num(b.sessions) - num(a.sessions))[0];
  return {
    answer:
      `**Side-by-side comparison:**\n\n` +
      table(['Item', 'Sessions', 'Bounce', 'Engagement'], rows) +
      `\n\n**${
        winner.source || winner.device || winner.medium || winner.Source || winner.Device || winner.Medium
      }** wins on volume with **${fmtInt(winner.sessions)}** sessions.`,
    source: 'data',
    intent: 'compare',
    suggestions: ['Top traffic sources', 'Show me bounce by channel', 'Top pages'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: insights (the curated top-10 list from analyzer / insightEngine)
// ---------------------------------------------------------------------------

function intentInsights(q) {
  return (
    any(q, ['insight', 'finding', 'key takeaway', 'highlight', 'what matters']) ||
    all(q, ['actionable'])
  );
}

function answerInsights(_q, analyzed) {
  const ins = analyzed?.insights || [];
  if (ins.length === 0) {
    return {
      answer: `No insights generated for this dataset yet.`,
      source: 'data',
      intent: 'insights_empty',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
    };
  }
  return {
    answer:
      `Top **${Math.min(ins.length, 6)}** insights from your data:\n\n` +
      ins
        .slice(0, 6)
        .map((i, idx) => `**${idx + 1}. ${i.title}**\n${i.evidence || i.description || ''}`)
        .join('\n\n'),
    source: 'data',
    intent: 'insights',
    suggestions: [
      'Which pages bleed visitors?',
      'How does bounce compare to industry?',
      'Show me unicorn pages',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: accuracy / numbers don't tie out
// ---------------------------------------------------------------------------

function intentAccuracy(q) {
  return (
    any(q, [
      'accuracy',
      'tie out',
      'match my pivot',
      'pivot table',
      "don't match",
      'doesnt match',
      'wrong number',
      'incorrect',
      'why is the number',
    ]) ||
    all(q, ['why', 'different'])
  );
}

function answerAccuracy(_q, analyzed) {
  const a = analyzed?.accuracy;
  if (!a) {
    return webFallback('GA4 dashboard numbers not matching pivot table', { intent: 'accuracy_no_data' });
  }
  const worst = a.worst?.slice(0, 3) || [];
  return {
    answer:
      `**Calculation accuracy snapshot:**\n\n` +
      bullet([
        `Status: **${a.status.toUpperCase()}**`,
        `Match: ${a.counts?.ok || 0} · Drift: ${a.counts?.warn || 0} · Disagree: ${a.counts?.error || 0}`,
        `Source of truth: dashboard reads site totals from the **${a.provenance || 'medium'}** sheet.`,
        `Sheets compared: ${a.available_sheets?.join(', ') || '—'}`,
      ]) +
      (worst.length
        ? `\n\n**Largest gaps vs other sheets:**\n` +
          worst
            .map(
              (w) =>
                `- **${w.kpi_label}** — ${w.cell_label}: ${
                  w.delta > 0 ? '+' : '−'
                }${fmtInt(Math.abs(w.delta))} (${(num(w.delta_pct) * 100).toFixed(1)}%)`,
            )
            .join('\n')
        : '') +
      `\n\nIf your pivot was built on the **${a.provenance}** sheet, the numbers should match. ` +
      `If your pivot was built on the **Source** or **Device** sheet, expect drift — see ` +
      `the *Calculation accuracy check* panel on the Executive Summary for the full matrix.`,
    source: 'data',
    intent: 'accuracy',
    suggestions: [
      'Why do the numbers differ?',
      'What was summed for sessions?',
      'Show me the verification report',
    ],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: definitions ("what is bounce rate", "define engagement rate")
// ---------------------------------------------------------------------------

const DEFINITIONS = [
  {
    keys: ['ga4', 'google analytics 4'],
    title: 'GA4',
    body:
      `GA4 is **Google Analytics 4**, Google's event-based analytics platform. ` +
      `This dashboard reads GA4 exports, then rebuilds stakeholder-friendly views for KPIs, sources, pages, users, contacts, and bot traffic.`,
  },
  {
    keys: ['bounce rate', 'bounce'],
    title: 'Bounce Rate',
    body:
      `**Bounce Rate = 1 − (Engaged Sessions ÷ Total Sessions).** ` +
      `In GA4, an engaged session is one that lasted ≥10 seconds, fired ≥2 events, ` +
      `or converted. A bounce is everything else.`,
  },
  {
    keys: ['session versus user', 'sessions versus users', 'session vs user', 'sessions vs users', 'difference between sessions and users'],
    title: 'Sessions vs Users',
    body:
      `A **session** is a visit. A **user** is the browser/device identity GA4 believes made the visit. ` +
      `One user can create multiple sessions, so sessions are usually higher than users.`,
  },
  {
    keys: ['returning user', 'new users and returning users', 'new user and returning user'],
    title: 'New vs Returning Users',
    body:
      `A **new user** is a first-time GA4 identity in the period. A **returning user** has been seen before. ` +
      `High new-user share usually means acquisition is working; low return share can mean weak nurturing or cookie churn.`,
  },
  {
    keys: ['universal analytics', 'ga4 versus universal', 'ga4 vs universal'],
    title: 'GA4 Bounce vs Universal Analytics',
    body:
      `Universal Analytics treated bounce as a single-page session with no interaction hit. ` +
      `GA4 defines bounce as the inverse of engagement: a session that was not engaged. ` +
      `That means GA4 bounce is tied to the 10-second, 2-event, or conversion engagement rule.`,
  },
  {
    keys: ['engagement rate'],
    title: 'Engagement Rate',
    body:
      `**Engagement Rate = Engaged Sessions ÷ Total Sessions.** ` +
      `It's the inverse of bounce rate — higher is better.`,
  },
  {
    keys: ['user id assigned', 'user ids assigned', 'how are user ids', 'new user id'],
    title: 'How GA4 User IDs Are Assigned',
    body:
      `GA4 usually identifies users through a browser/client ID stored in cookies, plus optional User-ID or Google Signals stitching. ` +
      `Someone can look like a new user when they switch devices, clear cookies, use privacy tools, or arrive through a stitched identity.`,
  },
  {
    keys: ['.2 suffix', 'cross-device', 'cross device'],
    title: 'Cross-Device `.2` User IDs',
    body:
      `The **.2** suffix is treated in this dashboard as a **cross-device/cookie-bridge artifact**. ` +
      `It can represent real engagement, but it is not a clean prospect identity, so user-quality views separate it from confirmed human IDs.`,
  },
  {
    keys: ['.17', 'google signals', 'signals id'],
    title: 'Google Signals `.17` User IDs',
    body:
      `A **.17** or **.18** suffix is treated as a **Google Signals stitched identity**. ` +
      `It can help deduplicate cross-device behavior, but it is not the same as a known buyer or CRM contact.`,
  },
  {
    keys: ['engaged session'],
    title: 'Engaged Session',
    body:
      `A GA4 session that meets at least one of: lasted ≥10 seconds, fired ≥2 events, ` +
      `or completed a conversion.`,
  },
  {
    keys: ['new user'],
    title: 'New User',
    body:
      `A user who visited your site for the first time in the reporting period. ` +
      `Identified by GA4's first-touch client_id or user_id.`,
  },
  {
    keys: ['total user', 'unique user'],
    title: 'Total Users',
    body:
      `Distinct users in the period. *Caveat:* the dashboard sums monthly uniques, so a ` +
      `user active in two months is counted twice. GA4's annual unique count is usually smaller.`,
  },
  {
    keys: ['unicorn'],
    title: 'Unicorn Page',
    body:
      `A page with **≥ 100 sessions and ≤ 25% bounce** — high traffic AND high engagement. ` +
      `These are your messaging gold mines: copy the patterns to the rest of the site.`,
  },
  {
    keys: ['eqs', 'engagement quality score'],
    title: 'Engagement Quality Score (EQS)',
    body:
      `A 0–100 composite score combining engagement rate, bounce rate, events per session, ` +
      `and time on page — normalised so you can rank sources, pages, and devices apples-to-apples.`,
  },
  {
    keys: ['confirmed bot', 'likely bot'],
    title: 'Bot Classification',
    body:
      `Each city and source is scored against rules (engagement < 1s, bounce ≥ 90%, ` +
      `datacenter IP ranges, known spam list, etc.). **Confirmed bot ≥ 7 points · ` +
      `Likely bot 4–6 · Suspicious 2–3 · Human 0–1.**`,
  },
];

function intentDefinition(q) {
  if (!any(q, ['what is', 'what does', 'whats', "what's", 'define', 'definition', 'meaning of', 'mean by'])) {
    return false;
  }
  let best = null;
  let bestLength = 0;
  for (const def of DEFINITIONS) {
    for (const key of def.keys) {
      if (q.includes(key) && key.length > bestLength) {
        best = def;
        bestLength = key.length;
      }
    }
  }
  return best || false;
}

function answerDefinition(_q, _analyzed, def) {
  return {
    answer: `**${def.title}**\n\n${def.body}`,
    source: 'data',
    intent: 'definition',
    suggestions: defaultSuggestions(),
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: dashboard how-to / navigation
// ---------------------------------------------------------------------------

function intentDashboardHowTo(q) {
  return (
    any(q, ['upload', 'file format', 'accept', 'multiple files', 'validation report', 'clear the data', 'clear data', 'start over', 'grayed out', 'greyed out', 'date range', 'where does the data come from']) ||
    all(q, ['section', 'gray']) ||
    all(q, ['section', 'grey'])
  );
}

function answerDashboardHowTo(q, analyzed) {
  const s = analyzed?.summary || {};
  if (any(q, ['upload']) && !any(q, ['multiple files', 'file format'])) {
    return {
      answer:
        `Open ${routeLink('upload')}, drag-drop a GA4/Semrush export or pick files from the Upload DATA library, then run analysis on the staged batch. ` +
        `If data is already loaded, use **Upload / Replace Data** in the sidebar or **Clear & Re-upload** on the Upload page.`,
      source: 'data',
      intent: 'dashboard_upload',
      suggestions: ['What file format does the dashboard accept?', 'Can I upload multiple files at once?', 'What does the validation report mean?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['file format', 'accept'])) {
    return {
      answer:
        `The dashboard accepts **GA4 Excel workbooks** and **Semrush Excel/PDF keyword reports**. ` +
        `Use the ${routeLink('upload')} page to drag-drop files, pick files from the Upload DATA library, or stage multiple files before running analysis.`,
      source: 'data',
      intent: 'dashboard_file_format',
      suggestions: ['Can I upload multiple files at once?', 'What does the validation report mean?', 'Where does the data come from?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['multiple files'])) {
    return {
      answer:
        `Yes. Stage multiple GA4/Semrush files on ${routeLink('upload')}, then run analysis once. ` +
        `The app merges compatible GA4 sheets into one ` +
        `browser-side dataset and keeps the source filenames attached to the current dataset summary.`,
      source: 'data',
      intent: 'dashboard_multiple_files',
      suggestions: ['What file format does the dashboard accept?', 'What does the validation report mean?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['validation report'])) {
    return {
      answer:
        `The validation report tells you which sheets were recognized, which columns mapped cleanly, and where totals may drift across GA4 exports. ` +
        `Warnings do not always mean the data is unusable; they show where to audit workbook structure before trusting a KPI.${seeAlso('upload')}`,
      source: 'data',
      intent: 'dashboard_validation',
      suggestions: ['Why do the numbers differ?', 'Where does the data come from?', 'How do I clear the data?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['clear', 'start over'])) {
    return {
      answer:
        `Open ${routeLink('upload')} and use **Clear & Re-upload** in the Current dataset section. ` +
        `That removes the browser localStorage dataset so the next analysis starts fresh.`,
      source: 'data',
      intent: 'dashboard_clear',
      suggestions: ['How do I upload a new data file?', 'What file format does the dashboard accept?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['grayed out', 'greyed out', 'section'])) {
    return {
      answer:
        `A section is grayed out when the right report type or sheet slice has not been uploaded yet. ` +
        `For example, Bot Traffic needs city/source data, User ID Engagement needs a user-id sheet, and Keywords needs a Semrush report. ` +
        `Upload the missing export on ${routeLink('upload')} and rerun analysis.`,
      source: 'data',
      intent: 'dashboard_gated_section',
      suggestions: ['What file format does the dashboard accept?', 'Where does the data come from?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['date range'])) {
    return {
      answer:
        `This loaded dataset covers **${s.report_period || 'the uploaded report period'}${
          s.report_year ? ` ${s.report_year}` : ''
        }**. The dashboard derives that from the uploaded GA4 workbook and stores it locally in your browser.${seeAlso('overview')}`,
      source: 'data',
      intent: 'dashboard_date_range',
      suggestions: ['How many total users did we have?', 'What was my best month?'],
      webSearchUrl: null,
    };
  }
  return {
    answer:
      `The data comes from the files uploaded on ${routeLink('upload')}. ` +
      `Parsing and analysis run in the browser; the app stores the current dataset in localStorage and does not need a backend. ` +
      `Dashboard pages then read the shared analyzed dataset.`,
    source: 'data',
    intent: 'dashboard_data_source',
    suggestions: ['What does the validation report mean?', 'What date range does this data cover?', 'How do I clear the data?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: methodology beyond simple glossary
// ---------------------------------------------------------------------------

function intentMethodology(q) {
  return (
    any(q, ['difference between sessions and users', 'sessions and users', 'sessions vs users', 'session vs user']) ||
    any(q, ['difference between new users and returning', 'new users and returning users']) ||
    any(q, ['how are user ids', 'new user id', 'user id assigned']) ||
    any(q, ['.2 suffix', '.17', 'google signals']) ||
    any(q, ['ga4 versus universal', 'ga4 vs universal', 'universal analytics'])
  );
}

function answerMethodology(q, analyzed) {
  const s = analyzed?.summary || {};
  if (any(q, ['sessions and users', 'sessions vs users', 'session vs user'])) {
    return {
      answer:
        `**Sessions** are visits; **users** are GA4 identities. In this dataset, you have ` +
        `**${fmtInt(s.total_sessions)} sessions** and **${fmtInt(s.total_users)} users**. ` +
        `That is about **${num(s.total_users) ? (num(s.total_sessions) / num(s.total_users)).toFixed(1) : '—'} sessions per user**.\n\n` +
        `One person can create multiple sessions, and one person can also appear as multiple users if cookies/devices change.${seeAlso('overview')}`,
      source: 'data',
      intent: 'methodology_sessions_users',
      suggestions: ['How many real human users visited?', 'What is an engaged session?', 'How are user IDs assigned?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['new users and returning', 'returning users'])) {
    const returning = Math.max(0, num(s.total_users) - num(s.new_users));
    return {
      answer:
        `You have **${fmtInt(s.new_users)} new users** and an estimated **${fmtInt(returning)} returning users** in the loaded period. ` +
        `New users are **${fmtPct(s.new_user_rate)}** of total users. ` +
        `A high new-user share means acquisition is active, but it can also be inflated by cookie resets, direct traffic, and bot/fractional IDs.${seeAlso('users')}`,
      source: 'data',
      intent: 'methodology_new_returning',
      suggestions: ['Why is the new user rate so high in direct traffic?', 'How many real human users visited?'],
      webSearchUrl: null,
    };
  }
  if (any(q, ['.2 suffix'])) {
    return answerDefinition(q, analyzed, DEFINITIONS.find((d) => d.title.startsWith('Cross-Device')));
  }
  if (any(q, ['.17', 'google signals'])) {
    return answerDefinition(q, analyzed, DEFINITIONS.find((d) => d.title.startsWith('Google Signals')));
  }
  if (any(q, ['universal analytics', 'ga4 versus universal', 'ga4 vs universal'])) {
    return answerDefinition(q, analyzed, DEFINITIONS.find((d) => d.title.startsWith('GA4 Bounce')));
  }
  return answerDefinition(q, analyzed, DEFINITIONS.find((d) => d.title.startsWith('How GA4')));
}

// ---------------------------------------------------------------------------
// Intent: surprising insight
// ---------------------------------------------------------------------------

function intentSurprise(q) {
  return any(q, ['tell me something i don', 'surprise me', 'something surprising', 'something interesting', 'hidden insight', 'dont know', "don't know"]);
}

function answerSurprise(_q, analyzed) {
  const warm = pickWarmProspects(analyzed?.users || [], 1)[0];
  const ai = summarizeAiSources(analyzed?.sources || [], num(analyzed?.summary?.total_sessions));
  const bots = cleanTrafficEstimate(analyzed);
  const anomalies = analyzed?.unique?.anomalies?.anomalies || [];
  const insight = analyzed?.insights?.[0];

  if (warm) {
    return {
      answer:
        `Here is the most interesting hidden signal: **user ${String(warm.user_id || '').slice(0, 18)}** looks like a warm researcher but does not appear tied to a contact-form conversion.\n\n` +
        bullet([
          `**${fmtInt(warm.total_sessions)}** sessions`,
          `**${fmtPct(warm.engagement_rate)}** engagement`,
          `**${num(warm.avg_session_duration).toFixed(1)}s** average session duration`,
          `Active across **${fmtInt(warm.months_active)}** month(s)`,
          `Persona: **${warm.persona || 'Engaged Visitor'}**`,
        ]) +
        `\n\nRecommendation: use this journey as a retargeting and nurture template, then compare it against contact-form leads.${seeAlso('users')}`,
      source: 'data',
      intent: 'surprise_warm_user',
      suggestions: ['Why did high-engagement users not convert?', 'What does a typical buyer journey look like?', 'How many high-engagement users do we have?'],
      webSearchUrl: null,
    };
  }
  if (ai.total_sessions > 0) {
    return {
      answer:
        `A surprising channel is **AI assistant referral traffic**: ChatGPT/AI sources sent **${fmtInt(ai.total_sessions)} sessions** ` +
        `(${fmtPct(ai.site_share)} of site traffic) with **${fmtPct(ai.weighted_bounce_rate)} weighted bounce**. ` +
        `That means people or AI crawlers are discovering Leapfrog content through answer engines, not just search.${seeAlso('sources')}`,
      source: 'data',
      intent: 'surprise_ai_sources',
      suggestions: ['How many sessions came from ChatGPT?', 'Which pages are AI assistants reading?', 'What should we do with AI traffic?'],
      webSearchUrl: null,
    };
  }
  if (bots.bot_sessions > 0) {
    return {
      answer:
        `The biggest hidden issue is traffic quality: **${fmtInt(bots.bot_sessions)} sessions** are confirmed/likely bot traffic, ` +
        `or **${fmtPct(bots.bot_share)}** of all sessions. Reported bounce is **${fmtPct(bots.reported_bounce)}**; the clean estimate is about **${fmtPct(bots.clean_bounce)}** after isolating human sessions.${seeAlso('bots')}`,
      source: 'data',
      intent: 'surprise_bots',
      suggestions: ['Which cities should we filter out?', 'How do we set up GA4 filters to remove bots?'],
      webSearchUrl: null,
    };
  }
  if (anomalies.length) {
    const a = anomalies[0];
    return {
      answer:
        `The most unusual trend is **${a.month || monthLabel(a.month_number)} ${a.metric || 'activity'}**: ` +
        `${a.direction || 'movement'} at ${/rate|bounce/i.test(a.metric || '') ? fmtPct(a.value) : fmtInt(a.value)}. ` +
        `Use it to compare campaigns, landing pages, and source mix for that month.${seeAlso('overview')}`,
      source: 'data',
      intent: 'surprise_anomaly',
      suggestions: ['Show me anomalies', 'Why does Q4 have the worst bounce rates?'],
      webSearchUrl: null,
    };
  }
  return {
    answer:
      `${insight?.title ? `The strongest finding is **${insight.title}**. ${insight.evidence || insight.description || ''}` : `The strongest pattern is your overall bounce and source quality mix.`}${seeAlso('insights')}`,
    source: 'data',
    intent: 'surprise_insight',
    suggestions: ['Show me top insights', 'Which recommendation has the biggest impact?', 'What should we prioritize first?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: assignment objectives and target math
// ---------------------------------------------------------------------------

function intentObjectives(q) {
  return (
    any(q, ['objective', 'target', 'december 2026', 'by december', '20% bounce', '20 percent bounce', '50% conversion', '50 percent conversion', 'already met', 'biggest impact']) ||
    all(q, ['homepage', 'bounce']) ||
    all(q, ['cybersecurity', 'users']) ||
    all(q, ['total users', '2025']) ||
    all(q, ['contact form', 'submissions'])
  );
}

function answerObjectives(q, analyzed) {
  const s = analyzed?.summary || {};
  const pages = analyzed?.pages?.top_pages || [];
  const homepage = pages.find((p) => pageName(p) === '/') || findByName(pages, 'page', ['homepage', 'home']);
  const cyberPages = filterByNames(pages, 'page', ['cybersecurity', 'cyber-security', 'cyber security']);
  const cyberSessions = cyberPages.reduce((acc, p) => acc + num(p.sessions), 0);
  const cyberUsers = cyberPages.reduce((acc, p) => acc + num(p.total_users || p.users), 0);
  const contacts = num(s.total_contact_submissions || analyzed?.contacts_summary?.total);
  const clean = cleanTrafficEstimate(analyzed);

  if (any(q, ['biggest impact'])) {
    const rec = analyzed?.bounce?.benchmark?.recommendations?.[0];
    return {
      answer:
        rec
          ? `The biggest bounce-rate lever is **${rec.title}**.\n\n${rec.body || rec.detail || rec.description || rec.evidence || ''}\n\nRecommendation: start there because it combines volume with fixable engagement loss.${seeAlso('bounce')}`
          : `I do not see a ranked bounce recommendation in this upload. Start with the highest-volume page or channel whose bounce rate is above the site average.${seeAlso('bounce')}`,
      source: 'data',
      intent: 'objective_biggest_impact',
      suggestions: ['Can we hit the 20% bounce rate reduction?', 'Which pages bleed visitors?', 'How much of our traffic is bots?'],
      webSearchUrl: null,
    };
  }

  if (all(q, ['homepage', 'bounce'])) {
    if (!homepage) {
      return {
        answer: `I do not see a homepage row in Page Path data. Open ${routeLink('pages')} and confirm the homepage path is represented as \`/\` or a homepage URL.`,
        source: 'data',
        intent: 'objective_homepage_missing',
        suggestions: ['What are our top 10 pages by traffic?', 'Which pages have the lowest bounce rates?'],
        webSearchUrl: null,
      };
    }
    return {
      answer:
        `The **reported homepage bounce rate** is **${fmtPct(homepage.bounce_rate)}** across **${fmtInt(homepage.sessions)} sessions**.\n\n` +
        `Context: sitewide reported bounce is **${fmtPct(clean.reported_bounce)}**; after isolating human sessions, the estimated clean site bounce is about **${fmtPct(clean.clean_bounce)}**. ` +
        `For the homepage specifically, use the reported page rate unless the Bot Traffic page shows bots concentrated on \`/\`.${seeAlso('bounce')}`,
      source: 'data',
      intent: 'objective_homepage_bounce',
      suggestions: ['Can we hit the 20% bounce rate reduction?', 'Which recommendation has the biggest impact on bounce rate?', 'How is the homepage performing?'],
      webSearchUrl: null,
    };
  }

  if (all(q, ['cybersecurity', 'users'])) {
    return {
      answer:
        cyberSessions > 0
          ? `Cybersecurity-related pages generated **${fmtInt(cyberUsers || cyberSessions)} ${cyberUsers ? 'users' : 'sessions'}** across **${fmtInt(cyberSessions)} sessions** in the loaded data.\n\n` +
            `Recommendation: simplify the path to **/cybersecurity/**, add internal links from high-traffic cyber/blog pages, and test a targeted campaign that lands directly on the service page.${seeAlso('pages')}`
          : `I do not see a cybersecurity page in the Page Path data. If it exists under a different URL, ask with that path (for example, "/managed-cybersecurity/").${seeAlso('pages')}`,
      source: 'data',
      intent: 'objective_cybersecurity_users',
      suggestions: ['Which pages should we add CTAs to?', 'What are our top 10 pages by traffic?', 'How does the cybercrime lingo blog perform?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['contact form submissions']) || all(q, ['contact', 'submissions'])) {
    return {
      answer:
        `The dashboard counted **${fmtInt(contacts)} contact-form submissions**. ` +
        `That is the baseline for the conversion objective; a **50% increase** means a target of **${fmtInt(conversionLiftTarget(contacts))} submissions** for the comparable future period.${seeAlso('contact')}`,
      source: 'data',
      intent: 'objective_contact_submissions',
      suggestions: ['How many contact form submissions were genuine leads?', 'What types of inquiries are we getting?', 'What should we change about the contact form?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['50% conversion', '50 percent conversion'])) {
    return {
      answer:
        `The current contact-form baseline is **${fmtInt(contacts)} submissions**. ` +
        `A 50% lift equals **${fmtInt(conversionLiftTarget(contacts))} submissions**, or **${fmtInt(conversionLiftTarget(contacts) - contacts)} more** than the current period.${seeAlso('contact')}`,
      source: 'data',
      intent: 'objective_conversion_target',
      suggestions: ['How many were genuine leads?', 'What should we change about the contact form?', 'What percentage of sessions reach the contact page?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['20% bounce', '20 percent bounce', 'bounce rate reduction', 'already met'])) {
    const target = bounceReductionTarget(clean.reported_bounce);
    const cleanMeets = clean.clean_bounce <= target;
    return {
      answer:
        `A 20% reduction from the reported site bounce rate of **${fmtPct(clean.reported_bounce)}** sets a target of **${fmtPct(target)}**.\n\n` +
        bullet([
          `Reported rate today: **${fmtPct(clean.reported_bounce)}**`,
          `Estimated clean rate after human-session isolation: **${fmtPct(clean.clean_bounce)}**`,
          cleanMeets
            ? `The objective is **effectively met after bot filtering**, but GA4 should still be cleaned so the official report reflects it.`
            : `The clean estimate is still above target by **${((clean.clean_bounce - target) * 100).toFixed(1)} points**.`,
          `Best lever: fix the highest-volume channel/page recommendation on ${routeLink('bounce')}.`,
        ]),
      source: 'data',
      intent: 'objective_bounce_target',
      suggestions: ['Which recommendation has the biggest impact?', 'How much of our traffic is bots?', 'Which pages bleed visitors?'],
      webSearchUrl: null,
    };
  }

  const growthTarget = Math.ceil(num(s.total_users) * 1.2);
  return {
    answer:
      `For the loaded **${s.report_year || 'reporting year'}** dataset, the dashboard shows **${fmtInt(s.total_users)} total users** and **${fmtInt(s.total_sessions)} sessions**.\n\n` +
      `If the December 2026 goal is a conservative 20% user lift, the target is **${fmtInt(growthTarget)} users**. ` +
      `Use this as a planning target unless your assignment rubric specifies a different growth percentage.${seeAlso('overview')}`,
    source: 'data',
    intent: 'objective_total_users_target',
    suggestions: ['How many real human users visited?', 'What should we prioritize first?', 'How many more cybersecurity page users do we need?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: data quality, bots, direct traffic, filters
// ---------------------------------------------------------------------------

function intentDataQuality(q) {
  return (
    any(q, ['lanzhou', 'jbcf', 'zf zcf', 'zfzcfefuvc', 'datacenter', 'data center', 'filter out', 'ga4 filters', 'remove bots', 'real bounce rate', 'clean bounce', 'reported and clean', 'after removing bot']) ||
    all(q, ['direct', 'made up']) ||
    all(q, ['direct', 'bounce']) ||
    all(q, ['q4', 'bounce'])
  );
}

function answerDataQuality(q, analyzed) {
  const clean = cleanTrafficEstimate(analyzed);
  const cities = analyzed?.bots?.cities || analyzed?.cities || [];
  const sources = analyzed?.bots?.sources || analyzed?.sources || [];
  const direct = findByName(analyzed?.sources || [], 'source', ['direct']);

  if (any(q, ['lanzhou'])) {
    const city = findByName(cities, 'city', ['lanzhou']);
    return {
      answer:
        `Lanzhou appears because it is on this dashboard's known datacenter-city watchlist. ` +
        (city
          ? `In your data it accounts for **${fmtInt(city.sessions)} sessions** and is classified as **${String(city.bot_classification || 'suspicious').replace('_', ' ')}**.`
          : `It is not present in the current classified city rows, but it remains a known bot-risk location.`) +
        `${seeAlso('bots')}`,
      source: 'data',
      intent: 'data_quality_lanzhou',
      suggestions: ['What are the datacenter cities in our data?', 'Which cities should we filter out?', 'How do we set up GA4 filters to remove bots?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['jbcf', 'zfzcfefuvc'])) {
    const source = findByName(sources, 'source', KNOWN_SPAM_SOURCES);
    return {
      answer:
        `**JBCF Zfzcfefuvc** is treated as a known spam/source-quality signature. ` +
        (source
          ? `It appears in your data with **${fmtInt(source.sessions)} sessions**, **${fmtPct(source.bounce_rate)} bounce**, and classification **${String(source.bot_classification || 'suspicious').replace('_', ' ')}**.`
          : `It is in the spam-source list, but I do not see it in the current source rows.`) +
        ` Do not use it for marketing-performance conclusions.${seeAlso('bots')}`,
      source: 'data',
      intent: 'data_quality_spam_source',
      suggestions: ['Which sources should I block?', 'How much of our traffic is bots?', 'What is direct traffic actually made up of?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['datacenter', 'data center', 'filter out', 'cities'])) {
    const flagged = cities
      .filter((c) => KNOWN_DATACENTER_CITIES.map(normalizeName).includes(normalizeName(c.city || c.City)) || num(c.bot_score) >= 4)
      .slice(0, 8);
    return {
      answer:
        `Datacenter cities matter because they often represent crawlers, cloud-hosted scripts, VPNs, or automated monitoring rather than buyers.\n\n` +
        (flagged.length
          ? table(['City', 'Sessions', 'Bounce', 'Class'], flagged.map((c) => [c.city || c.City, fmtInt(c.sessions), fmtPct(c.bounce_rate), c.bot_classification || 'watch']))
          : `I do not see major datacenter-city rows in this upload.`) +
        `\n\nStart with confirmed/likely bot cities before filtering suspicious cities; suspicious can include privacy-heavy humans.${seeAlso('bots')}`,
      source: 'data',
      intent: 'data_quality_datacenter_cities',
      suggestions: ['Why is Lanzhou showing up?', 'How much of our traffic is bots?', 'How do we set up GA4 filters to remove bots?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['ga4 filters', 'remove bots'])) {
    return {
      answer:
        `Set up GA4 cleanup in layers:\n\n` +
        bullet([
          `Create an **internal/developer traffic** rule for known office/test IPs.`,
          `Build **audiences or comparisons** for suspicious city/source patterns before permanently excluding them.`,
          `Use UTM hygiene so direct traffic is not hiding email, partner, or paid clicks.`,
          `Block obvious spam referrers like **${KNOWN_SPAM_SOURCES.join(', ')}** where they recur.`,
          `Keep the dashboard's ${routeLink('bots')} table as the audit list for what to exclude.`,
        ]),
      source: 'data',
      intent: 'data_quality_ga4_filters',
      suggestions: ['Which cities should we filter out?', 'What is JBCF Zfzcfefuvc?', 'What is the real bounce rate after removing bot traffic?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['direct'])) {
    return {
      answer:
        `Direct traffic is a mixed bucket: typed/bookmarked visits, untagged emails, PDFs, dark social, app links, privacy-stripped referrers, and sometimes bot traffic.\n\n` +
        bullet([
          direct ? `Current direct sessions: **${fmtInt(direct.sessions)}**` : `Current direct sessions from summary: **${fmtInt(analyzed?.summary?.direct_sessions)}**`,
          direct ? `Direct bounce: **${fmtPct(direct.bounce_rate)}**` : `Direct bounce: **${fmtPct(analyzed?.summary?.direct_bounce_rate)}**`,
          `High direct bounce usually points to untagged campaigns, stale URLs, or low-intent automated traffic.`,
          `Recommendation: enforce UTMs on email, LinkedIn, partner links, and PDFs so direct becomes smaller and more interpretable.`,
        ]) +
        seeAlso('sources'),
      source: 'data',
      intent: 'data_quality_direct',
      suggestions: ['Why is the new user rate so high in direct traffic?', 'How does organic compare to direct traffic?', 'Are bots inflating direct traffic?'],
      webSearchUrl: null,
    };
  }

  if (all(q, ['q4', 'bounce'])) {
    const q4 = (analyzed?.monthly || []).filter((m) => [10, 11, 12].includes(num(m.Month || m.month_num || m.month)));
    const avg = q4.length ? q4.reduce((acc, m) => acc + num(m.bounce_rate), 0) / q4.length : 0;
    return {
      answer:
        q4.length
          ? `Q4 averaged **${fmtPct(avg)} bounce** across October-December. The usual suspects are campaign mix shifts, holiday low-intent research, recruiting traffic, and bot/referrer spikes.\n\n${table(['Month', 'Sessions', 'Bounce'], q4.map((m) => [monthlyLabel(m), fmtInt(m.sessions), fmtPct(m.bounce_rate)]))}${seeAlso('bounce')}`
          : `I do not have month-level Q4 rows in this upload.${seeAlso('overview')}`,
      source: 'data',
      intent: 'data_quality_q4_bounce',
      suggestions: ['Show me monthly anomalies', 'Are bots driving the spikes?', 'Which sources changed in Q4?'],
      webSearchUrl: null,
    };
  }

  return {
    answer:
      `Reported site bounce is **${fmtPct(clean.reported_bounce)}**. After isolating confirmed-human sessions, the estimated clean bounce is about **${fmtPct(clean.clean_bounce)}**.\n\n` +
      bullet([
        `Confirmed bot sessions: **${fmtInt(clean.confirmed_bot_sessions)}**`,
        `Likely bot sessions: **${fmtInt(clean.likely_bot_sessions)}**`,
        `Suspicious sessions: **${fmtInt(clean.suspicious_sessions)}**`,
        `Bot/likely-bot share: **${fmtPct(clean.bot_share)}**`,
      ]) +
      seeAlso('bots'),
    source: 'data',
    intent: 'data_quality_clean_bounce',
    suggestions: ['Which cities should we filter out?', 'How do we set up GA4 filters to remove bots?', 'Is the bounce rate objective already met after bot filtering?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: source/channel performance and why questions
// ---------------------------------------------------------------------------

function intentChannelPerformance(q) {
  return (
    any(q, ['linkedin', 'clutch', 'chatgpt', 'hubspot', 'email channel', 'referral traffic', 'organic compare', 'organic vs direct', 'fastest growing', 'best engagement', 'source growing', 'mobile vs desktop']) ||
    all(q, ['which', 'channel', 'best']) ||
    all(q, ['traffic', 'quality'])
  );
}

function answerChannelPerformance(q, analyzed) {
  const sources = analyzed?.sources || [];
  const devices = analyzed?.devices || [];
  const total = num(analyzed?.summary?.total_sessions);

  if (any(q, ['chatgpt'])) {
    const ai = summarizeAiSources(sources, total);
    const chatgpt = ai.matches.filter((m) => /chatgpt|openai/i.test(m.source || m.assistant));
    const sessions = chatgpt.reduce((acc, m) => acc + num(m.sessions), 0);
    return {
      answer:
        sessions
          ? `ChatGPT/OpenAI sources sent **${fmtInt(sessions)} sessions**. Across all detected AI assistants, you have **${fmtInt(ai.total_sessions)} sessions** (${fmtPct(ai.site_share)} of traffic) with **${fmtPct(ai.weighted_bounce_rate)} weighted bounce**.${seeAlso('sources')}`
          : `I do not see ChatGPT/OpenAI as a source in this upload. The Traffic Sources page still tracks AI assistant referrals when they appear.${seeAlso('sources')}`,
      source: 'data',
      intent: 'channel_chatgpt',
      suggestions: ['Which pages are AI assistants reading?', 'What percentage of traffic comes from mobile vs desktop?', 'Which source has the best engagement?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['mobile vs desktop'])) {
    const rows = ['mobile', 'desktop'].map((name) => findByName(devices, 'device', [name])).filter(Boolean);
    return {
      answer:
        rows.length
          ? `**Mobile vs desktop:**\n\n${table(['Device', 'Sessions', 'Share', 'Bounce', 'Engagement'], rows.map((d) => [d.device || d.Device, fmtInt(d.sessions), fmtPct(pct(d.sessions, total)), fmtPct(d.bounce_rate), fmtPct(d.engagement_rate)]))}${seeAlso('sources')}`
          : `I do not see both mobile and desktop device rows in this upload.${seeAlso('sources')}`,
      source: 'data',
      intent: 'channel_mobile_desktop',
      suggestions: ['Which traffic channel has the best engagement?', 'How does organic compare to direct traffic?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['organic vs direct', 'organic compare'])) {
    const organic = findByName(sources, 'source', ['google', 'bing', 'organic']);
    const direct = findByName(sources, 'source', ['direct']);
    const rows = [organic, direct].filter(Boolean);
    return {
      answer:
        rows.length
          ? `**Organic vs direct:**\n\n${table(['Source', 'Sessions', 'Bounce', 'Engagement'], rows.map((r) => [sourceName(r), fmtInt(r.sessions), fmtPct(r.bounce_rate), fmtPct(r.engagement_rate)]))}\n\nOrganic usually reflects search intent; direct is a mixed bucket that needs UTM cleanup.${seeAlso('sources')}`
          : `I could not find enough source rows to compare organic and direct.${seeAlso('sources')}`,
      source: 'data',
      intent: 'channel_organic_direct',
      suggestions: ['What is direct traffic actually made up of?', 'Why does direct traffic have a high bounce rate?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['email', 'hubspot'])) {
    const email = sources.filter((s) => /email|hubspot/i.test(sourceName(s)) || /email|hubspot/i.test(String(s.medium || s.Medium || '')));
    return {
      answer:
        email.length
          ? `**Email / HubSpot performance:**\n\n${table(['Source', 'Sessions', 'Bounce', 'Engagement'], email.slice(0, 8).map((r) => [sourceName(r), fmtInt(r.sessions), fmtPct(r.bounce_rate), fmtPct(r.engagement_rate)]))}\n\nIf HubSpot bounce is worse than other email, tighten UTMs and send clicks to topic-specific landing pages instead of the homepage.${seeAlso('sources')}`
          : `I do not see email or HubSpot rows in the current source data.${seeAlso('sources')}`,
      source: 'data',
      intent: 'channel_email',
      suggestions: ['How does organic compare to direct traffic?', 'Which channel has the best engagement?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['linkedin', 'clutch', 'referral'])) {
    const names = q.includes('linkedin') ? ['linkedin'] : q.includes('clutch') ? ['clutch'] : ['referral'];
    const matches = sources.filter((s) => names.some((name) => normalizeName(sourceName(s)).includes(name) || normalizeName(s.medium || s.Medium).includes(name)));
    return {
      answer:
        matches.length
          ? `${q.includes('linkedin') ? `LinkedIn often bounces when posts send broad audiences to the homepage instead of a topic-matched landing page.` : q.includes('clutch') ? `Clutch.co traffic is usually bottom-funnel referral traffic, so a low bounce rate is a strong trust-signal indicator.` : `Referral traffic quality depends on fit between referring context and landing page.`}\n\n${table(['Source', 'Sessions', 'Bounce', 'Engagement'], matches.slice(0, 6).map((r) => [sourceName(r), fmtInt(r.sessions), fmtPct(r.bounce_rate), fmtPct(r.engagement_rate)]))}${seeAlso('sources')}`
          : `I do not see a matching ${names[0]} source row in the current upload.${seeAlso('sources')}`,
      source: 'data',
      intent: 'channel_named_source',
      suggestions: ['Which source has the best engagement?', 'What should we prioritize first?', 'Which pages should social traffic land on?'],
      webSearchUrl: null,
    };
  }

  const ranked = sortBy(sources.filter((s) => num(s.sessions) >= 10), 'engagement_rate').slice(0, 8);
  return {
    answer:
      ranked.length
        ? `**Best engagement by source:**\n\n${table(['Source', 'Sessions', 'Engagement', 'Bounce'], ranked.map((r) => [sourceName(r), fmtInt(r.sessions), fmtPct(r.engagement_rate), fmtPct(r.bounce_rate)]))}\n\nPrioritize sources with both meaningful volume and above-average engagement.${seeAlso('sources')}`
        : `I do not see enough source rows to rank channel engagement.${seeAlso('sources')}`,
    source: 'data',
    intent: 'channel_best_engagement',
    suggestions: ['How does organic compare to direct traffic?', 'What is our email channel performance?', 'How many sessions came from ChatGPT?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: page/content performance
// ---------------------------------------------------------------------------

function intentPageContent(q) {
  return (
    any(q, ['lowest bounce', 'add ctas', 'add cta', 'leadership', 'ceo page', 'blog posts', 'job seekers', 'methodology page', 'cybercrime lingo', 'top 10 pages']) ||
    all(q, ['which', 'pages', 'cta'])
  );
}

function answerPageContent(q, analyzed) {
  const pages = analyzed?.pages?.top_pages || [];
  if (any(q, ['lowest bounce'])) {
    const rows = sortBy(pages.filter((p) => num(p.sessions) >= 25), 'bounce_rate', 'asc').slice(0, 8);
    return {
      answer:
        rows.length
          ? `**Lowest-bounce pages with meaningful traffic:**\n\n${table(['Page', 'Sessions', 'Bounce'], rows.map((p) => [pageName(p), fmtInt(p.sessions), fmtPct(p.bounce_rate)]))}\n\nUse these as templates for CTA placement, internal links, and above-the-fold messaging.${seeAlso('unicorns')}`
          : `I do not see enough page rows to rank low-bounce pages.${seeAlso('pages')}`,
      source: 'data',
      intent: 'page_lowest_bounce',
      suggestions: ['What are unicorn pages?', 'Which pages should we add CTAs to?', 'Which pages have the highest bounce rates?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['add cta', 'add ctas', 'cta'])) {
    const rows = pages
      .filter((p) => num(p.sessions) >= 50 && num(p.bounce_rate) <= 0.55 && !/contact|thank|privacy|careers|job/i.test(pageName(p)))
      .slice(0, 8);
    return {
      answer:
        rows.length
          ? `Add or strengthen CTAs on pages with real traffic and tolerable engagement:\n\n${table(['Page', 'Sessions', 'Bounce'], rows.map((p) => [pageName(p), fmtInt(p.sessions), fmtPct(p.bounce_rate)]))}\n\nRecommendation: use a contextual CTA, not just "Contact us" - e.g., cybersecurity assessment, MSP consultation, or manufacturing IT checklist.${seeAlso('pages')}`
          : `I do not see obvious CTA candidates in the current page data.${seeAlso('pages')}`,
      source: 'data',
      intent: 'page_cta_candidates',
      suggestions: ['How does the methodology page perform?', 'What pages are job seekers visiting?', 'Which blog posts have the highest bounce rates?'],
      webSearchUrl: null,
    };
  }

  const names = [];
  if (any(q, ['leadership'])) names.push('leadership', 'team');
  if (any(q, ['ceo'])) names.push('ceo', 'chief executive');
  if (any(q, ['methodology'])) names.push('methodology');
  if (any(q, ['job seekers'])) names.push('careers', 'jobs', 'career');
  if (any(q, ['cybercrime lingo'])) names.push('cybercrime', 'lingo');
  if (any(q, ['blog posts'])) names.push('blog');
  const matches = names.length ? filterByNames(pages, 'page', names).slice(0, 8) : [];
  if (matches.length) {
    return {
      answer:
        `Here are the matching page rows:\n\n${table(['Page', 'Sessions', 'Bounce', 'Engagement'], matches.map((p) => [pageName(p), fmtInt(p.sessions), fmtPct(p.bounce_rate), fmtPct(p.engagement_rate)]))}\n\n` +
        `Why it matters: these pages reveal intent. Leadership/CEO traffic is trust-building, methodology traffic is evaluation-stage, job traffic is recruiting noise, and blog traffic should feed internal links to service pages.${seeAlso('pages')}`,
      source: 'data',
      intent: 'page_named_content',
      suggestions: ['Which pages should we add CTAs to?', 'What are unicorn pages?', 'Which pages bleed visitors?'],
      webSearchUrl: null,
    };
  }

  return answerTopPages('top 10 pages', analyzed);
}

// ---------------------------------------------------------------------------
// Intent: user behavior and personas
// ---------------------------------------------------------------------------

function intentUserBehavior(q) {
  return (
    any(q, ['real human users', 'human users', 'high-engagement users', 'high engagement users', 'buyer journey', 'didn\'t any high-engagement', 'did not any high-engagement', 'best users', 'more than 3 months', 'personas', 'deep researcher', 'intensive evaluator', 'confirmed bots']) ||
    /user\s+\d/.test(q)
  );
}

function answerUserBehavior(q, analyzed) {
  const users = analyzed?.users || [];
  const sum = analyzed?.users_summary || {};
  const warm = pickWarmProspects(users, 8);

  if (/user\s+\d/.test(q)) {
    const idPart = q.match(/user\s+([0-9a-z.\-_]+)/i)?.[1];
    const found = users.find((u) => String(u.user_id || '').toLowerCase().includes(String(idPart || '').toLowerCase()));
    return {
      answer:
        found
          ? `**User ${found.user_id}** matters because it represents a traceable journey:\n\n${bullet([
              `Type: **${found.id_type || 'Unknown'}**`,
              `Persona: **${found.persona || 'Unassigned'}**`,
              `Sessions: **${fmtInt(found.total_sessions)}**`,
              `Engagement: **${fmtPct(found.engagement_rate)}**`,
              `Avg duration: **${num(found.avg_session_duration).toFixed(1)}s**`,
              `Months active: **${fmtInt(found.months_active)}**`,
              `Classification: **${String(found.bot_classification || 'unknown').replace('_', ' ')}**`,
            ])}${seeAlso('users')}`
          : `I could not find that exact user ID in the current user table. Try asking with a longer prefix from the User ID Engagement table.${seeAlso('users')}`,
      source: 'data',
      intent: 'user_specific_lookup',
      suggestions: ['How many high-engagement users do we have?', 'What does a typical buyer journey look like?', 'What are the user personas?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['personas', 'deep researcher', 'intensive evaluator'])) {
    const counts = {};
    for (const u of users) counts[u.persona || 'Unassigned'] = (counts[u.persona || 'Unassigned'] || 0) + 1;
    const rows = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 8);
    return {
      answer:
        `Personas are assigned from behavioral intensity: session count, engagement rate, average duration, and months active.\n\n` +
        (rows.length ? table(['Persona', 'Users'], rows.map(([k, v]) => [k, fmtInt(v)])) : `No persona rows are available.`) +
        `\n\nA **Deep Researcher** usually shows broad, repeated evaluation behavior. An **Intensive Evaluator** is more concentrated but highly engaged.${seeAlso('users')}`,
      source: 'data',
      intent: 'user_personas',
      suggestions: ['How many high-engagement users do we have?', 'What does a typical buyer journey look like?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['real human users', 'human users'])) {
    return {
      answer:
        `The clean human audience is **${fmtInt(sum.clean_human || users.filter((u) => u.bot_classification === 'human').length)} user IDs** out of **${fmtInt(sum.total_ids || users.length)} total IDs**.\n\n` +
        `This excludes confirmed/likely bots and separates fractional/cross-device identity artifacts so the audience count is closer to real human behavior.${seeAlso('users')}`,
      source: 'data',
      intent: 'user_real_humans',
      suggestions: ['How many user IDs are confirmed bots?', 'Who are my high-engagement users?', 'What are the personas?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['confirmed bots'])) {
    return {
      answer:
        `The user table flags **${fmtInt(sum.confirmed_bot)} confirmed-bot IDs** and **${fmtInt(sum.likely_bot)} likely-bot IDs**. ` +
        `The Bot Traffic page also reports **${fmtInt(analyzed?.bots?.summary?.bot_user_ids)} bot/likely-bot user IDs** from the bot summary.${seeAlso('bots')}`,
      source: 'data',
      intent: 'user_bot_ids',
      suggestions: ['How much of our traffic is bots?', 'What does the .2 suffix mean?', 'What is a Google Signals ID?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['more than 3 months'])) {
    const multi = users.filter((u) => num(u.months_active) > 3);
    return {
      answer:
        `**${fmtInt(multi.length)} user IDs** were active for more than 3 months. ` +
        `These are your best nurture/retargeting candidates because they show sustained research without necessarily converting.${seeAlso('users')}`,
      source: 'data',
      intent: 'user_multi_month',
      suggestions: ['What does a typical buyer journey look like?', 'Why did high-engagement users not convert?'],
      webSearchUrl: null,
    };
  }

  return {
    answer:
      `You have **${fmtInt(sum.high_engagement)} high-engagement user IDs**. ` +
      (warm.length
        ? `The warmest examples are:\n\n${table(['User', 'Persona', 'Sessions', 'Avg Duration'], warm.slice(0, 5).map((u) => [String(u.user_id || '').slice(0, 18), u.persona || '—', fmtInt(u.total_sessions), `${num(u.avg_session_duration).toFixed(1)}s`]))}\n\n`
        : `I do not see a warm-prospect shortlist after bot and identity-artifact filtering.\n\n`) +
      `If high-engagement users did not convert, the likely gap is CTA/pathing: researchers find useful content but are not being routed to a low-friction next step.${seeAlso('users')}`,
    source: 'data',
    intent: 'user_high_engagement',
    suggestions: ['Which pages should we add CTAs to?', 'How many users visited for more than 3 months?', 'What are the user personas?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: contact form and conversions
// ---------------------------------------------------------------------------

function intentContactConversion(q) {
  return (
    any(q, ['genuine leads', 'were spam', 'spam leads', 'types of inquiries', 'inquiries are we getting', 'months had the most contact', 'homepage to contact', 'sessions reach the contact', 'change about the contact form', 'conversion rate']) &&
    (any(q, ['contact', 'lead', 'form', 'conversion', 'sessions', 'inquiry', 'inquiries']) || any(q, ['were spam']))
  );
}

function answerContactConversion(q, analyzed) {
  const contacts = analyzed?.contacts || [];
  const cs = analyzed?.contacts_summary || {};
  const s = analyzed?.summary || {};
  const total = num(cs.total || s.total_contact_submissions || contacts.length);
  const genuine = num(cs.qualified || contacts.filter((c) => !/spam|vendor|job|career/i.test(c.lead_type || '')).length);
  const spam = num(cs.noise || contacts.filter((c) => /spam|vendor|job|career/i.test(c.lead_type || '')).length);

  if (any(q, ['genuine leads', 'were spam', 'spam leads'])) {
    return {
      answer:
        `The contact form produced **${fmtInt(total)} submissions**. Estimated lead quality:\n\n` +
        bullet([
          `Likely genuine/qualified: **${fmtInt(genuine)}**`,
          `Spam/noise/non-sales: **${fmtInt(spam)}**`,
          `Contact page sessions: **${fmtInt(s.contact_page_sessions)}** (${fmtPct(s.contact_session_share)} of total sessions)`,
        ]) +
        seeAlso('contact'),
      source: 'data',
      intent: 'contact_quality',
      suggestions: ['What types of inquiries are we getting?', 'Which months had the most contact form activity?', 'What should we change about the contact form?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['months had the most'])) {
    const counts = {};
    for (const c of contacts) {
      const d = c.conversion_date ? new Date(c.conversion_date) : null;
      const key = Number.isNaN(d?.getTime()) ? 'Unknown' : d.toLocaleString('en-US', { month: 'short' });
      counts[key] = (counts[key] || 0) + 1;
    }
    const rows = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 6);
    return {
      answer:
        rows.length
          ? `**Contact form activity by month:**\n\n${table(['Month', 'Submissions'], rows.map(([k, v]) => [k, fmtInt(v)]))}${seeAlso('contact')}`
          : `I do not see dated contact-form rows in this upload.${seeAlso('contact')}`,
      source: 'data',
      intent: 'contact_months',
      suggestions: ['How many were genuine leads?', 'What types of inquiries are we getting?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['types of inquiries'])) {
    const rows = Object.entries(cs.by_intent || {}).sort(([, a], [, b]) => b - a).slice(0, 8);
    return {
      answer:
        rows.length
          ? `**Inquiry types:**\n\n${table(['Intent', 'Submissions', 'Share'], rows.map(([k, v]) => [k, fmtInt(v), fmtPct(v / (total || 1))]))}${seeAlso('contact')}`
          : `I do not see classified inquiry types in this upload.${seeAlso('contact')}`,
      source: 'data',
      intent: 'contact_inquiry_types',
      suggestions: ['How many contact form submissions were genuine leads?', 'Which months had the most contact form activity?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['homepage to contact', 'sessions reach the contact', 'conversion rate'])) {
    const homepage = (analyzed?.pages?.top_pages || []).find((p) => pageName(p) === '/');
    return {
      answer:
        `The contact page received **${fmtInt(s.contact_page_sessions)} sessions**, or **${fmtPct(s.contact_session_share)} of total sessions**. ` +
        `The form produced **${fmtInt(total)} submissions**, so contact-page session-to-submission rate is approximately **${fmtPct(pct(total, s.contact_page_sessions))}**.\n\n` +
        (homepage ? `Homepage-to-contact reach proxy: /contact sessions are **${fmtPct(pct(s.contact_page_sessions, homepage.sessions))}** of homepage sessions. ` : '') +
        `Use this as a directional funnel metric unless GA4 event paths are uploaded.${seeAlso('contact')}`,
      source: 'data',
      intent: 'contact_conversion_rate',
      suggestions: ['What should we change about the contact form?', 'How many were genuine leads?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['change about the contact form'])) {
    return {
      answer:
        `Recommended contact-form changes:\n\n` +
        bullet([
          `Add a required **inquiry type** dropdown so sales leads, support, recruiting, vendors, and spam separate cleanly.`,
          `Route MSP/cybersecurity/CMMC/Microsoft 365 inquiries to BD within 24 hours.`,
          `Add a shorter service-specific CTA near high-traffic pages instead of relying only on a generic contact page.`,
          `Preserve UTM/source fields on submission so channel ROI is measurable.`,
        ]) +
        `\n\nCurrent baseline: **${fmtInt(total)} submissions**, **${fmtInt(genuine)} likely genuine**, **${fmtInt(spam)} noise/spam**.${seeAlso('contact')}`,
      source: 'data',
      intent: 'contact_recommendations',
      suggestions: ['What types of inquiries are we getting?', 'Which pages should we add CTAs to?'],
      webSearchUrl: null,
    };
  }

  return {
    answer:
      `The contact form produced **${fmtInt(total)} submissions**. Estimated lead quality:\n\n` +
      bullet([
        `Likely genuine/qualified: **${fmtInt(genuine)}**`,
        `Spam/noise/non-sales: **${fmtInt(spam)}**`,
        `Contact page sessions: **${fmtInt(s.contact_page_sessions)}** (${fmtPct(s.contact_session_share)} of total sessions)`,
      ]) +
      seeAlso('contact'),
    source: 'data',
    intent: 'contact_quality',
    suggestions: ['What types of inquiries are we getting?', 'Which months had the most contact form activity?', 'What should we change about the contact form?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Intent: competitive / strategic advisor
// ---------------------------------------------------------------------------

function intentStrategic(q) {
  return (
    any(q, ['competitors', 'trust signals', 'target market', 'manufacturing opportunity', 'social media connect', 'three-horizon', 'three horizon', 'prioritize first', 'seo, linkedin, or email', 'seo linkedin or email', 'explain this dashboard', 'explain the dashboard', 'to a client']) ||
    all(q, ['what', 'prioritize'])
  );
}

function answerStrategic(q, analyzed) {
  const s = analyzed?.summary || {};
  const bestSource = sortBy((analyzed?.sources || []).filter((x) => num(x.sessions) >= 25), 'engagement_rate')[0];
  const cyber = filterByNames(analyzed?.pages?.top_pages || [], 'page', ['cybersecurity', 'cyber security']);
  const rec = analyzed?.bounce?.benchmark?.recommendations?.[0];

  if (any(q, ['explain this dashboard', 'explain the dashboard', 'to a client'])) {
    const clean = cleanTrafficEstimate(analyzed);
    return {
      answer:
        `Client-ready explanation:\n\n` +
        bullet([
          `The dashboard turns uploaded GA4/Semrush exports into decision-ready views for traffic, bounce, pages, users, leads, and bot quality.`,
          `Reported site bounce is **${fmtPct(clean.reported_bounce)}**; estimated clean bounce after isolating human sessions is about **${fmtPct(clean.clean_bounce)}**.`,
          `It separates noisy traffic from likely buyer behavior, then points to specific pages, sources, and CTAs to improve.`,
          `The goal is not just reporting - it is prioritizing what Leapfrog should fix first.`,
        ]) +
        seeAlso('overview'),
      source: 'data',
      intent: 'strategy_client_explanation',
      suggestions: ['Tell me something I don’t know', 'What should we prioritize first?', 'How much of our traffic is bots?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['trust signals', 'competitors'])) {
    return {
      answer:
        `For Atlanta MSP competitors, the common above-the-fold trust signals are: client logos, certifications, response-time promises, cybersecurity/compliance proof, testimonials, and a clear primary CTA.\n\n` +
        `Leapfrog should emphasize those signals on the homepage and high-traffic service pages, then validate impact through bounce and contact-page reach.${seeAlso('bounce')}`,
      source: 'data',
      intent: 'strategy_trust_signals',
      suggestions: ['Which pages should we add CTAs to?', 'How does our bounce rate compare to B2B benchmarks?', 'What should we prioritize first?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['manufacturing'])) {
    return {
      answer:
        `Manufacturing is a strong expansion angle for Leapfrog because it pairs MSP needs with cybersecurity, uptime, compliance, and operational continuity. ` +
        (cyber.length
          ? `Your cybersecurity pages currently show **${fmtInt(cyber.reduce((acc, p) => acc + num(p.sessions), 0))} sessions**, so there is room to make that path easier to find.`
          : `I do not see a strong cybersecurity page footprint in the current page data, which suggests an opportunity to build it.`) +
        `\n\nRecommendation: create a manufacturing IT/cybersecurity landing page, link it from high-traffic blogs, and test LinkedIn/Google campaigns to that page instead of the homepage.${seeAlso('pages')}`,
      source: 'data',
      intent: 'strategy_manufacturing',
      suggestions: ['How many cybersecurity page users do we need?', 'Which pages should we add CTAs to?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['three-horizon', 'three horizon'])) {
    return {
      answer:
        `A practical three-horizon strategy:\n\n` +
        bullet([
          `**Horizon 1: Clean measurement.** Filter bots, fix UTMs, and establish reported vs clean KPI baselines.`,
          `**Horizon 2: Improve conversion paths.** Add CTAs/internal links on high-traffic pages and tighten the contact form.`,
          `**Horizon 3: Expand demand.** Build manufacturing/cybersecurity landing pages and scale the channels with the best engagement.`,
        ]) +
        seeAlso('insights'),
      source: 'data',
      intent: 'strategy_three_horizon',
      suggestions: ['What should we prioritize first?', 'What is the manufacturing opportunity?', 'Which recommendation has the biggest impact?'],
      webSearchUrl: null,
    };
  }

  if (any(q, ['social media'])) {
    return {
      answer:
        `Social performance connects to website performance through landing-page fit. If LinkedIn/social posts send broad audiences to the homepage, bounce rises; if they send people to the exact article/service referenced, engagement improves.\n\n` +
        `Measure it by tagging social links with UTMs and comparing social-source bounce, engagement, and contact-page reach on ${routeLink('sources')}.`,
      source: 'data',
      intent: 'strategy_social',
      suggestions: ['Why does LinkedIn have a high bounce rate?', 'Which pages should social traffic land on?'],
      webSearchUrl: null,
    };
  }

  return {
    answer:
      `Prioritize in this order:\n\n` +
      bullet([
        `**1. Measurement cleanup** - bot filtering and UTM discipline, because reported bounce is **${fmtPct(s.site_bounce_rate)}** and noisy traffic can distort every objective.`,
        rec ? `**2. Highest-impact bounce lever** - ${rec.title}. ${rec.body || rec.detail || rec.description || ''}` : `**2. Bounce/page fixes** - start with the highest-volume high-bounce page or channel.`,
        bestSource ? `**3. Scale what is already working** - ${sourceName(bestSource)} has **${fmtPct(bestSource.engagement_rate)} engagement** on **${fmtInt(bestSource.sessions)} sessions**.` : `**3. Scale proven channels** once source quality is clear.`,
        `**4. Expand strategically** - build cybersecurity/manufacturing content and route LinkedIn/email/SEO traffic to topic-specific pages.`,
      ]) +
      seeAlso('insights'),
    source: 'data',
    intent: 'strategy_prioritize',
    suggestions: ['What is the three-horizon expansion strategy?', 'What trust signals are we missing above the fold?', 'What is the manufacturing opportunity?'],
    webSearchUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

const HANDLERS = [
  // Order matters — most specific patterns first.
  { match: intentGreeting, run: answerGreeting },
  { match: intentCapabilities, run: answerCapabilities },
  { match: intentDashboardHowTo, run: answerDashboardHowTo },
  { match: intentAccuracy, run: answerAccuracy },
  // Definitions before "users" / "sessions" so "what is bounce rate" wins.
  { match: intentDefinition, run: answerDefinition, withMatch: true },
  { match: intentMethodology, run: answerMethodology },
  { match: intentSurprise, run: answerSurprise },
  { match: intentContactConversion, run: answerContactConversion },
  { match: intentObjectives, run: answerObjectives },
  { match: intentDataQuality, run: answerDataQuality },
  { match: intentUserBehavior, run: answerUserBehavior },
  { match: intentChannelPerformance, run: answerChannelPerformance },
  { match: intentPageContent, run: answerPageContent },
  { match: intentStrategic, run: answerStrategic },
  { match: intentImprove, run: answerImprove },
  // Entity lookups go BEFORE category handlers so "how is google performing?"
  // hits the source-lookup, not the bounce-by-channel handler.
  { match: intentPageLookup, run: answerPageLookup, withMatch: true, needsAnalyzed: true },
  { match: intentSourceLookup, run: answerSourceLookup, withMatch: true, needsAnalyzed: true },
  { match: intentMonthLookup, run: answerMonthLookup, withMatch: true, needsAnalyzed: true },
  // Anomalies must beat the generic "month" handler.
  { match: intentAnomalies, run: answerAnomalies },
  { match: intentBounce, run: answerBounce },
  { match: intentBots, run: answerBots },
  { match: intentContacts, run: answerContacts },
  { match: intentUnicorns, run: answerUnicorns },
  { match: intentProblemPages, run: answerProblemPages },
  { match: intentTopPages, run: answerTopPages },
  { match: intentTopSources, run: answerTopSources },
  { match: intentDevices, run: answerDevices },
  { match: intentCities, run: answerCities },
  { match: intentMonth, run: answerMonth },
  { match: intentInsights, run: answerInsights },
  { match: intentSessions, run: answerSessions },
  { match: intentUsers, run: answerUsers },
  { match: intentSummary, run: answerSummary },
  { match: intentCompare, run: answerCompare },
];

export function answerQuestion(analyzed, rawQuestion) {
  const question = String(rawQuestion || '').trim();
  if (!question) {
    return {
      answer: `Ask me anything about your uploaded analytics data.`,
      source: 'data',
      suggestions: defaultSuggestions(),
      webSearchUrl: null,
      intent: 'empty',
    };
  }

  // Empty-data path: only allow capability/help questions.
  if (!analyzed || !analyzed.summary) {
    const q = normalize(question);
    const definition = intentDefinition(q);
    if (intentDashboardHowTo(q)) return answerDashboardHowTo(q, analyzed);
    if (definition) return answerDefinition(q, analyzed, definition);
    if (intentMethodology(q)) return answerMethodology(q, analyzed);
    if (intentCapabilities(q) || intentGreeting(q)) {
      return {
        ...emptyDataResponse(),
        ...(intentGreeting(q)
          ? { answer: `Hey! ${emptyDataResponse().answer}` }
          : {}),
      };
    }
    return emptyDataResponse();
  }

  const q = normalize(question);

  for (const handler of HANDLERS) {
    const matchResult = handler.needsAnalyzed
      ? handler.match(q, analyzed)
      : handler.match(q);
    if (matchResult) {
      const result = handler.withMatch
        ? handler.run(q, analyzed, matchResult)
        : handler.run(q, analyzed);
      if (result) return result;
    }
  }

  return webFallback(question);
}

export { defaultSuggestions };
