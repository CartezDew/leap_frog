// Unique analytics — metrics, scores, and segmentations that are NOT in
// stock Google Analytics 4. These are the dashboard's value-add: a single
// Engagement Quality Score per item, a 4-quadrant channel quality map, a
// site-wide Data Trust Grade, page-DNA pivots, traffic concentration / HHI,
// and month-over-month anomaly detection.
//
// Every helper here is pure — it takes already-aggregated rows from
// `analyzer.js` and returns derived scores. Wire-up happens at the bottom
// of `runAllAnalysis` so every page can read these via `analyzed.unique`.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clip(v, lo = 0, hi = 1) {
  const n = num(v, lo);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function safeDiv(a, b, fallback = 0) {
  const d = num(b, 0);
  if (!d) return fallback;
  return num(a, 0) / d;
}

function median(numbers) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((acc, x) => acc + x, 0) / numbers.length;
}

function stdev(numbers) {
  if (numbers.length < 2) return 0;
  const m = mean(numbers);
  const variance =
    numbers.reduce((acc, x) => acc + (x - m) ** 2, 0) / (numbers.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// 1. Engagement Quality Score (EQS) — 0-100 composite
// ---------------------------------------------------------------------------
//
//   Inputs (all clipped to [0,1]):
//     engagement = engagement_rate (engaged sessions / sessions)
//     duration   = avg_engagement_time / DURATION_MAX
//     depth      = events_per_session / EVENTS_MAX
//     retention  = 1 - new_user_rate (returning visitor share)
//
//   EQS = 100 * (W_eng * engagement + W_dur * duration + W_dep * depth + W_ret * retention)
//
//   Weights default to a model that prizes engagement quality over volume,
//   matching the intent of "value beyond GA4's pageview-centric reports".

const DEFAULT_WEIGHTS = { engagement: 0.45, duration: 0.2, depth: 0.2, retention: 0.15 };
const DURATION_MAX = 120;  // seconds — 2 minutes saturates
const EVENTS_MAX = 10;     // events per session — 10 saturates

export function engagementQualityScore(row, weights = DEFAULT_WEIGHTS) {
  if (!row) return 0;

  const engagement = clip(num(row.engagement_rate));
  const duration = clip(num(row.avg_engagement_time) / DURATION_MAX);
  const depth = clip(num(row.events_per_session) / EVENTS_MAX);
  const retention = clip(num(row.return_rate));

  const score =
    weights.engagement * engagement +
    weights.duration * duration +
    weights.depth * depth +
    weights.retention * retention;

  return Math.round(score * 100);
}

export function eqsGrade(score) {
  if (score >= 80) return { grade: 'A', tone: 'green', label: 'Premium' };
  if (score >= 65) return { grade: 'B', tone: 'green', label: 'Healthy' };
  if (score >= 50) return { grade: 'C', tone: 'amber', label: 'Average' };
  if (score >= 35) return { grade: 'D', tone: 'amber', label: 'Below par' };
  return { grade: 'F', tone: 'red', label: 'Failing' };
}

export function decorateWithEqs(rows, weights) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    engagement_quality_score: engagementQualityScore(row, weights),
  }));
}

// ---------------------------------------------------------------------------
// 2. Channel Quality Quadrant
// ---------------------------------------------------------------------------
//
//   For every item with at least MIN_SESSIONS sessions, classify by a
//   median split on:
//       volume  = sessions
//       quality = EQS
//
//                  high quality
//                       │
//   Scale Opportunity   │   Premium  ← keep doing this
//   (low vol, high q)   │   (high vol, high q)
//   ───────────────────┼─────────────────────
//   Marginal           │   Volume Leak
//   (low vol, low q)   │   (high vol, low q) ← biggest fix
//                       │
//                  low quality

const MIN_QUADRANT_SESSIONS = 30;

const QUADRANT_DEFS = {
  premium: {
    label: 'Premium',
    tone: 'green',
    summary: 'High-volume channels that engage well — protect this investment.',
  },
  scale: {
    label: 'Scale Opportunity',
    tone: 'info',
    summary: 'Strong engagement, low volume — pour more spend or SEO into these.',
  },
  leak: {
    label: 'Volume Leak',
    tone: 'red',
    summary: 'High volume, weak engagement — biggest lever for site-wide improvement.',
  },
  marginal: {
    label: 'Marginal',
    tone: 'amber',
    summary: 'Low volume, low quality — review whether to maintain or sunset.',
  },
};

export function channelQuadrant(rows, dimKey) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { items: [], cutoffs: { sessions: 0, quality: 0 }, defs: QUADRANT_DEFS, counts: {}, totals: {} };
  }
  const eligible = rows.filter((r) => num(r.sessions) >= MIN_QUADRANT_SESSIONS);
  const candidates = eligible.length >= 4 ? eligible : rows;

  const sessVals = candidates.map((r) => num(r.sessions));
  const qualVals = candidates.map((r) =>
    num(r.engagement_quality_score, engagementQualityScore(r)),
  );

  const sessionsCutoff = median(sessVals);
  const qualityCutoff = median(qualVals);

  const items = candidates.map((r) => {
    const sessions = num(r.sessions);
    const quality = num(r.engagement_quality_score, engagementQualityScore(r));
    const highVolume = sessions >= sessionsCutoff;
    const highQuality = quality >= qualityCutoff;
    let quadrant;
    if (highVolume && highQuality) quadrant = 'premium';
    else if (!highVolume && highQuality) quadrant = 'scale';
    else if (highVolume && !highQuality) quadrant = 'leak';
    else quadrant = 'marginal';
    return {
      name: r[dimKey] || r.name || 'unknown',
      sessions,
      engagement_rate: num(r.engagement_rate),
      bounce_rate: num(r.bounce_rate),
      engagement_quality_score: quality,
      quadrant,
    };
  });

  const counts = { premium: 0, scale: 0, leak: 0, marginal: 0 };
  const totals = { premium: 0, scale: 0, leak: 0, marginal: 0 };
  for (const it of items) {
    counts[it.quadrant] += 1;
    totals[it.quadrant] += it.sessions;
  }

  return {
    items,
    cutoffs: { sessions: sessionsCutoff, quality: qualityCutoff },
    defs: QUADRANT_DEFS,
    counts,
    totals,
  };
}

// ---------------------------------------------------------------------------
// 3. Data Trust Grade
// ---------------------------------------------------------------------------
//
//   A composite 0-100 score that tells the reader how much they should
//   trust the dashboard's totals. Rolls up:
//     - bot session share (cities + sources flagged confirmed/likely)
//     - fractional / AMP user ID share
//     - suspicious source share
//     - verifier status (errors and warnings)
//     - missing optional fields / sheets
//
//   Mapped to a letter grade so non-analysts can read it at a glance.

export function dataTrustGrade({ summary, bots, usersSummary, verification, metadata }) {
  const totalSessions = num(summary?.total_sessions) || 1;
  const botSessions = num(bots?.summary?.confirmed_bot_sessions) + num(bots?.summary?.likely_bot_sessions);
  const susSessions = num(bots?.summary?.suspicious_sessions);

  const botShare = clip(botSessions / totalSessions);
  const suspiciousShare = clip(susSessions / totalSessions);

  const totalIds = num(usersSummary?.total_ids) || 1;
  const fractionalShare = clip(num(usersSummary?.fractional) / totalIds);
  const ampShare = clip(num(usersSummary?.amp) / totalIds);

  const verifyErrors = (verification?.checks || []).filter((c) => c.status === 'error').length;
  const verifyWarns = (verification?.checks || []).filter((c) => c.status === 'warn').length;

  const missingSheets = (metadata?.classifications?.['unknown'] || []).length || 0;
  const dataGaps = num(metadata?.warnings?.length) > 0 ? Math.min(metadata.warnings.length, 5) : 0;

  const penalties = {
    bot_traffic: 50 * botShare,
    suspicious_traffic: 20 * suspiciousShare,
    fractional_ids: 10 * fractionalShare,
    amp_ids: 5 * ampShare,
    verifier_errors: Math.min(20, 10 * verifyErrors),
    verifier_warnings: Math.min(10, 3 * verifyWarns),
    missing_sheets: Math.min(15, 5 * missingSheets),
    data_gaps: Math.min(5, 1 * dataGaps),
  };

  const totalPenalty = Object.values(penalties).reduce((acc, x) => acc + x, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  let grade;
  let tone;
  let label;
  if (score >= 90) { grade = 'A'; tone = 'green'; label = 'Trust the numbers.'; }
  else if (score >= 80) { grade = 'B'; tone = 'green'; label = 'Reliable with minor caveats.'; }
  else if (score >= 70) { grade = 'C'; tone = 'amber'; label = 'Read with caution.'; }
  else if (score >= 60) { grade = 'D'; tone = 'amber'; label = 'Material issues — review before sharing.'; }
  else { grade = 'F'; tone = 'red'; label = 'Don\'t share until cleaned.'; }

  // Top 3 contributing factors, sorted desc by penalty.
  const factors = Object.entries(penalties)
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, penalty]) => ({
      key,
      label: factorLabel(key),
      penalty: Math.round(penalty * 10) / 10,
    }));

  return {
    score,
    grade,
    tone,
    label,
    bot_share: botShare,
    suspicious_share: suspiciousShare,
    fractional_share: fractionalShare,
    verifier_errors: verifyErrors,
    verifier_warnings: verifyWarns,
    factors,
  };
}

function factorLabel(key) {
  switch (key) {
    case 'bot_traffic': return 'Bot session share';
    case 'suspicious_traffic': return 'Suspicious-source sessions';
    case 'fractional_ids': return 'Fractional user IDs';
    case 'amp_ids': return 'AMP-only IDs';
    case 'verifier_errors': return 'Calculation cross-check errors';
    case 'verifier_warnings': return 'Calculation cross-check warnings';
    case 'missing_sheets': return 'Unclassified sheets';
    case 'data_gaps': return 'Missing optional fields';
    default: return key;
  }
}

// ---------------------------------------------------------------------------
// 4. Traffic concentration — HHI + top-N share + "effective number"
// ---------------------------------------------------------------------------
//
//   Tells the reader how dependent the site is on a small number of pages,
//   sources, or cities. GA4 doesn't surface this; it's a portfolio-style
//   risk metric borrowed from antitrust economics.
//
//   HHI ranges 0–10000:
//     < 1500  competitive / well-diversified
//     1500–2500 moderately concentrated
//     > 2500   highly concentrated / dependency risk

export function concentration(rows, key = 'sessions') {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { count: 0, total: 0, hhi: 0, effective: 0, top1: 0, top3: 0, top5: 0, top10: 0, top1_name: null, label: 'No data' };
  }
  const total = rows.reduce((acc, r) => acc + num(r[key]), 0) || 1;
  const sorted = [...rows].sort((a, b) => num(b[key]) - num(a[key]));
  const shares = sorted.map((r) => num(r[key]) / total);

  const hhi = Math.round(shares.reduce((acc, s) => acc + s * s, 0) * 10000);
  const effective = hhi > 0 ? Math.round((10000 / hhi) * 10) / 10 : 0;
  const slice = (n) => shares.slice(0, n).reduce((a, s) => a + s, 0);

  let label;
  if (hhi < 1500) label = 'Diversified';
  else if (hhi < 2500) label = 'Moderately concentrated';
  else label = 'Highly concentrated';

  return {
    count: rows.length,
    total: Math.round(total),
    hhi,
    effective,
    top1: slice(1),
    top3: slice(3),
    top5: slice(5),
    top10: slice(10),
    top1_name: sorted[0]?.[Object.keys(sorted[0]).find((k) => k !== key && typeof sorted[0][k] === 'string')] || null,
    label,
  };
}

// ---------------------------------------------------------------------------
// 5. Content Mix performance — page DNA pivot
// ---------------------------------------------------------------------------
//
//   Pages already get a `content_role` (Homepage, Editorial, Service, etc.).
//   Pivot them so the reader sees performance per role instead of per URL —
//   a question GA4's Pages report does not answer.

const ROLE_ORDER = [
  'Homepage',
  'Conversion Page',
  'Service',
  'Unicorn',
  'Editorial',
  'High-Bounce Opportunity',
  'Supporting',
];

export function contentMix(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return [];
  const totalSessions = pages.reduce((acc, p) => acc + num(p.sessions), 0) || 1;

  const groups = new Map();
  for (const p of pages) {
    const role = p.content_role || 'Supporting';
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(p);
  }

  const out = [];
  for (const [role, rows] of groups.entries()) {
    const sessions = rows.reduce((acc, r) => acc + num(r.sessions), 0);
    const engaged = rows.reduce((acc, r) => acc + num(r.engaged_sessions), 0);
    const events = rows.reduce((acc, r) => acc + num(r.event_count), 0);
    const sessWeightedEng = rows.reduce(
      (acc, r) => acc + num(r.avg_engagement_time) * num(r.sessions),
      0,
    );
    const eqsWeighted = rows.reduce(
      (acc, r) => acc + num(r.engagement_quality_score, engagementQualityScore(r)) * num(r.sessions),
      0,
    );
    const avgEng = safeDiv(sessWeightedEng, sessions, 0);
    const avgEqs = safeDiv(eqsWeighted, sessions, 0);
    const bounceRate = sessions > 0 ? Math.max(0, 1 - engaged / sessions) : 0;
    const eventsPerSession = safeDiv(events, sessions, 0);

    out.push({
      role,
      page_count: rows.length,
      sessions: Math.round(sessions),
      session_share: sessions / totalSessions,
      engaged_sessions: Math.round(engaged),
      bounce_rate: bounceRate,
      avg_engagement_time: avgEng,
      events_per_session: eventsPerSession,
      engagement_quality_score: Math.round(avgEqs),
    });
  }

  out.sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role);
    const bi = ROLE_ORDER.indexOf(b.role);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b.sessions - a.sessions;
  });

  return out;
}

// ---------------------------------------------------------------------------
// 6. Anomaly detection — flag anomalous months
// ---------------------------------------------------------------------------
//
//   For each metric in the monthly trend, compute mean + std and mark
//   months that deviate > Z_THRESHOLD standard deviations as anomalies.
//   Useful for "what happened in March?" stories that GA4 leaves to the
//   user to spot manually.

const Z_THRESHOLD = 1.5;

export function detectMonthlyAnomalies(monthly, metrics = ['sessions', 'engaged_sessions', 'bounce_rate']) {
  if (!Array.isArray(monthly) || monthly.length < 3) {
    return { anomalies: [], stats: {} };
  }

  const stats = {};
  for (const metric of metrics) {
    const vals = monthly.map((m) => num(m[metric]));
    stats[metric] = { mean: mean(vals), stdev: stdev(vals) };
  }

  const anomalies = [];
  for (const m of monthly) {
    for (const metric of metrics) {
      const { mean: mu, stdev: sd } = stats[metric];
      if (sd === 0) continue;
      const value = num(m[metric]);
      const z = (value - mu) / sd;
      if (Math.abs(z) >= Z_THRESHOLD) {
        anomalies.push({
          month: m.month_name || m.Month,
          month_number: m.Month,
          metric,
          value,
          mean: mu,
          stdev: sd,
          z_score: Math.round(z * 100) / 100,
          direction: z > 0 ? 'spike' : 'dip',
        });
      }
    }
  }

  anomalies.sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));

  return { anomalies, stats, threshold: Z_THRESHOLD };
}

// ---------------------------------------------------------------------------
// 7. Researcher → Lead bridge
// ---------------------------------------------------------------------------
//
//   Combines the multi-month researcher cohort with the contact-form
//   classifier to estimate the share of qualified leads that look like
//   long-funnel research behaviour.

export function researcherLeadBridge({ users, contactsSummary }) {
  const multiMonth = (users || []).filter((u) => u.is_multi_month);
  const totalSalesLeads = num(contactsSummary?.by_type?.['Sales Lead']);
  const totalSubmissions = num(contactsSummary?.total) || 0;

  const monthsActiveAvg = multiMonth.length
    ? multiMonth.reduce((acc, u) => acc + num(u.months_active), 0) / multiMonth.length
    : 0;

  return {
    multi_month_count: multiMonth.length,
    sales_leads: totalSalesLeads,
    submissions_total: totalSubmissions,
    avg_months_active: monthsActiveAvg,
    research_to_lead_ratio: multiMonth.length > 0 ? safeDiv(totalSalesLeads, multiMonth.length, 0) : 0,
    lead_quality_share: safeDiv(totalSalesLeads, totalSubmissions, 0),
  };
}

// ---------------------------------------------------------------------------
// 8. Persona distribution — for User ID Engagement page
// ---------------------------------------------------------------------------

export function personaDistribution(users) {
  if (!Array.isArray(users) || users.length === 0) return [];
  const counts = new Map();
  for (const u of users) {
    const p = u.persona || 'Unassigned';
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const total = users.length;
  return [...counts.entries()]
    .map(([persona, count]) => ({
      persona,
      count,
      share: count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Master entrypoint
// ---------------------------------------------------------------------------
//
//   Wired into runAllAnalysis. Returns one bundled `unique` object with
//   everything every page needs.

export function runUniqueAnalytics({
  summary,
  monthly,
  sources,
  devices,
  cities,
  pages,
  users,
  usersSummary,
  bots,
  contactsSummary,
  verification,
  metadata,
}) {
  // Decorate the major rows with their EQS so every downstream view picks
  // it up for free (table columns, pivots, quadrant maps).
  const sourcesWithEqs = decorateWithEqs(sources);
  const devicesWithEqs = decorateWithEqs(devices);
  const citiesWithEqs = decorateWithEqs(cities);
  const pagesWithEqs = decorateWithEqs(pages);

  const trust = dataTrustGrade({ summary, bots, usersSummary, verification, metadata });
  const sourceQuadrant = channelQuadrant(sourcesWithEqs, 'source');
  const deviceQuadrant = channelQuadrant(devicesWithEqs, 'device');
  const sessionConcentration = {
    pages: concentration(pagesWithEqs, 'sessions'),
    sources: concentration(sourcesWithEqs, 'sessions'),
    cities: concentration(citiesWithEqs, 'sessions'),
  };
  const mix = contentMix(pagesWithEqs);
  const anomalies = detectMonthlyAnomalies(monthly);
  const bridge = researcherLeadBridge({ users, contactsSummary });
  const personas = personaDistribution(users);

  return {
    sources_with_eqs: sourcesWithEqs,
    devices_with_eqs: devicesWithEqs,
    cities_with_eqs: citiesWithEqs,
    pages_with_eqs: pagesWithEqs,
    trust,
    source_quadrant: sourceQuadrant,
    device_quadrant: deviceQuadrant,
    concentration: sessionConcentration,
    content_mix: mix,
    anomalies,
    researcher_lead_bridge: bridge,
    persona_distribution: personas,
  };
}
