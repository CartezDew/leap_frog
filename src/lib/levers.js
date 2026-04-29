// Shared "Growth Lever" derivations — pure functions used by individual
// analysis pages (User ID Engagement, Traffic Sources, Page Path Analysis,
// Contact Form Intel, Bot Traffic) so each insight lives in context with the
// data it acts on, not in a separate page.

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// User-ID types that are NOT real prospects, even when bot_classification
// reads "human": cookie/device-bridge artifacts and AMP wrappers.
export const NON_PROSPECT_ID_TYPES = new Set([
  'AMP',
  'Cross-Device (.2)',
  'Google Signals (.17/.18)',
  'Fractional (other)',
]);

// Source-name regexes that map a referrer to a known AI assistant. AI-bot
// sessions look like high-bounce humans (read-and-leave); excluding them
// protects refresh-candidate / channel-quality signals from skew.
const AI_SOURCES = [
  { pattern: /chatgpt\.com|chat\.openai|openai/i, name: 'ChatGPT (OpenAI)' },
  { pattern: /perplexity/i, name: 'Perplexity' },
  { pattern: /claude\.ai|anthropic/i, name: 'Claude (Anthropic)' },
  { pattern: /gemini\.google|bard\.google/i, name: 'Gemini' },
  {
    pattern: /copilot\.microsoft|bing\.com\/chat|edgeservices\.bing/i,
    name: 'Copilot',
  },
  { pattern: /you\.com/i, name: 'You.com' },
  { pattern: /phind\.com/i, name: 'Phind' },
  { pattern: /kagi\.com/i, name: 'Kagi' },
  { pattern: /poe\.com/i, name: 'Poe (Quora)' },
  { pattern: /huggingface\.co\/chat|hf\.co\/chat/i, name: 'HuggingChat' },
  { pattern: /duckduckgo.*ai|duck\.ai/i, name: 'DuckDuckGo AI' },
  { pattern: /meta\.ai/i, name: 'Meta AI' },
  { pattern: /grok\.x\.ai|x\.ai/i, name: 'Grok (xAI)' },
];

export function detectAiSource(name) {
  const s = String(name || '').toLowerCase().trim();
  if (!s) return null;
  for (const entry of AI_SOURCES) {
    if (entry.pattern.test(s)) return entry.name;
  }
  return null;
}

function buildAiSourceLookup(sources) {
  const set = new Set();
  for (const s of sources || []) {
    if (detectAiSource(s.source)) {
      set.add(String(s.source).toLowerCase().trim());
    }
  }
  return set;
}

export function summarizeAiSources(sources, siteSessions) {
  const matches = [];
  let totalSessions = 0;
  let weightedBounceNumer = 0;
  let weightedBounceDenom = 0;

  for (const s of sources || []) {
    const name = detectAiSource(s.source);
    if (!name) continue;
    const sessions = num(s.sessions);
    matches.push({
      assistant: name,
      source: s.source,
      sessions,
      engagement_rate: num(s.engagement_rate),
      bounce_rate: num(s.bounce_rate),
      avg_engagement_time: num(s.avg_engagement_time),
    });
    totalSessions += sessions;
    if (sessions > 0) {
      weightedBounceNumer += num(s.bounce_rate) * sessions;
      weightedBounceDenom += sessions;
    }
  }

  matches.sort((a, b) => b.sessions - a.sessions);

  return {
    matches,
    total_sessions: totalSessions,
    site_share: siteSessions ? totalSessions / siteSessions : 0,
    weighted_bounce_rate: weightedBounceDenom
      ? weightedBounceNumer / weightedBounceDenom
      : 0,
  };
}

function channelAction(row) {
  const eng = num(row.engagement_rate);
  const time = num(row.avg_engagement_time);
  if (eng >= 0.6 && time >= 30) return { label: 'Invest more', tone: 'good' };
  if (eng >= 0.45 && time >= 15) return { label: 'Maintain', tone: 'okay' };
  if (eng < 0.3 || time < 5) return { label: 'Investigate quality', tone: 'high' };
  return { label: 'Test improvements', tone: 'medium' };
}

export function rankChannels(sources, limit = 6) {
  const aiLookup = buildAiSourceLookup(sources);
  const clean = (sources || []).filter((s) => {
    if (s.bot_classification !== 'human') return false;
    if (num(s.sessions) < 50) return false;
    const key = String(s.source || '').toLowerCase().trim();
    if (aiLookup.has(key)) return false; // AI assistants get their own card
    return true;
  });
  const scored = clean.map((s) => {
    const sessions = num(s.sessions);
    const engagement = num(s.engagement_rate);
    const time = num(s.avg_engagement_time);
    const quality = sessions * engagement * Math.min(1, time / 30);
    return { ...s, _quality: quality };
  });
  scored.sort((a, b) => b._quality - a._quality);
  const top = scored.slice(0, limit);
  const maxQuality = top[0]?._quality || 1;
  return top.map((s) => ({
    ...s,
    quality_index: maxQuality ? s._quality / maxQuality : 0,
    action: channelAction(s),
  }));
}

// Layered bot/non-human filtering — bot_classification alone is not enough
// because Cross-Device (.2) and Google Signals (.17/.18) cookies often *do*
// show real engagement (they're cookie artifacts, not bots).
export function pickWarmProspects(users, limit = 8) {
  if (!Array.isArray(users)) return [];
  const candidates = users.filter((u) => {
    if (u.bot_classification !== 'human') return false;
    if (NON_PROSPECT_ID_TYPES.has(u.id_type)) return false;
    if (num(u.bot_score) >= 2) return false;
    if (num(u.bounce_rate) >= 0.7) return false;
    if (num(u.avg_session_duration) < 30) return false;
    if (num(u.total_sessions) < 3) return false;
    return u.is_high_engagement || u.is_multi_month;
  });
  candidates.sort((a, b) => {
    const score = (u) =>
      num(u.engagement_rate) * num(u.total_sessions) +
      num(u.months_active) * 5 +
      num(u.avg_session_duration) / 30;
    return score(b) - score(a);
  });
  return candidates.slice(0, limit);
}

export function shortenId(id, head = 6, tail = 4) {
  const s = String(id || '');
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// Bot-impact projection: cleaned bounce/engagement views derived from the
// current bot summary. Returns numbers ready to format.
export function computeBotImpact(summary, bots) {
  const totalSessions = num(summary?.total_sessions);
  const botSummary = bots?.summary || {};
  const confirmedBotSessions = num(botSummary.confirmed_bot_sessions);
  const likelyBotSessions = num(botSummary.likely_bot_sessions);
  const humanSessions = num(botSummary.human_sessions);
  const allClassified =
    confirmedBotSessions +
    likelyBotSessions +
    num(botSummary.suspicious_sessions) +
    humanSessions;
  const reportedEngagement = num(summary?.engagement_rate);
  const reportedBounce = num(summary?.site_bounce_rate);
  const classifiedBounce = num(botSummary.classified_bounce_rate);
  const confirmedRemovedBounce = num(botSummary.confirmed_removed_bounce_rate);
  const confirmedLikelyRemovedBounce = num(
    botSummary.confirmed_likely_removed_bounce_rate,
  );
  const humanOnlyBounce = num(botSummary.human_only_bounce_rate);
  const cleanEngagement = humanSessions
    ? Math.min(1, reportedEngagement * (totalSessions / humanSessions))
    : reportedEngagement;

  return {
    bot_share_of_classified: allClassified
      ? confirmedBotSessions / allClassified
      : 0,
    confirmed_bot_sessions: confirmedBotSessions,
    likely_bot_sessions: likelyBotSessions,
    bot_user_ids: num(botSummary.bot_user_ids),
    reported_engagement: reportedEngagement,
    clean_engagement: cleanEngagement,
    engagement_lift: cleanEngagement - reportedEngagement,
    reported_bounce: reportedBounce,
    classified_bounce: classifiedBounce,
    confirmed_removed_bounce: confirmedRemovedBounce,
    confirmed_likely_removed_bounce: confirmedLikelyRemovedBounce,
    human_only_bounce: humanOnlyBounce,
    confirmed_removed_sessions: num(botSummary.confirmed_removed_sessions),
    confirmed_likely_removed_sessions: num(
      botSummary.confirmed_likely_removed_sessions,
    ),
    ai_assistant_sessions: num(botSummary.ai_assistant_sessions),
    ai_assistant_bounce: num(botSummary.ai_assistant_bounce_rate),
  };
}

export function pickRecentSalesLeads(contacts, limit = 3) {
  if (!Array.isArray(contacts)) return [];
  return contacts
    .filter((c) => c.lead_type === 'Sales Lead')
    .slice(0, limit)
    .map((c) => ({
      page: c.conversion_page || '',
      snippet: snippet(c.how_can_we_help, 160),
    }));
}

function snippet(text, max = 120) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
