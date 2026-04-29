// Keyword analyzer.
//
// Turns Semrush "Organic Performance" PDF snapshots (parsed in the browser
// at upload time and dropped onto `analyzed.semrush_keywords`) into the
// structures the Keywords page needs:
//
//   - Theme & intent buckets (Talkwalker-style topic clustering)
//   - Month-over-month rank momentum (movers, decliners, brand fortress)
//   - SERP page mix (page 1 / page 2 / beyond)
//   - Estimated organic traffic value (CTR-by-position × CPC × volume)
//   - Quick-win opportunity scoring (high volume × close-to-page-1)
//   - Page matches: tie keywords back to GA4 landing pages from analyzed
//
// Everything here is deterministic — given the same snapshots it always
// produces the same output, so tests / smoke checks remain stable.

const DEFAULT_DOMAIN = 'leapfrogservices.com';
const DEFAULT_SOURCE = 'Semrush — Organic Performance';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Topic clusters. The order matters: the first matching pattern wins, so
 * narrower themes go first (e.g. "vCISO" before "Cybersecurity").
 */
const THEMES = [
  {
    key: 'vciso',
    label: 'vCISO / Security Leadership',
    color: '#7c3aed',
    patterns: [/vciso/, /vcso/, /virtual ciso/, /virtual chief security officer/],
  },
  {
    key: 'cyber-risk',
    label: 'Cyber Risk',
    color: '#dc2626',
    patterns: [/cyber ?risk/, /cyberrisk/],
  },
  {
    key: 'cybersecurity',
    label: 'Cybersecurity Services',
    color: '#ea580c',
    patterns: [/cyber ?security/, /it security/],
  },
  {
    key: 'managed-it',
    label: 'Managed IT Services',
    color: '#522e91',
    patterns: [
      /managed it (services?|service)/,
      /managed it (support|atlanta|provider|company)/,
      /managed services? marietta/,
      /managed services hospitality/,
    ],
  },
  {
    key: 'it-services-geo',
    label: 'IT Services (Local Geo)',
    color: '#2563eb',
    patterns: [/it services? (atlanta|marietta|norcross)/, /^it services$/],
  },
  {
    key: 'outsource',
    label: 'Outsourced IT',
    color: '#0891b2',
    patterns: [/outsourced? it/],
  },
  {
    key: 'it-strategy',
    label: 'IT Strategy & Planning',
    color: '#16a34a',
    patterns: [/it budgeting/, /it strategy/, /it planning/],
  },
];

/**
 * Buyer intent buckets. Loosely follows the standard SEO funnel.
 */
const INTENT_RULES = [
  {
    key: 'commercial-investigation',
    label: 'Commercial Investigation',
    description:
      'Comparing providers / asking "best companies for X". High-quality near-buyers.',
    tone: 'green',
    patterns: [/companies?/, /providers?/, /vendors?/, /\bbest\b/, /\btop\b/],
  },
  {
    key: 'service-intent',
    label: 'Service Intent',
    description:
      'Looking for an actual service — local "near me" intent and named services.',
    tone: 'green',
    patterns: [
      /services?/,
      /support/,
      /\batlanta\b/,
      /\bmarietta\b/,
      /\bnorcross\b/,
    ],
  },
  {
    key: 'definitional',
    label: 'Definitional / Awareness',
    description:
      'Researching what something is. Publish primer pages to capture early funnel.',
    tone: 'amber',
    patterns: [/^vciso$/, /^vcso$/, /\bgovernance\b/, /^cyberrisk$/],
  },
  {
    key: 'planning',
    label: 'Planning & Strategy',
    description:
      'Budget / strategy / governance research — late-funnel B2B intent.',
    tone: 'amber',
    patterns: [/strategy/, /budgeting/, /planning/, /management/, /solution/],
  },
];

/**
 * Click-through-rate by SERP position. Industry-standard rough averages —
 * good enough to give relative comparisons even though the absolute numbers
 * vary by SERP feature.
 */
const CTR_BY_POSITION = {
  1: 0.32,
  2: 0.18,
  3: 0.10,
  4: 0.06,
  5: 0.04,
  6: 0.03,
  7: 0.025,
  8: 0.02,
  9: 0.018,
  10: 0.015,
};

function ctrFor(position) {
  if (position == null) return 0;
  if (position <= 10) return CTR_BY_POSITION[position] || 0.015;
  if (position <= 20) return 0.008;
  if (position <= 30) return 0.004;
  if (position <= 50) return 0.002;
  if (position <= 100) return 0.0008;
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safePos(position) {
  return position == null ? 999 : Number(position);
}

function serpBucket(position) {
  if (position == null) return 'Unranked';
  if (position <= 3) return 'Top 3';
  if (position <= 10) return 'Page 1';
  if (position <= 20) return 'Page 2';
  if (position <= 50) return 'Pages 3–5';
  return 'Pages 6+';
}

export function classifyTheme(keyword) {
  const k = String(keyword).toLowerCase();
  for (const theme of THEMES) {
    if (theme.patterns.some((p) => p.test(k))) {
      return { key: theme.key, label: theme.label, color: theme.color };
    }
  }
  return { key: 'other', label: 'Other', color: '#6b7280' };
}

export function classifyIntent(keyword) {
  const k = String(keyword).toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(k))) {
      return {
        key: rule.key,
        label: rule.label,
        description: rule.description,
        tone: rule.tone,
      };
    }
  }
  return {
    key: 'informational',
    label: 'Informational',
    description: 'Browse-level traffic without a strong commercial signal.',
    tone: 'info',
  };
}

/** True if a keyword's text mentions a specific city (local SEO signal). */
export function geoOf(keyword) {
  const k = String(keyword).toLowerCase();
  if (/\batlanta\b/.test(k)) return 'Atlanta';
  if (/\bmarietta\b/.test(k)) return 'Marietta';
  if (/\bnorcross\b/.test(k)) return 'Norcross';
  return null;
}

// ---------------------------------------------------------------------------
// Cross-snapshot index
// ---------------------------------------------------------------------------

/**
 * Build a flat per-keyword timeline by merging all monthly snapshots and
 * de-duplicating Local + National scopes. We keep both rankings — Local
 * tends to be better for geo terms; National is the harder benchmark.
 *
 * @param {Array} monthly Sorted (oldest → newest) snapshot list from
 *                        `analyzed.semrush_keywords`.
 */
export function buildKeywordTimeline(monthly = []) {
  /** @type {Map<string, any>} */
  const map = new Map();

  for (const snap of monthly) {
    if (!snap) continue;
    for (const scope of ['local', 'national']) {
      for (const row of snap[scope] || []) {
        const key = `${row.keyword}|${scope}`;
        if (!map.has(key)) {
          map.set(key, {
            keyword: row.keyword,
            scope,
            theme: classifyTheme(row.keyword),
            intent: classifyIntent(row.keyword),
            geo: geoOf(row.keyword),
            history: [],
          });
        }
        map.get(key).history.push({
          month: snap.month,
          label: snap.label,
          position: row.position,
          cpc: row.cpc,
          volume: row.volume,
        });
      }
    }
  }

  // Sort histories by month so the last entry is always the latest.
  for (const entry of map.values()) {
    entry.history.sort((a, b) => a.month.localeCompare(b.month));

    const last = entry.history[entry.history.length - 1];
    const first = entry.history[0];
    const prev =
      entry.history.length >= 2
        ? entry.history[entry.history.length - 2]
        : null;

    entry.latest = {
      ...last,
      bucket: serpBucket(last.position),
    };
    entry.first_position = first.position;
    entry.prev_position = prev?.position ?? null;

    // Direction-aware momentum (negative delta = improvement; we flip the
    // sign so positive = "moved closer to #1", which is more intuitive).
    entry.mom_delta =
      prev?.position != null && last?.position != null
        ? prev.position - last.position
        : null;
    entry.all_time_delta =
      first?.position != null && last?.position != null
        ? first.position - last.position
        : null;

    // Best & worst position seen across the tracked window.
    const positions = entry.history
      .map((h) => h.position)
      .filter((p) => p != null);
    entry.best_position = positions.length ? Math.min(...positions) : null;
    entry.worst_position = positions.length ? Math.max(...positions) : null;

    // Volatility = stdev of positions (0 = stable, large = bouncing).
    if (positions.length >= 2) {
      const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
      const variance =
        positions.reduce((acc, p) => acc + (p - mean) ** 2, 0) / positions.length;
      entry.volatility = Math.sqrt(variance);
    } else {
      entry.volatility = 0;
    }

    // Estimated monthly traffic & dollar value at current rank.
    const v = num(last.volume);
    const cpc = num(last.cpc);
    const ctr = ctrFor(last.position);
    entry.est_clicks = Math.round(v * ctr * 10) / 10;
    entry.est_value = Math.round(v * ctr * cpc * 100) / 100;
  }

  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Aggregations & insights
// ---------------------------------------------------------------------------

export function summarizeMonth(snapshot, scope = 'national') {
  const rows = snapshot?.[scope] || [];
  if (!rows.length) return null;

  const ranked = rows.filter((r) => r.position != null);
  const top10 = ranked.filter((r) => r.position <= 10);
  const top3 = ranked.filter((r) => r.position <= 3);

  const avgPos =
    ranked.length > 0
      ? ranked.reduce((a, r) => a + r.position, 0) / ranked.length
      : null;

  const totalVolume = rows.reduce((a, r) => a + num(r.volume), 0);
  const estTraffic = ranked.reduce(
    (a, r) => a + num(r.volume) * ctrFor(r.position),
    0,
  );
  const estValue = ranked.reduce(
    (a, r) => a + num(r.volume) * ctrFor(r.position) * num(r.cpc),
    0,
  );

  return {
    month: snapshot.month,
    label: snapshot.label,
    scope,
    tracked: rows.length,
    ranked: ranked.length,
    top3: top3.length,
    top10: top10.length,
    avg_position: avgPos,
    total_volume: totalVolume,
    est_monthly_clicks: Math.round(estTraffic),
    est_monthly_value: Math.round(estValue),
  };
}

export function buildMonthlyTrend(monthly = [], scope = 'national') {
  return (monthly || [])
    .map((snap) => summarizeMonth(snap, scope))
    .filter(Boolean);
}

export function rollupByTheme(timeline, scope = 'national') {
  const byTheme = new Map();
  for (const t of timeline) {
    if (t.scope !== scope) continue;
    const key = t.theme.key;
    if (!byTheme.has(key)) {
      byTheme.set(key, {
        ...t.theme,
        keywords: 0,
        avg_position: 0,
        total_volume: 0,
        est_clicks: 0,
        est_value: 0,
        ranked: 0,
      });
    }
    const agg = byTheme.get(key);
    agg.keywords += 1;
    agg.total_volume += num(t.latest.volume);
    agg.est_clicks += num(t.est_clicks);
    agg.est_value += num(t.est_value);
    if (t.latest.position != null) {
      agg.avg_position += t.latest.position;
      agg.ranked += 1;
    }
  }
  return [...byTheme.values()]
    .map((t) => ({
      ...t,
      avg_position: t.ranked ? t.avg_position / t.ranked : null,
    }))
    .sort((a, b) => b.est_value - a.est_value);
}

export function rollupByIntent(timeline, scope = 'national') {
  const byIntent = new Map();
  for (const t of timeline) {
    if (t.scope !== scope) continue;
    const key = t.intent.key;
    if (!byIntent.has(key)) {
      byIntent.set(key, {
        ...t.intent,
        keywords: 0,
        total_volume: 0,
        est_clicks: 0,
        est_value: 0,
        avg_position: 0,
        ranked: 0,
      });
    }
    const agg = byIntent.get(key);
    agg.keywords += 1;
    agg.total_volume += num(t.latest.volume);
    agg.est_clicks += num(t.est_clicks);
    agg.est_value += num(t.est_value);
    if (t.latest.position != null) {
      agg.avg_position += t.latest.position;
      agg.ranked += 1;
    }
  }
  return [...byIntent.values()]
    .map((i) => ({
      ...i,
      avg_position: i.ranked ? i.avg_position / i.ranked : null,
    }))
    .sort((a, b) => b.keywords - a.keywords);
}

export function buildSerpMix(timeline, scope = 'national') {
  const buckets = { 'Top 3': 0, 'Page 1': 0, 'Page 2': 0, 'Pages 3–5': 0, 'Pages 6+': 0, 'Unranked': 0 };
  for (const t of timeline) {
    if (t.scope !== scope) continue;
    const b = serpBucket(t.latest.position);
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(buckets).map(([bucket, count]) => ({
    bucket,
    count,
    share: count / total,
  }));
}

/**
 * Sort the timeline into themed insight lists used by the Keywords page.
 */
export function buildKeywordInsights(timeline, scope = 'national') {
  const inScope = timeline.filter((t) => t.scope === scope);

  const movers = inScope
    .filter((t) => t.mom_delta != null && t.mom_delta > 0)
    .sort((a, b) => b.mom_delta - a.mom_delta);

  const decliners = inScope
    .filter((t) => t.mom_delta != null && t.mom_delta < 0)
    .sort((a, b) => a.mom_delta - b.mom_delta);

  const fortress = inScope
    .filter(
      (t) =>
        t.latest.position != null &&
        t.latest.position <= 10 &&
        (t.worst_position ?? 99) <= 10,
    )
    .sort((a, b) => safePos(a.latest.position) - safePos(b.latest.position));

  const quickWins = inScope
    .filter(
      (t) =>
        t.latest.position != null &&
        t.latest.position >= 11 &&
        t.latest.position <= 20,
    )
    .map((t) => ({
      ...t,
      win_score: num(t.latest.volume) * (21 - t.latest.position),
    }))
    .sort((a, b) => b.win_score - a.win_score);

  const opportunityGap = inScope
    .filter(
      (t) =>
        num(t.latest.volume) >= 100 &&
        (t.latest.position == null || t.latest.position > 10),
    )
    .sort((a, b) => num(b.latest.volume) - num(a.latest.volume));

  const volatile = inScope
    .filter((t) => t.volatility >= 8)
    .sort((a, b) => b.volatility - a.volatility);

  const valueDrivers = [...inScope]
    .filter((t) => t.est_value > 0)
    .sort((a, b) => b.est_value - a.est_value);

  return {
    movers,
    decliners,
    fortress,
    quick_wins: quickWins,
    opportunity_gap: opportunityGap,
    volatile,
    value_drivers: valueDrivers,
  };
}

// ---------------------------------------------------------------------------
// Cross-link to the rest of the dashboard
// ---------------------------------------------------------------------------

const STOP = new Set([
  'a', 'an', 'and', 'or', 'the', 'in', 'of', 'on', 'for', 'to', 'with',
  'is', 'at', 'by', 'as', 'it',
]);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/**
 * Score how strongly a keyword matches a given page path. We look at slug
 * tokens (stripping `/`, `-`, `_`) plus the first 8 path segments. Returns
 * a 0–1 confidence score plus the matched tokens.
 */
function matchKeywordToPage(keyword, page) {
  const kwTokens = tokens(keyword);
  if (!kwTokens.length) return null;
  const pageTokens = new Set(tokens(page.replace(/[\/_\-?#]/g, ' ')));
  if (!pageTokens.size) return null;

  const matched = kwTokens.filter((t) => pageTokens.has(t));
  if (matched.length < Math.max(2, Math.ceil(kwTokens.length / 2))) {
    return null;
  }

  return {
    score: matched.length / kwTokens.length,
    matched,
  };
}

/**
 * For each tracked keyword, find candidate landing pages from the GA4
 * upload that look semantically related to that keyword. Returns a sparse
 * list — only keywords with at least one match.
 */
export function tieKeywordsToPages(timeline, analyzedPages = []) {
  const pages = (analyzedPages || []).slice(0, 200);
  const matches = [];

  for (const t of timeline) {
    if (t.scope !== 'national' && t.scope !== 'local') continue;
    const candidates = [];
    for (const page of pages) {
      const path = page.page || page.path || '';
      if (!path) continue;
      const score = matchKeywordToPage(t.keyword, path);
      if (score && score.score >= 0.5) {
        candidates.push({
          path,
          sessions: num(page.sessions),
          bounce_rate: num(page.bounce_rate),
          avg_engagement_time: num(page.avg_engagement_time),
          score: score.score,
        });
      }
    }
    candidates.sort((a, b) => b.sessions - a.sessions);
    if (candidates.length) {
      matches.push({
        keyword: t.keyword,
        scope: t.scope,
        latest_position: t.latest.position,
        theme: t.theme.label,
        intent: t.intent.label,
        pages: candidates.slice(0, 3),
      });
    }
  }

  return matches;
}

/**
 * Find pages that look relevant to a keyword cluster but are bleeding
 * (high bounce / low engagement). These are the highest-leverage SEO
 * fixes — search drives traffic, but the page wastes it.
 */
export function findUnderperformingMatches(matches) {
  const flagged = [];
  for (const m of matches) {
    for (const page of m.pages) {
      if (page.sessions < 50) continue;
      if (page.bounce_rate >= 0.6 || page.avg_engagement_time < 8) {
        flagged.push({
          ...page,
          keyword: m.keyword,
          theme: m.theme,
          latest_position: m.latest_position,
          reason:
            page.bounce_rate >= 0.6
              ? `Bounce ${Math.round(page.bounce_rate * 100)}%`
              : `Avg engagement ${page.avg_engagement_time.toFixed(1)}s`,
        });
      }
    }
  }
  return flagged.sort((a, b) => b.sessions - a.sessions);
}

/**
 * Identify which sources from the GA4 upload look like organic search
 * (Google / Bing / DuckDuckGo / Yahoo / Yandex / "organic") so we can
 * compare keyword traction with the actual organic sessions delivered.
 */
export function organicSourceSummary(sources = []) {
  const ORGANIC_PATTERNS = [
    /google$/i,
    /^bing/i,
    /duckduckgo/i,
    /^yahoo/i,
    /yandex/i,
    /baidu/i,
    /\borganic\b/i,
  ];
  const matched = sources.filter((s) =>
    ORGANIC_PATTERNS.some((re) => re.test(String(s.source || ''))),
  );
  if (!matched.length) return null;
  const totalSessions = matched.reduce((a, s) => a + num(s.sessions), 0);
  const totalEngaged = matched.reduce(
    (a, s) => a + num(s.engaged_sessions),
    0,
  );
  return {
    sources: matched,
    sessions: totalSessions,
    engaged_sessions: totalEngaged,
    engagement_rate: totalSessions ? totalEngaged / totalSessions : 0,
  };
}

// ---------------------------------------------------------------------------
// Top-level entrypoint
// ---------------------------------------------------------------------------

/**
 * Build everything the Keywords page consumes.
 *
 * @param {object|null} analyzed The merged GA4 payload (used to cross-link
 *                               keywords to landing pages and organic
 *                               sources). May be null/undefined.
 *
 * Reads keyword snapshots from `analyzed.semrush_keywords`. Returns `null`
 * when no Semrush PDFs have been uploaded so the page can render an empty
 * state instead of confusing zero-data charts.
 */
export function runKeywordAnalysis(analyzed = null) {
  const monthly = Array.isArray(analyzed?.semrush_keywords)
    ? analyzed.semrush_keywords
    : [];

  if (monthly.length === 0) {
    return {
      empty: true,
      domain: DEFAULT_DOMAIN,
      source: DEFAULT_SOURCE,
      monthly: [],
      latest: null,
      timeline: [],
      trend: { national: [], local: [] },
      themes: { national: [], local: [] },
      intents: [],
      serp_mix: [],
      insights: {
        movers: [],
        decliners: [],
        fortress: [],
        quick_wins: [],
        opportunity_gap: [],
        volatile: [],
        value_drivers: [],
      },
      cross: { page_matches: [], underperforming: [], organic: null },
    };
  }

  const latest = monthly[monthly.length - 1];
  const timeline = buildKeywordTimeline(monthly);
  const trendNational = buildMonthlyTrend(monthly, 'national');
  const trendLocal = buildMonthlyTrend(monthly, 'local');
  const themesNational = rollupByTheme(timeline, 'national');
  const themesLocal = rollupByTheme(timeline, 'local');
  const intents = rollupByIntent(timeline, 'national');
  const serpMix = buildSerpMix(timeline, 'national');
  const insights = buildKeywordInsights(timeline, 'national');

  const pages = analyzed?.pages?.top_pages || [];
  const sources = analyzed?.sources || [];
  const pageMatches = tieKeywordsToPages(timeline, pages);
  const underperforming = findUnderperformingMatches(pageMatches);
  const organic = organicSourceSummary(sources);

  return {
    empty: false,
    domain: DEFAULT_DOMAIN,
    source: DEFAULT_SOURCE,
    monthly,
    latest,
    timeline,
    trend: {
      national: trendNational,
      local: trendLocal,
    },
    themes: {
      national: themesNational,
      local: themesLocal,
    },
    intents,
    serp_mix: serpMix,
    insights,
    cross: {
      page_matches: pageMatches,
      underperforming,
      organic,
    },
  };
}
