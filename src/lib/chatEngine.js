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

import { MONTH_NAMES } from './skillConfig.js';

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
    'What are my top traffic sources?',
    'Which pages have the highest bounce rate?',
    'How does my bounce rate compare to industry?',
    'How many contact form submissions came in?',
    'What month had the most sessions?',
    'Are there any bots in my data?',
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
// Intent: insights (the curated list from analyzer.generateInsights)
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
        .map((i, idx) => `**${idx + 1}. ${i.title}**\n${i.description || ''}`)
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
    keys: ['bounce rate', 'bounce'],
    title: 'Bounce Rate',
    body:
      `**Bounce Rate = 1 − (Engaged Sessions ÷ Total Sessions).** ` +
      `In GA4, an engaged session is one that lasted ≥10 seconds, fired ≥2 events, ` +
      `or converted. A bounce is everything else.`,
  },
  {
    keys: ['engagement rate'],
    title: 'Engagement Rate',
    body:
      `**Engagement Rate = Engaged Sessions ÷ Total Sessions.** ` +
      `It's the inverse of bounce rate — higher is better.`,
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
  if (!any(q, ['what is', 'whats', "what's", 'define', 'definition', 'meaning of', 'mean by'])) {
    return false;
  }
  for (const def of DEFINITIONS) {
    if (def.keys.some((k) => q.includes(k))) return def;
  }
  return false;
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
// Main dispatcher
// ---------------------------------------------------------------------------

const HANDLERS = [
  // Order matters — most specific patterns first.
  { match: intentGreeting, run: answerGreeting },
  { match: intentCapabilities, run: answerCapabilities },
  { match: intentAccuracy, run: answerAccuracy },
  // Definitions before "users" / "sessions" so "what is bounce rate" wins.
  { match: intentDefinition, run: answerDefinition, withMatch: true },
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
