// Analytics enrichment — JavaScript port of server/services/analyzer.py.
//
// Implements every analysis rule from SKILL.md sections 3 through 8:
//  - Bounce-rate / engagement / new-user / return-rate / events-per-session
//  - City and source bot scoring
//  - User ID classification, bot scoring, persona assignment
//  - Unicorn / opportunity page identification
//  - Contact form classification
//  - Aggregated outputs ready for the dashboard pages

import {
  BOUNCE_TIER_AMBER,
  BOUNCE_TIER_GREEN,
  BOUNCE_TIER_RED,
  HIGH_ENGAGEMENT_MAX_BOT_SCORE,
  HIGH_ENGAGEMENT_MIN_DURATION,
  HIGH_ENGAGEMENT_MIN_RATE,
  HIGH_ENGAGEMENT_MIN_SESSIONS,
  KNOWN_DATACENTER_CITIES,
  KNOWN_SPAM_SOURCES,
  MONTH_NAMES,
  MULTI_MONTH_MIN_MONTHS,
  MULTI_MONTH_MIN_RATE,
  MULTI_MONTH_MIN_SESSIONS,
  OPPORTUNITY_MIN_BOUNCE,
  OPPORTUNITY_MIN_SESSIONS,
  UNICORN_MAX_BOUNCE,
  UNICORN_MIN_SESSIONS,
  classifyBotScore,
} from './skillConfig.js';
import { runVerifier } from './verifier.js';
import { runAccuracyCheck } from './accuracyCheck.js';
import { decorateWithEqs, runUniqueAnalytics } from './uniqueAnalytics.js';
import { runBounceBenchmark } from './bounceBenchmark.js';
import { buildTopInsights } from './insightEngine.js';
import { detectAiSource } from './levers.js';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function num(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeDiv(numer, denom, fallback = 0) {
  const d = num(denom, 0);
  if (!d) return fallback;
  return num(numer, 0) / d;
}

export function calculateBounceRate(engaged, sessions) {
  const s = num(sessions, 0);
  if (!s) return 0;
  return Math.max(0, Math.min(1, 1 - num(engaged, 0) / s));
}

function bounceTier(rate) {
  if (rate >= BOUNCE_TIER_RED) return 'high';
  if (rate >= BOUNCE_TIER_AMBER) return 'medium';
  if (rate <= BOUNCE_TIER_GREEN) return 'good';
  return 'okay';
}

function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function sumKey(records, key) {
  let total = 0;
  for (const r of records) total += num(r[key], 0);
  return total;
}

function meanKey(records, key) {
  if (!records.length) return 0;
  return sumKey(records, key) / records.length;
}

// ---------------------------------------------------------------------------
// Bot scoring (SKILL.md 4.1, 4.2)
// ---------------------------------------------------------------------------

export function cityBotScore(row) {
  let score = 0;
  const sessions = num(row.sessions);
  const avgEng = num(row.avg_engagement_time);
  const bounce = num(row.bounce_rate);
  const returnRate = num(row.return_rate);
  const eventsPer = num(row.events_per_session);
  const city = String(row.city || '').trim();

  if (avgEng < 1.0 && sessions > 50) score += 4;
  else if (avgEng < 3.0 && sessions > 30) score += 2;

  if (bounce >= 0.9) score += 4;
  else if (bounce >= 0.75) score += 2;

  if (returnRate < 0.02 && sessions > 50) score += 2;

  if (KNOWN_DATACENTER_CITIES.some((c) => c.toLowerCase() === city.toLowerCase())) {
    score += 3;
  }

  if (eventsPer < 1.0 && sessions > 20) score += 2;

  return score;
}

export function sourceBotScore(row) {
  let score = 0;
  const sessions = num(row.sessions);
  const avgEng = num(row.avg_engagement_time);
  const bounce = num(row.bounce_rate);
  const returnRate = num(row.return_rate);
  const source = String(row.source || '').trim();

  if (avgEng < 2.0 && sessions > 20) score += 3;
  if (bounce >= 0.9 && sessions > 10) score += 4;
  if (returnRate < 0.01 && sessions > 20) score += 2;
  if (KNOWN_SPAM_SOURCES.some((s) => s.toLowerCase() === source.toLowerCase())) {
    score += 5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// User ID analysis (SKILL.md 5.1 - 5.4)
// ---------------------------------------------------------------------------

export function classifyUserId(uid) {
  const s = String(uid ?? '');
  if (s.startsWith('amp-')) return 'AMP';
  if (s.includes('.')) {
    const parts = s.split('.');
    const suffix = parts.length === 2 ? parts[parts.length - 1] : '';
    if (suffix === '2') return 'Cross-Device (.2)';
    if (suffix === '17' || suffix === '18') return 'Google Signals (.17/.18)';
    return 'Fractional (other)';
  }
  return 'Standard';
}

export function userBotScore(row) {
  const uid = String(row.user_id || row.effective_user_id || '');
  const sessions = num(row.total_sessions);
  const engaged = num(row.total_engaged);
  const duration = num(row.avg_session_duration);
  const views = num(row.total_views);
  const engagementRate = num(row.engagement_rate);

  let score = 0;
  if (uid.endsWith('.2')) score += 1;
  if (uid.startsWith('amp-')) score += 1;
  if (sessions > 0 && engaged === 0) score += 3;
  if (duration < 2 && sessions > 3) score += 2;
  if (views === 0 && sessions > 0) score += 2;
  if (sessions > 10 && engagementRate < 0.1) score += 2;
  return score;
}

export function assignPersona(row) {
  const sessions = num(row.total_sessions);
  const duration = num(row.avg_session_duration);
  const months = num(row.months_active);
  const engagement = num(row.engagement_rate);
  const viewsPer = num(row.avg_views_per_session);

  if (sessions >= 15 && duration >= 300 && months >= 3) return 'Deep Researcher';
  if (sessions >= 15 && duration >= 300 && months <= 2) return 'Intensive Evaluator';
  if (sessions >= 8 && duration >= 400 && engagement >= 0.7) return 'High-Value Prospect';
  if (sessions >= 8 && duration >= 100 && months >= 3) return 'Engaged Returning User';
  if (sessions >= 5 && duration >= 600) return 'Deep Reader';
  if (sessions >= 5 && viewsPer >= 4) return 'Site Explorer';
  if (sessions >= 3 && duration >= 300 && engagement >= 0.8) return 'Strong Prospect';
  return 'Engaged Visitor';
}

// ---------------------------------------------------------------------------
// Contact classification (SKILL.md 7)
// ---------------------------------------------------------------------------

// Lead categories surfaced on the Contact Form Intel dashboard. Order matters
// for downstream display fall-throughs, but lookups are by name.
export const CONTACT_LEAD_TYPES = [
  'Sales Lead',
  'Partnership',
  'Spam',
  'Support Request',
  'Job Seeker',
  'Event / Conference',
  'Needs Review',
  'Unknown',
];

export function classifyContact(text) {
  if (text === null || text === undefined) return 'Unknown';
  if (typeof text === 'number' && Number.isNaN(text)) return 'Unknown';
  const t = String(text).toLowerCase();
  if (!t.trim()) return 'Unknown';

  // ----- Spam / Irrelevant — only the clearly off-topic, automated-feeling
  // pitches (crypto wallets, link-farming, "buy your business" cold pitches,
  // staffing-industry cold outreach). Vendor outreach with a real product is
  // routed to the Partnership / Vendor bucket below.
  const spam = [
    'wikipedia',
    'staffing industry',
    'cold outreach',
    'business broker',
    'selling your business',
    'sell your business',
    'seo services',
    'crypto wallet',
    'develop our own crypto',
    'eliminate thousands in credit card',
    'cleaning quote that meets your company',
    'complimentary clean',
  ];
  if (spam.some((k) => t.includes(k))) return 'Spam';

  // ----- Existing-client / support — keep above Sales Lead because some
  // support tickets mention services in passing.
  const support = [
    'bitlocker',
    'bit lock',
    'citrix',
    'network error',
    'unstable network',
    'poor network',
    'video calls',
    'cannot pin point',
    'no longer with the company',
    'launch tessitura',
    'auto-detection',
    'remove this',
    'login to',
    'unable to launch',
  ];
  if (support.some((k) => t.includes(k))) return 'Support Request';

  // ----- Job seeker / HR. Use specific phrases — `position` and `career`
  // alone are far too broad (they match "career group", "position brands",
  // etc. in vendor pitches).
  const jobs = [
    'missed an interview',
    'scheduled an interview',
    'interview with',
    'send my resume',
    'attached my resume',
    'apply for a position',
    'open position',
    'job opportunity',
    'looking for a job',
    'looking for employment',
    'career opportunity',
    'employment opportunity',
    'maureen coyle',
  ];
  if (jobs.some((k) => t.includes(k))) return 'Job Seeker';

  // ----- Event / Conference / sponsorship outreach.
  const events = [
    'conference',
    'sponsorship',
    'sponsor',
    'speaking opportunity',
    'guest speaker',
    'frontline of a global',
    'cybersecurity has moved beyond',
  ];
  if (events.some((k) => t.includes(k))) return 'Event / Conference';

  // ----- Partnership / Vendor Inquiry — collaboration language plus vendor
  // outreach (cleaning services, payment processors, MDM, lead-gen vendors,
  // consultants pitching their services to us).
  const partnership = [
    'strategic partnership',
    'partnership',
    'potential partnership',
    'explore a potential',
    'explore a potential collaboration',
    'collaboration',
    'subcontract',
    'reseller',
    'channel partner',
    'mutual referral',
    'meeting facilitator',
    'consulting team to facilitate',
    'it hardware products',
    'trusted partner',
    'managed it services to genesis',
    'business development, and sales growth',
    'mobile device',
    'lead generation',
    'cleaning',
    'janitorial',
    'payment processing',
    'credit card processing',
    'merchant services',
    'cloud consulting firms often need',
    'we provide mobile device',
    'system4 of nashville',
    'we would like to purchase a few products',
    'purchase a few products from a list',
  ];
  if (partnership.some((k) => t.includes(k))) return 'Partnership';

  // ----- Sales Lead — IT services, managed services, cybersecurity intent.
  const sales = [
    'msp',
    'mmsp',
    'managed it',
    'managed service',
    'outsourc',
    'it support',
    'it consultant',
    'it consultants',
    'cybersecurity service',
    'cybersecurity services',
    'cybersecurity and it',
    'cybersecurity & it',
    'cmmc',
    'cmmc compliance',
    'microsoft 365',
    'm365',
    'help desk',
    'it service',
    'it services',
    'voip',
    'cloud migration',
    'switch over',
    'swap over',
    'replace our current',
    'transition our it',
    'transitioning our it',
    'quote and detail',
    'quote',
    'need cmmc',
    'outgrown our current',
    'we are seeking a firm',
    'looking for a quote',
    'request a quote',
    'looking for an msp',
    'purchasing it services',
    'it & cybersecurity',
    'looking to replace',
  ];
  if (sales.some((k) => t.includes(k))) return 'Sales Lead';

  // ----- Lighter-weight sales intent ("interested in services" etc.).
  if (
    [
      'interested in services',
      'interested in your services',
      'looking to get started',
      'interested in discussing services',
    ].some((k) => t.includes(k))
  ) {
    return 'Sales Lead';
  }

  return 'Needs Review';
}

// ---------------------------------------------------------------------------
// Wide-format aggregations
// ---------------------------------------------------------------------------

function aggregateWide(records, dimColRaw) {
  if (!records || records.length === 0) return [];
  const dimCol = dimColRaw;
  const dimKey = dimCol.toLowerCase();

  const groups = groupBy(records, (r) => r[dimCol]);
  const out = [];
  for (const [dimValue, rows] of groups.entries()) {
    if (dimValue === null || dimValue === undefined || dimValue === '') continue;
    const sessions = sumKey(rows, 'sessions');
    const engaged = sumKey(rows, 'engaged_sessions');
    const totalUsers = sumKey(rows, 'total_users');
    const newUsers = sumKey(rows, 'new_users');
    const activeUsers = sumKey(rows, 'active_users');
    const eventCount = sumKey(rows, 'event_count');
    let engSeconds = 0;
    for (const r of rows) {
      engSeconds += num(r.avg_engagement_time, 0) * num(r.sessions, 0);
    }
    const avgEng = safeDiv(engSeconds, sessions, 0);
    const bounce = calculateBounceRate(engaged, sessions);
    const engagementRate = safeDiv(engaged, sessions, 0);
    const newUserRate = safeDiv(newUsers, totalUsers, 0);
    const returnRate = Math.max(0, 1 - newUserRate);
    const eventsPerSession = safeDiv(eventCount, sessions, 0);

    out.push({
      [dimKey]: dimValue,
      sessions,
      engaged_sessions: engaged,
      total_users: totalUsers,
      new_users: newUsers,
      active_users: activeUsers,
      event_count: eventCount,
      avg_engagement_time: avgEng,
      bounce_rate: bounce,
      engagement_rate: engagementRate,
      new_user_rate: newUserRate,
      return_rate: returnRate,
      events_per_session: eventsPerSession,
      bounce_tier: bounceTier(bounce),
    });
  }
  return out;
}

function monthlyTotals(records) {
  if (!records || records.length === 0) return [];
  const groups = groupBy(records, (r) => r.Month);
  const out = [];
  for (const [month, rows] of groups.entries()) {
    if (month === null || month === undefined) continue;
    const sessions = sumKey(rows, 'sessions');
    const engaged = sumKey(rows, 'engaged_sessions');
    const totalUsers = sumKey(rows, 'total_users');
    const newUsers = sumKey(rows, 'new_users');
    const eventCount = sumKey(rows, 'event_count');
    out.push({
      Month: month,
      sessions,
      engaged_sessions: engaged,
      total_users: totalUsers,
      new_users: newUsers,
      event_count: eventCount,
      bounce_rate: calculateBounceRate(engaged, sessions),
      engagement_rate: safeDiv(engaged, sessions, 0),
    });
  }

  out.sort((a, b) => a.Month - b.Month);

  let prior = null;
  for (const r of out) {
    const m = Number(r.Month);
    r.month_name = m >= 1 && m <= 12 ? MONTH_NAMES[m - 1] : String(r.Month);
    r.sessions_mom_delta = prior === null ? 0 : r.sessions - prior;
    r.sessions_mom_pct =
      prior === null || prior === 0 ? 0 : (r.sessions - prior) / prior;
    prior = r.sessions;
  }

  return out;
}

// ---------------------------------------------------------------------------
// User aggregation
// ---------------------------------------------------------------------------

function parseMonthsList(value) {
  if (value === null || value === undefined) return [];
  const s = String(value).trim();
  if (!s) return [];
  return s
    .split(/[,;|\/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function aggregateUsers(records) {
  if (!records || records.length === 0) return [];
  const groups = groupBy(records, (r) => r.effective_user_id);
  const out = [];
  for (const [uid, rows] of groups.entries()) {
    if (uid === null || uid === undefined || String(uid).trim() === '') continue;

    const totalSessions = sumKey(rows, 'sessions');
    const totalEngaged = sumKey(rows, 'engaged_sessions');
    const totalViews = sumKey(rows, 'views');
    const totalEvents = sumKey(rows, 'event_count');
    const totalNewUsers = sumKey(rows, 'new_users');

    // Months active: prefer explicit month_num roll-up; if absent, accept a
    // direct months_active column or count distinct entries from a months_list
    // string ("April, August, July, ...").
    const monthNums = new Set(
      rows.map((r) => r.month_num).filter((m) => m !== null && m !== undefined),
    );
    let monthsActive = monthNums.size;
    if (monthsActive === 0) {
      const directMonths = Math.max(
        0,
        ...rows.map((r) => num(r.months_active)),
      );
      const listMonths = Math.max(
        0,
        ...rows.map((r) => parseMonthsList(r.months_list).length),
      );
      monthsActive = Math.max(directMonths, listMonths);
    }

    const avgSessionDuration = meanKey(rows, 'avg_engagement_time');
    const avgViewsPerSession = meanKey(rows, 'views_per_session');

    // Engagement rate: prefer derived engaged/sessions; fall back to a direct
    // engagement_rate column on the row if engaged_sessions wasn't provided.
    let engagementRate = safeDiv(totalEngaged, totalSessions, 0);
    if (engagementRate === 0) {
      const directRate = Math.max(
        0,
        ...rows.map((r) => num(r.engagement_rate)),
      );
      if (directRate > 0 && directRate <= 1) engagementRate = directRate;
    }

    // Bounce rate: derive from engagement when possible, else accept the
    // workbook's own bounce_rate_raw column.
    let bounceRate = calculateBounceRate(totalEngaged, totalSessions);
    if (totalEngaged === 0) {
      const directBounce = Math.max(
        0,
        ...rows.map((r) => num(r.bounce_rate_raw)),
      );
      if (directBounce > 0 && directBounce <= 1) bounceRate = directBounce;
    }

    const eventsPerSession = safeDiv(totalEvents, totalSessions, 0);

    const record = {
      user_id: String(uid),
      effective_user_id: String(uid),
      total_sessions: totalSessions,
      total_engaged: totalEngaged,
      total_views: totalViews,
      total_events: totalEvents,
      total_new_users: totalNewUsers,
      months_active: monthsActive,
      avg_session_duration: avgSessionDuration,
      avg_views_per_session: avgViewsPerSession,
      engagement_rate: engagementRate,
      bounce_rate: bounceRate,
      events_per_session: eventsPerSession,
    };
    // Prefer an explicit User Type column from the source data if present.
    const sourceIdType = rows
      .map((r) => (r.id_type ? String(r.id_type).trim() : ''))
      .find((v) => v && v.length > 0);
    record.id_type = sourceIdType || classifyUserId(record.user_id);
    const score = userBotScore(record);
    record.bot_score = score;
    record.bot_classification = classifyBotScore(score);
    record.persona =
      score < HIGH_ENGAGEMENT_MAX_BOT_SCORE ? assignPersona(record) : 'Bot/Unverified';
    record.is_high_engagement =
      record.total_sessions >= HIGH_ENGAGEMENT_MIN_SESSIONS &&
      record.engagement_rate >= HIGH_ENGAGEMENT_MIN_RATE &&
      record.avg_session_duration >= HIGH_ENGAGEMENT_MIN_DURATION &&
      score < HIGH_ENGAGEMENT_MAX_BOT_SCORE;
    record.is_multi_month =
      record.months_active >= MULTI_MONTH_MIN_MONTHS &&
      record.total_sessions >= MULTI_MONTH_MIN_SESSIONS &&
      record.engagement_rate >= MULTI_MONTH_MIN_RATE;
    out.push(record);
  }
  return out;
}

function classifyPages(pageAgg) {
  return pageAgg.map((row) => {
    const path = String(row.page || '').toLowerCase();
    const bounce = num(row.bounce_rate);
    const sessions = num(row.sessions);
    let role;
    if (path === '/' || path === '/index' || path === '') role = 'Homepage';
    else if (path.includes('contact')) role = 'Conversion Page';
    else if (sessions >= UNICORN_MIN_SESSIONS && bounce <= UNICORN_MAX_BOUNCE)
      role = 'Unicorn';
    else if (sessions >= OPPORTUNITY_MIN_SESSIONS && bounce >= OPPORTUNITY_MIN_BOUNCE)
      role = 'High-Bounce Opportunity';
    else if (path.includes('blog') || path.includes('article') || path.includes('case'))
      role = 'Editorial';
    else if (path.includes('service') || path.includes('solution')) role = 'Service';
    else role = 'Supporting';
    return { ...row, content_role: role };
  });
}

function scoreCities(cityAgg) {
  return cityAgg.map((row) => {
    const score = cityBotScore(row);
    return { ...row, bot_score: score, bot_classification: classifyBotScore(score) };
  });
}

function scoreSources(sourceAgg) {
  return sourceAgg.map((row) => {
    const score = sourceBotScore(row);
    return { ...row, bot_score: score, bot_classification: classifyBotScore(score) };
  });
}

// ---------------------------------------------------------------------------
// Contact summary
// ---------------------------------------------------------------------------

function classifyContactRecords(records) {
  return (records || []).map((r) => ({
    ...r,
    lead_type: classifyContact(r.how_can_we_help),
  }));
}

function contactSummary(records) {
  if (!records || records.length === 0) {
    return {
      total: 0,
      by_type: {},
      by_pct: {},
      qualified: 0,
      qualified_pct: 0,
      noise: 0,
      noise_pct: 0,
      by_entry_page: [],
      monthly: [],
      service_interest: [],
      duplicates: { groups: 0, total_dupes: 0 },
      window: null,
    };
  }
  const counter = new Map();
  for (const r of records) {
    const k = r.lead_type || 'Unknown';
    counter.set(k, (counter.get(k) || 0) + 1);
  }
  const total = records.length;
  const byType = {};
  const byPct = {};
  const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    byType[k] = v;
    byPct[k] = total ? v / total : 0;
  }

  const qualifiedTypes = new Set(['Sales Lead', 'Partnership']);
  const noiseTypes = new Set(['Spam', 'Job Seeker']);
  const qualified = records.filter((r) => qualifiedTypes.has(r.lead_type)).length;
  const noise = records.filter((r) => noiseTypes.has(r.lead_type)).length;

  return {
    total,
    by_type: byType,
    by_pct: byPct,
    qualified,
    qualified_pct: total ? qualified / total : 0,
    noise,
    noise_pct: total ? noise / total : 0,
    by_entry_page: contactsByEntryPage(records),
    monthly: contactsMonthlyTrend(records),
    service_interest: serviceInterestTags(records),
    duplicates: detectDuplicateMessages(records),
    window: contactDateWindow(records),
  };
}

// ---------------------------------------------------------------------------
// Helpers used by the contact summary above.
// ---------------------------------------------------------------------------

const SERVICE_INTEREST_TAGS = [
  { label: 'MSP / Managed Services', keywords: ['msp', 'mmsp', 'managed it', 'managed service'] },
  { label: 'Cybersecurity', keywords: ['cybersecurity', 'cyber security', 'security policy', 'security posture', 'mfa', 'endpoint security'] },
  { label: 'CMMC Compliance', keywords: ['cmmc'] },
  { label: 'Microsoft 365 / Intune', keywords: ['microsoft 365', 'm365', 'office 365', 'intune', 'entra id', 'sharepoint', 'onedrive', 'exchange online'] },
  { label: 'Help Desk / IT Support', keywords: ['help desk', 'helpdesk', 'it support', '24/7 help'] },
  { label: 'Cloud / Infrastructure', keywords: ['cloud', 'cloud-first', 'cloud migration', 'cloud infrastructure', 'sharepoint'] },
  { label: 'Network / VoIP', keywords: ['voip', 'network', 'wifi', 'sip'] },
  { label: 'Hardware / Devices', keywords: ['hardware', 'laptops', 'device management', 'workstation', 'workstations'] },
  { label: 'Backup / DR', keywords: ['backup', 'disaster recovery', 'business continuity'] },
];

function pageHostname(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  // Strip protocol + host so /contact/ groups together regardless of host.
  return s.replace(/^https?:\/\/[^/]+/i, '') || '/';
}

function contactsByEntryPage(records) {
  const map = new Map();
  for (const r of records) {
    const path = pageHostname(r.conversion_page) || '(unknown)';
    if (!map.has(path)) {
      map.set(path, {
        page: path,
        total: 0,
        sales_leads: 0,
        partnerships: 0,
        support: 0,
        spam: 0,
        other: 0,
      });
    }
    const row = map.get(path);
    row.total += 1;
    switch (r.lead_type) {
      case 'Sales Lead':
        row.sales_leads += 1;
        break;
      case 'Partnership':
        row.partnerships += 1;
        break;
      case 'Support Request':
        row.support += 1;
        break;
      case 'Spam':
        row.spam += 1;
        break;
      default:
        row.other += 1;
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      qualified: r.sales_leads + r.partnerships,
      qualified_rate: r.total ? (r.sales_leads + r.partnerships) / r.total : 0,
    }))
    .sort((a, b) => b.sales_leads - a.sales_leads || b.total - a.total);
}

function excelSerialToDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n > 25 && n < 110000) {
    const ms = (n - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeyOf(d) {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function contactsMonthlyTrend(records) {
  const map = new Map();
  for (const r of records) {
    const d = excelSerialToDate(r.conversion_date);
    const key = monthKeyOf(d);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        month: key,
        date: d,
        total: 0,
        sales_leads: 0,
        partnerships: 0,
        support: 0,
        spam: 0,
        other: 0,
      });
    }
    const row = map.get(key);
    row.total += 1;
    switch (r.lead_type) {
      case 'Sales Lead':
        row.sales_leads += 1;
        break;
      case 'Partnership':
        row.partnerships += 1;
        break;
      case 'Support Request':
        row.support += 1;
        break;
      case 'Spam':
        row.spam += 1;
        break;
      default:
        row.other += 1;
    }
  }
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      label: row.date
        ? row.date.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : row.month,
    }));
}

function serviceInterestTags(records) {
  // Tags are derived only from messages that look like genuine prospects so
  // vendor outreach doesn't pollute the demand signal.
  const eligible = new Set(['Sales Lead', 'Support Request']);
  const counts = new Map();
  for (const r of records) {
    if (!eligible.has(r.lead_type)) continue;
    const text = String(r.how_can_we_help || '').toLowerCase();
    if (!text.trim()) continue;
    for (const tag of SERVICE_INTEREST_TAGS) {
      if (tag.keywords.some((k) => text.includes(k))) {
        counts.set(tag.label, (counts.get(tag.label) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function detectDuplicateMessages(records) {
  const map = new Map();
  for (const r of records) {
    const key = String(r.how_can_we_help || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  let groups = 0;
  let totalDupes = 0;
  for (const list of map.values()) {
    if (list.length > 1) {
      groups += 1;
      totalDupes += list.length - 1;
    }
  }
  return { groups, total_dupes: totalDupes };
}

function contactDateWindow(records) {
  let min = null;
  let max = null;
  for (const r of records) {
    const d = excelSerialToDate(r.conversion_date);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return null;
  const fmt = (d) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return { start: min.toISOString(), end: max.toISOString(), label: `${fmt(min)} – ${fmt(max)}` };
}

function userSummary(usersDf) {
  if (!usersDf || usersDf.length === 0) {
    return {
      total_ids: 0,
      clean_human: 0,
      confirmed_bot: 0,
      likely_bot: 0,
      suspicious: 0,
      high_engagement: 0,
      multi_month: 0,
      fractional: 0,
      amp: 0,
    };
  }
  const fractionalSet = new Set([
    'Cross-Device (.2)',
    'Google Signals (.17/.18)',
    'Fractional (other)',
  ]);
  let cleanHuman = 0;
  let confirmedBot = 0;
  let likelyBot = 0;
  let suspicious = 0;
  let highEng = 0;
  let multiMonth = 0;
  let fractional = 0;
  let amp = 0;
  for (const u of usersDf) {
    if (u.bot_classification === 'human') cleanHuman += 1;
    if (u.bot_classification === 'confirmed_bot') confirmedBot += 1;
    if (u.bot_classification === 'likely_bot') likelyBot += 1;
    if (u.bot_classification === 'suspicious') suspicious += 1;
    if (u.is_high_engagement) highEng += 1;
    if (u.is_multi_month) multiMonth += 1;
    if (fractionalSet.has(u.id_type)) fractional += 1;
    if (u.id_type === 'AMP') amp += 1;
  }
  return {
    total_ids: usersDf.length,
    clean_human: cleanHuman,
    confirmed_bot: confirmedBot,
    likely_bot: likelyBot,
    suspicious,
    high_engagement: highEng,
    multi_month: multiMonth,
    fractional,
    amp,
  };
}

function benchmarkUsers(usersDf) {
  if (!usersDf || usersDf.length === 0) return null;
  const high = usersDf.filter((u) => u.is_high_engagement);
  if (high.length === 0) return null;
  return {
    user_count: high.length,
    avg_session_duration: meanKey(high, 'avg_session_duration'),
    avg_views_per_session: meanKey(high, 'avg_views_per_session'),
    avg_events_per_session: meanKey(high, 'events_per_session'),
    avg_engagement_rate: meanKey(high, 'engagement_rate'),
    avg_months_active: meanKey(high, 'months_active'),
  };
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export function runAllAnalysis(parsed, opts = {}) {
  const rawTotals = opts.rawTotals || parsed?._rawTotals || {};
  const analysisSheets = opts.analysisSheets || parsed?._analysisSheets || {};
  const sourceRecords = parsed.source || [];
  const mediumRecords = parsed.medium || [];
  const deviceRecords = parsed.device || [];
  const cityRecords = parsed.city || [];
  const pageRecords = parsed.page_path || [];
  const userRecords = parsed.user || [];
  const contactRecords = parsed.contact || [];

  // Aggregations.
  let sourceAgg = aggregateWide(sourceRecords, 'Source');
  const mediumAgg = aggregateWide(mediumRecords, 'Medium');
  const deviceAgg = aggregateWide(deviceRecords, 'Device');
  let cityAgg = aggregateWide(cityRecords, 'City');
  let pageAgg = aggregateWide(pageRecords, 'Page');

  sourceAgg = scoreSources(sourceAgg);
  cityAgg = scoreCities(cityAgg);
  pageAgg = classifyPages(pageAgg);

  const usersDf = aggregateUsers(userRecords);
  const contactClassified = classifyContactRecords(contactRecords);

  // Monthly trends. Prefer medium; fall back to source.
  const monthlyBasis = mediumRecords.length ? mediumRecords : sourceRecords;
  const monthly = monthlyTotals(monthlyBasis);

  // Site totals.
  let siteSessions = 0;
  let siteEngaged = 0;
  let siteUsers = 0;
  let siteNewUsers = 0;
  if (mediumAgg.length) {
    siteSessions = sumKey(mediumAgg, 'sessions');
    siteEngaged = sumKey(mediumAgg, 'engaged_sessions');
    siteUsers = sumKey(mediumAgg, 'total_users');
    siteNewUsers = sumKey(mediumAgg, 'new_users');
  } else if (sourceAgg.length) {
    siteSessions = sumKey(sourceAgg, 'sessions');
    siteEngaged = sumKey(sourceAgg, 'engaged_sessions');
    siteUsers = sumKey(sourceAgg, 'total_users');
    siteNewUsers = sumKey(sourceAgg, 'new_users');
  }
  const siteBounce = calculateBounceRate(siteEngaged, siteSessions);
  const siteEngagementRate = safeDiv(siteEngaged, siteSessions, 0);
  const newUserRate = safeDiv(siteNewUsers, siteUsers, 0);

  // Organic — sessions and bounce. Prefer the medium classification "organic",
  // fall back to source = google/bing.
  let organicSessions = 0;
  let organicEngaged = 0;
  if (mediumAgg.length) {
    const organic = mediumAgg.filter((m) =>
      String(m.medium || '').toLowerCase().includes('organic'),
    );
    organicSessions = organic.reduce((acc, m) => acc + num(m.sessions, 0), 0);
    organicEngaged = organic.reduce((acc, m) => acc + num(m.engaged_sessions, 0), 0);
  }
  if (organicSessions === 0 && sourceAgg.length) {
    const organic = sourceAgg.filter((s) => {
      const name = String(s.source || '').toLowerCase();
      return name.includes('google') || name.includes('bing') || name.includes('duckduckgo') || name.includes('yahoo');
    });
    organicSessions = organic.reduce((acc, s) => acc + num(s.sessions, 0), 0);
    organicEngaged = organic.reduce((acc, s) => acc + num(s.engaged_sessions, 0), 0);
  }
  const organicBounce = calculateBounceRate(organicEngaged, organicSessions);

  // Direct — sessions and bounce.
  let directSessions = 0;
  let directEngaged = 0;
  if (mediumAgg.length) {
    const direct = mediumAgg.filter((m) => {
      const name = String(m.medium || '').toLowerCase().trim();
      return name === '(none)' || name === 'none' || name === 'direct' || name === '';
    });
    directSessions = direct.reduce((acc, m) => acc + num(m.sessions, 0), 0);
    directEngaged = direct.reduce((acc, m) => acc + num(m.engaged_sessions, 0), 0);
  }
  if (directSessions === 0 && sourceAgg.length) {
    const direct = sourceAgg.filter((s) => {
      const name = String(s.source || '').toLowerCase().trim();
      return name === '(direct)' || name === 'direct' || name === '(none)';
    });
    directSessions = direct.reduce((acc, s) => acc + num(s.sessions, 0), 0);
    directEngaged = direct.reduce((acc, s) => acc + num(s.engaged_sessions, 0), 0);
  }
  const directBounce = calculateBounceRate(directEngaged, directSessions);

  let contactPageSessions = 0;
  if (pageAgg.length) {
    contactPageSessions = pageAgg
      .filter((p) => String(p.page || '').toLowerCase().includes('contact'))
      .reduce((acc, p) => acc + num(p.sessions, 0), 0);
  }
  const contactSessionShare = safeDiv(contactPageSessions, siteSessions, 0);

  // Best-effort year inference from contact dates or filename hints.
  let reportYear = null;
  for (const c of contactRecords) {
    const raw = c.conversion_date || c.date;
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      reportYear = d.getFullYear();
      break;
    }
    const m = String(raw).match(/20\d{2}/);
    if (m) {
      reportYear = Number(m[0]);
      break;
    }
  }
  if (!reportYear && parsed.__year) reportYear = parsed.__year;

  const summary = {
    total_sessions: Math.round(siteSessions),
    engaged_sessions: Math.round(siteEngaged),
    total_users: Math.round(siteUsers),
    new_users: Math.round(siteNewUsers),
    new_user_rate: newUserRate,
    engagement_rate: siteEngagementRate,
    site_bounce_rate: siteBounce,
    site_avg_bounce_rate: siteBounce,
    organic_sessions: Math.round(organicSessions),
    organic_bounce_rate: organicBounce,
    direct_sessions: Math.round(directSessions),
    direct_bounce_rate: directBounce,
    contact_page_sessions: Math.round(contactPageSessions),
    contact_session_share: contactSessionShare,
    total_contact_submissions: contactClassified.length,
    report_period: 'January – December',
    report_year: reportYear || null,
  };

  // Bounce-rate page payload.
  const bouncePayload = {
    definition: 'Bounce Rate = 1 − (Engaged Sessions ÷ Total Sessions)',
    by_channel: [...mediumAgg].sort((a, b) => num(b.sessions) - num(a.sessions)),
    homepage_monthly: [],
    high_bounce_opportunities: [],
  };

  if (pageAgg.length) {
    bouncePayload.high_bounce_opportunities = [...pageAgg]
      .filter(
        (p) =>
          num(p.sessions) >= OPPORTUNITY_MIN_SESSIONS &&
          num(p.bounce_rate) >= OPPORTUNITY_MIN_BOUNCE,
      )
      .sort((a, b) => num(b.sessions) - num(a.sessions));
  }

  if (pageRecords.length) {
    const homepageLong = pageRecords.filter((r) => {
      const p = String(r.Page || '').trim();
      return p === '/' || p === '/index' || p === '/home';
    });
    if (homepageLong.length) {
      bouncePayload.homepage_monthly = monthlyTotals(homepageLong);
    }
  }

  const userSum = userSummary(usersDf);

  // ---- AI assistant detection -------------------------------------------
  // ChatGPT, Claude, Gemini, Perplexity, etc. behave like bots (low
  // engagement, read-and-leave) so the city/source bot rules will often flag
  // them. They are NOT bots — they are a distinct, valuable traffic category
  // that deserves its own bucket on the dashboard.
  const aiSourceKeys = new Set();
  const aiBuckets = new Map();
  for (const s of sourceAgg) {
    const name = detectAiSource(s.source);
    if (!name) continue;
    const key = String(s.source).toLowerCase().trim();
    aiSourceKeys.add(key);
    if (!aiBuckets.has(name)) {
      aiBuckets.set(name, {
        assistant: name,
        sessions: 0,
        sources: 0,
      engaged_sessions: 0,
        avg_engagement_time: 0,
        bounce_rate: 0,
        _bounce_numer: 0,
        _bounce_denom: 0,
        _eng_numer: 0,
        _eng_denom: 0,
      });
    }
    const b = aiBuckets.get(name);
    const sess = num(s.sessions, 0);
    b.sessions += sess;
    b.engaged_sessions += num(s.engaged_sessions, 0);
    b.sources += 1;
    if (sess > 0) {
      b._bounce_numer += num(s.bounce_rate, 0) * sess;
      b._bounce_denom += sess;
      b._eng_numer += num(s.avg_engagement_time, 0) * sess;
      b._eng_denom += sess;
    }
  }
  const aiAssistants = [...aiBuckets.values()]
    .map((b) => ({
      assistant: b.assistant,
      sessions: b.sessions,
      engaged_sessions: b.engaged_sessions,
      sources: b.sources,
      avg_engagement_time: b._eng_denom ? b._eng_numer / b._eng_denom : 0,
      bounce_rate: b._bounce_denom ? b._bounce_numer / b._bounce_denom : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
  const aiAssistantSessions = aiAssistants.reduce(
    (sum, a) => sum + a.sessions,
    0,
  );

  // ---- Session classification — by visitor city -------------------------
  // Each city carries a single classification, so this view is binary per
  // city: a datacenter scoring 7+ contributes ALL its sessions to confirmed.
  let cityConfirmed = 0;
  let cityLikely = 0;
  let citySuspicious = 0;
  let cityHuman = 0;
  let cityConfirmedEngaged = 0;
  let cityLikelyEngaged = 0;
  let citySuspiciousEngaged = 0;
  let cityHumanEngaged = 0;
  for (const c of cityAgg) {
    const s = num(c.sessions, 0);
    const engaged = num(c.engaged_sessions, 0);
    if (c.bot_classification === 'confirmed_bot') {
      cityConfirmed += s;
      cityConfirmedEngaged += engaged;
    } else if (c.bot_classification === 'likely_bot') {
      cityLikely += s;
      cityLikelyEngaged += engaged;
    } else if (c.bot_classification === 'suspicious') {
      citySuspicious += s;
      citySuspiciousEngaged += engaged;
    } else {
      cityHuman += s;
      cityHumanEngaged += engaged;
    }
  }

  // ---- Session classification — by traffic source -----------------------
  // Same buckets, but scored against referrer/source rules. Sources tend to
  // produce a richer gradient (some referrers are clearly spam, others are
  // borderline) which is what populates Likely / Suspicious when cities are
  // all-or-nothing. AI assistant sessions are pulled out so they don't
  // contaminate either side.
  let srcConfirmed = 0;
  let srcLikely = 0;
  let srcSuspicious = 0;
  let srcHuman = 0;
  let confirmedSourceCount = 0;
  for (const s of sourceAgg) {
    const key = String(s.source).toLowerCase().trim();
    if (aiSourceKeys.has(key)) continue;
    const sess = num(s.sessions, 0);
    if (s.bot_classification === 'confirmed_bot') {
      srcConfirmed += sess;
      confirmedSourceCount += 1;
    } else if (s.bot_classification === 'likely_bot') srcLikely += sess;
    else if (s.bot_classification === 'suspicious') srcSuspicious += sess;
    else srcHuman += sess;
  }

  // Distinct confirmed-bot cities (count of city rows whose bot_score crossed
  // the confirmed threshold). Pairs with confirmedSourceCount in the KPIs.
  let confirmedCityCount = 0;
  for (const c of cityAgg) {
    if (c.bot_classification === 'confirmed_bot') confirmedCityCount += 1;
  }

  // ---- Headline session counts ------------------------------------------
  // Use one real partition for session KPIs. City rows are mutually exclusive
  // for a session, while city + source cannot be unioned from GA4 aggregates
  // without session-level data. Source scoring stays exposed as its own lens.
  const headlineConfirmed = cityConfirmed;
  const headlineLikely = cityLikely;
  const headlineSuspicious = citySuspicious;
  const headlineHuman = cityHuman;
  const cityClassifiedSessions =
    cityConfirmed + cityLikely + citySuspicious + cityHuman;
  const cityClassifiedEngaged =
    cityConfirmedEngaged +
    cityLikelyEngaged +
    citySuspiciousEngaged +
    cityHumanEngaged;
  const confirmedRemovedSessions = cityClassifiedSessions - cityConfirmed;
  const confirmedRemovedEngaged = cityClassifiedEngaged - cityConfirmedEngaged;
  const confirmedLikelyRemovedSessions =
    cityClassifiedSessions - cityConfirmed - cityLikely;
  const confirmedLikelyRemovedEngaged =
    cityClassifiedEngaged - cityConfirmedEngaged - cityLikelyEngaged;
  const humanOnlySessions = cityHuman;
  const humanOnlyEngaged = cityHumanEngaged;

  const botsPayload = {
    summary: {
      // Headline counts (city-level session partition)
      confirmed_bot_sessions: Math.round(headlineConfirmed),
      likely_bot_sessions: Math.round(headlineLikely),
      suspicious_sessions: Math.round(headlineSuspicious),
      human_sessions: Math.round(headlineHuman),
      classified_sessions: Math.round(cityClassifiedSessions),
      classified_engaged_sessions: Math.round(cityClassifiedEngaged),
      classified_bounce_rate: calculateBounceRate(
        cityClassifiedEngaged,
        cityClassifiedSessions,
      ),
      confirmed_bot_engaged_sessions: Math.round(cityConfirmedEngaged),
      likely_bot_engaged_sessions: Math.round(cityLikelyEngaged),
      suspicious_engaged_sessions: Math.round(citySuspiciousEngaged),
      human_engaged_sessions: Math.round(cityHumanEngaged),
      confirmed_removed_sessions: Math.round(confirmedRemovedSessions),
      confirmed_removed_engaged_sessions: Math.round(confirmedRemovedEngaged),
      confirmed_removed_bounce_rate: calculateBounceRate(
        confirmedRemovedEngaged,
        confirmedRemovedSessions,
      ),
      confirmed_likely_removed_sessions: Math.round(confirmedLikelyRemovedSessions),
      confirmed_likely_removed_engaged_sessions: Math.round(
        confirmedLikelyRemovedEngaged,
      ),
      confirmed_likely_removed_bounce_rate: calculateBounceRate(
        confirmedLikelyRemovedEngaged,
        confirmedLikelyRemovedSessions,
      ),
      human_only_sessions: Math.round(humanOnlySessions),
      human_only_engaged_sessions: Math.round(humanOnlyEngaged),
      human_only_bounce_rate: calculateBounceRate(humanOnlyEngaged, humanOnlySessions),

      // Transparent secondary lenses — each row sums to total sessions
      city_confirmed_bot_sessions: Math.round(cityConfirmed),
      city_likely_bot_sessions: Math.round(cityLikely),
      city_suspicious_sessions: Math.round(citySuspicious),
      city_human_sessions: Math.round(cityHuman),
      source_confirmed_bot_sessions: Math.round(srcConfirmed),
      source_likely_bot_sessions: Math.round(srcLikely),
      source_suspicious_sessions: Math.round(srcSuspicious),
      source_human_sessions: Math.round(srcHuman),

      // Distinct dimensions that crossed the confirmed-bot threshold.
      // Useful as a "how many bots are we actively fighting?" metric.
      confirmed_bot_source_count: confirmedSourceCount,
      confirmed_bot_city_count: confirmedCityCount,

      // AI assistant traffic (ChatGPT, Claude, Gemini, Perplexity, etc.) —
      // separate category, NOT bot, NOT human-organic.
      ai_assistant_sessions: Math.round(aiAssistantSessions),
      ai_assistant_engaged_sessions: Math.round(
        aiAssistants.reduce((sum, a) => sum + num(a.engaged_sessions, 0), 0),
      ),
      ai_assistant_count: aiAssistants.length,
      ai_assistant_bounce_rate: aiAssistantSessions
        ? aiAssistants.reduce((sum, a) => sum + num(a.bounce_rate, 0) * num(a.sessions, 0), 0) /
          aiAssistantSessions
        : 0,

      // User-ID gradient (separate measurement angle, from User sheet)
      bot_user_ids: (userSum.confirmed_bot || 0) + (userSum.likely_bot || 0),
      confirmed_bot_user_ids: userSum.confirmed_bot || 0,
      likely_bot_user_ids: userSum.likely_bot || 0,
      suspicious_user_ids: userSum.suspicious || 0,
      fractional_user_ids: userSum.fractional || 0,
      total_user_ids: userSum.total_ids || 0,
      human_user_ids: userSum.clean_human || 0,
    },
    ai_assistants: aiAssistants,
    cities: [...cityAgg].sort((a, b) => num(b.sessions) - num(a.sessions)).slice(0, 60),
    sources: [...sourceAgg].sort((a, b) => num(b.sessions) - num(a.sessions)),
    methodology: {
      city_rules: [
        'Avg engagement < 1.0s with > 50 sessions = +4',
        'Avg engagement < 3.0s with > 30 sessions = +2',
        'Bounce rate ≥ 90% = +4',
        'Bounce rate ≥ 75% = +2',
        'Return rate < 2% with > 50 sessions = +2',
        'City in known datacenter list = +3',
        'Events/session < 1 with > 20 sessions = +2',
      ],
      source_rules: [
        'Avg engagement < 2.0s with > 20 sessions = +3',
        'Bounce rate ≥ 90% with > 10 sessions = +4',
        'Return rate < 1% with > 20 sessions = +2',
        'Source in known spam list = +5',
      ],
      user_rules: [
        'User ID ends in `.2` (Cross-Device merge) = +1',
        'User ID starts with `amp-` (AMP fallback ID) = +1',
        'Has sessions but zero engaged sessions = +3',
        'Avg duration < 2s with > 3 sessions = +2',
        'Zero page views with at least 1 session = +2',
        '> 10 sessions with engagement rate < 10% = +2',
      ],
      thresholds: {
        confirmed_bot: '≥ 7',
        likely_bot: '4 – 6',
        suspicious: '2 – 3',
        human: '0 – 1',
      },
      datacenter_cities: [...KNOWN_DATACENTER_CITIES],
      spam_sources: [...KNOWN_SPAM_SOURCES],
      ai_sources_detected: aiAssistants.map((a) => a.assistant),
    },
  };

  const pagesSorted = [...pageAgg].sort((a, b) => num(b.sessions) - num(a.sessions));
  const unicorns = pagesSorted
    .filter(
      (p) =>
        num(p.sessions) >= UNICORN_MIN_SESSIONS &&
        num(p.bounce_rate) <= UNICORN_MAX_BOUNCE,
    )
    .sort((a, b) => num(a.bounce_rate) - num(b.bounce_rate));
  const opportunities = pagesSorted.filter(
    (p) =>
      num(p.sessions) >= OPPORTUNITY_MIN_SESSIONS &&
      num(p.bounce_rate) >= OPPORTUNITY_MIN_BOUNCE,
  );
  const highReachEngagementPages = pagesSorted
    .filter((p) => num(p.sessions) >= OPPORTUNITY_MIN_SESSIONS)
    .map((p) => ({
      ...p,
      engaged_reach: num(p.engaged_sessions, 0),
      clean_engagement_rate: safeDiv(num(p.engaged_sessions, 0), num(p.sessions, 0), 0),
    }))
    .sort((a, b) => {
      const engagedDelta = num(b.engaged_reach) - num(a.engaged_reach);
      if (engagedDelta !== 0) return engagedDelta;
      return num(b.clean_engagement_rate) - num(a.clean_engagement_rate);
    });

  let contactMonthly = [];
  if (pageRecords.length) {
    const contactLong = pageRecords.filter((r) =>
      String(r.Page || '').toLowerCase().includes('contact'),
    );
    if (contactLong.length) contactMonthly = monthlyTotals(contactLong);
  }

  const pagesPayload = {
    top_pages: pagesSorted.slice(0, 25),
    all_pages_count: pagesSorted.length,
    contact_monthly: contactMonthly,
    high_reach_engagement_pages: highReachEngagementPages.slice(0, 25),
  };

  const sortedUsers = [...usersDf].sort(
    (a, b) => num(b.total_sessions) - num(a.total_sessions),
  );
  const benchmarks = benchmarkUsers(usersDf);
  const contactSum = contactSummary(contactClassified);

  const sortedSources = [...sourceAgg].sort((a, b) => num(b.sessions) - num(a.sessions));
  const sortedDevices = [...deviceAgg].sort((a, b) => num(b.sessions) - num(a.sessions));
  const sortedCities = [...cityAgg].sort((a, b) => num(b.sessions) - num(a.sessions));

  const verification = runVerifier({
    parsed,
    rawTotals,
    summary,
    monthly,
    mediumAgg,
    sourceAgg,
    deviceAgg,
    pageAgg,
  });

  // Calculation accuracy matrix — every headline KPI computed from every
  // available data sheet, plus any hand-typed KPI cells we found in the
  // user's "Executive Summary"-style tabs.
  const accuracy = runAccuracyCheck({
    parsed,
    analysisSheets,
    summary,
    monthly,
    rawTotals,
  });

  // Decorate exposed rows with the Engagement Quality Score so every table
  // and chart can pick it up without recomputing.
  const sourcesWithEqs = decorateWithEqs(sortedSources);
  const devicesWithEqs = decorateWithEqs(sortedDevices);
  const citiesWithEqs = decorateWithEqs(sortedCities);
  const pagesSortedWithEqs = decorateWithEqs(pagesSorted);
  const unicornsWithEqs = decorateWithEqs(unicorns);
  const opportunitiesWithEqs = decorateWithEqs(opportunities);
  const highReachEngagementWithEqs = decorateWithEqs(highReachEngagementPages);

  const pagesPayloadEnriched = {
    ...pagesPayload,
    top_pages: pagesSortedWithEqs.slice(0, 25),
    high_reach_engagement_pages: highReachEngagementWithEqs.slice(0, 25),
  };
  bouncePayload.high_reach_engagement_pages = highReachEngagementWithEqs.slice(0, 25);

  const unique = runUniqueAnalytics({
    summary,
    monthly,
    sources: sourcesWithEqs,
    devices: devicesWithEqs,
    cities: citiesWithEqs,
    pages: pagesSortedWithEqs,
    users: sortedUsers,
    usersSummary: userSum,
    bots: botsPayload,
    contactsSummary: contactSum,
    verification,
    metadata: parsed?.metadata || {},
  });

  // Bounce-rate industry benchmark (Excellent / Good / Average / Poor) plus
  // dataset-specific recommendations.
  const benchmark = runBounceBenchmark({
    summary,
    bounce: bouncePayload,
    monthly,
    pages: { top_pages: pagesSortedWithEqs.slice(0, 50) },
    bots: botsPayload.summary,
    unicorns: unicornsWithEqs,
  });
  bouncePayload.benchmark = benchmark;

  // Dynamic top-10 insights — runs LAST so it can read everything the
  // dashboard sees (anomalies, concentration, trust, unicorns, …). Each
  // insight is interpolated from live numbers so a different upload
  // produces a different list.
  const insights = buildTopInsights(
    {
      summary,
      monthly,
      bounce: bouncePayload,
      sources: sourcesWithEqs,
      pages: pagesPayloadEnriched,
      unicorns: unicornsWithEqs,
      opportunities: opportunitiesWithEqs,
      users: sortedUsers,
      users_summary: userSum,
      contacts_summary: contactSum,
      bots: botsPayload,
      unique,
    },
    10,
  );

  return {
    summary,
    monthly,
    bounce: bouncePayload,
    sources: sourcesWithEqs,
    devices: devicesWithEqs,
    cities: citiesWithEqs,
    pages: pagesPayloadEnriched,
    unicorns: unicornsWithEqs,
    opportunities: opportunitiesWithEqs,
    users: sortedUsers,
    users_summary: userSum,
    users_benchmarks: benchmarks,
    contacts: contactClassified,
    contacts_summary: contactSum,
    bots: botsPayload,
    insights,
    verification,
    accuracy,
    raw_totals: rawTotals,
    unique,
  };
}
