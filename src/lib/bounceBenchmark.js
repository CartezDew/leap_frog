// Bounce-rate benchmark engine.
//
// Two responsibilities:
//   1. Place observed bounce rates (site-wide, per-channel, per-page) on the
//      industry tier scale (Excellent / Good / Average / Poor).
//   2. Generate dataset-specific recommendations — every sentence references a
//      real page/channel/month from the analyzed payload, never generic copy.

import {
  BOUNCE_BENCHMARK_TIERS,
  BOUNCE_INDUSTRY_MEDIAN,
} from './skillConfig.js';

const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

function clip01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ---------------------------------------------------------------------------
// Tier placement
// ---------------------------------------------------------------------------

export function tierForRate(rate) {
  const r = clip01(num(rate));
  for (const tier of BOUNCE_BENCHMARK_TIERS) {
    if (r >= tier.min && r < tier.max) return tier;
  }
  // Edge case: rate === 1.
  return BOUNCE_BENCHMARK_TIERS[BOUNCE_BENCHMARK_TIERS.length - 1];
}

// Distance to the industry median, expressed in percentage points (positive =
// the site is below median, i.e. healthier).
export function deltaVsMedian(rate) {
  return BOUNCE_INDUSTRY_MEDIAN - clip01(num(rate));
}

// Position on the 0–100% scale as a 0..1 fraction (used for the marker).
export function scalePosition(rate) {
  return clip01(num(rate));
}

// ---------------------------------------------------------------------------
// Site / channel / page placements
// ---------------------------------------------------------------------------

function placement(rate) {
  return {
    rate: num(rate),
    tier: tierForRate(rate),
    position: scalePosition(rate),
    delta_vs_median: deltaVsMedian(rate),
  };
}

function buildChannelPlacements(channels) {
  return (channels || [])
    .filter((c) => num(c.sessions) > 0)
    .map((c) => ({
      name: c.medium,
      sessions: num(c.sessions),
      engaged_sessions: num(c.engaged_sessions),
      bounce_rate: num(c.bounce_rate),
      ...placement(c.bounce_rate),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

function buildPagePlacements(pages) {
  return (pages || [])
    .filter((p) => num(p.sessions) > 0)
    .map((p) => ({
      name: p.page,
      sessions: num(p.sessions),
      bounce_rate: num(p.bounce_rate),
      avg_engagement_time: num(p.avg_engagement_time),
      content_role: p.content_role || null,
      ...placement(p.bounce_rate),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ---------------------------------------------------------------------------
// Distribution: how much of the site's session volume sits in each tier?
// ---------------------------------------------------------------------------

function tierDistribution(channels) {
  const buckets = BOUNCE_BENCHMARK_TIERS.map((tier) => ({
    ...tier,
    sessions: 0,
    channel_count: 0,
    channels: [],
  }));
  let totalSessions = 0;

  (channels || []).forEach((c) => {
    const sessions = num(c.sessions);
    if (sessions <= 0) return;
    const tier = tierForRate(c.bounce_rate);
    const bucket = buckets.find((b) => b.id === tier.id);
    bucket.sessions += sessions;
    bucket.channel_count += 1;
    bucket.channels.push(c.medium);
    totalSessions += sessions;
  });

  return buckets.map((b) => ({
    ...b,
    share: totalSessions ? b.sessions / totalSessions : 0,
    total_sessions: totalSessions,
  }));
}

// ---------------------------------------------------------------------------
// Recommendation engine — every recommendation is data-grounded.
// ---------------------------------------------------------------------------

function fmtPct(rate, digits = 1) {
  if (!Number.isFinite(num(rate))) return '—';
  return `${(num(rate) * 100).toFixed(digits)}%`;
}

function fmtInt(v) {
  return num(v).toLocaleString('en-US');
}

function recommendForChannels(channelPlacements) {
  // Find channels worse than the industry median *and* with material volume.
  const candidates = channelPlacements
    .filter((c) => c.bounce_rate > BOUNCE_INDUSTRY_MEDIAN)
    .filter((c) => c.sessions >= 50);

  if (candidates.length === 0) return null;

  // Biggest opportunity = highest sessions × bounce gap above the "Good"
  // ceiling (40%). This is volume-weighted savings if the channel were lifted
  // to industry "Good".
  const targetRate = 0.4;
  const ranked = candidates
    .map((c) => ({
      ...c,
      gap: c.bounce_rate - targetRate,
      reclaimable_sessions: Math.max(
        0,
        Math.round(c.sessions * (c.bounce_rate - targetRate)),
      ),
    }))
    .sort((a, b) => b.reclaimable_sessions - a.reclaimable_sessions);

  const top = ranked[0];
  return {
    id: 'channel-fix',
    severity: top.tier.id === 'poor' ? 'critical' : 'high',
    title: `Lift ${top.name} bounce from ${fmtPct(top.bounce_rate, 1)} toward 40%`,
    body: `${top.name} drives ${fmtInt(
      top.sessions,
    )} sessions but bounces at ${fmtPct(
      top.bounce_rate,
      1,
    )} — ${(top.bounce_rate - BOUNCE_INDUSTRY_MEDIAN >= 0 ? 'above' : 'below')} the B2B services median of ${fmtPct(
      BOUNCE_INDUSTRY_MEDIAN,
      1,
    )}. Closing the gap to the "Good" band would re-engage roughly ${fmtInt(
      top.reclaimable_sessions,
    )} sessions per year.`,
    evidence: `Source: medium sheet · channel "${top.name}" · ${fmtInt(
      top.sessions,
    )} sessions · ${fmtPct(top.bounce_rate, 1)} bounce`,
    target: top.name,
    metric: top.bounce_rate,
    other_offenders: ranked
      .slice(1, 4)
      .map((c) => ({ name: c.name, sessions: c.sessions, bounce_rate: c.bounce_rate })),
  };
}

function recommendForPages(pagePlacements) {
  // High-traffic pages bouncing >= "Average" ceiling (55%) get the spotlight.
  const offenders = pagePlacements
    .filter((p) => p.sessions >= 100 && p.bounce_rate >= 0.45)
    .sort((a, b) => b.sessions * b.bounce_rate - a.sessions * a.bounce_rate);

  if (offenders.length === 0) return null;

  const top = offenders[0];
  const role = top.content_role ? ` (role: ${top.content_role})` : '';
  return {
    id: 'page-fix',
    severity: top.tier.id === 'poor' ? 'critical' : 'high',
    title: `Rework ${top.name}${role}`,
    body: `${top.name} sees ${fmtInt(
      top.sessions,
    )} sessions at a ${fmtPct(top.bounce_rate, 1)} bounce — placing it in the "${top.tier.label}" band. Average engagement time on this page is ${top.avg_engagement_time.toFixed(
      1,
    )}s. Audit the above-the-fold copy, internal links, and CTAs first.`,
    evidence: `Source: page_path sheet · path "${top.name}" · ${fmtInt(
      top.sessions,
    )} sessions · ${fmtPct(top.bounce_rate, 1)} bounce · ${top.avg_engagement_time.toFixed(
      1,
    )}s avg engagement`,
    target: top.name,
    metric: top.bounce_rate,
    other_offenders: offenders
      .slice(1, 4)
      .map((p) => ({
        name: p.name,
        sessions: p.sessions,
        bounce_rate: p.bounce_rate,
        avg_engagement_time: p.avg_engagement_time,
      })),
  };
}

function recommendFromUnicorns(analyzed) {
  // Use unicorns (best-engaging pages) as a "copy what works" recommendation,
  // anchored to actual best performer in the dataset.
  const unicorns = analyzed.unicorns || [];
  if (unicorns.length === 0) return null;
  const sorted = [...unicorns].sort((a, b) => num(a.bounce_rate) - num(b.bounce_rate));
  const top = sorted[0];
  if (!top) return null;
  return {
    id: 'unicorn-borrow',
    severity: 'opportunity',
    title: `Mirror ${top.page}`,
    body: `${top.page} bounces at just ${fmtPct(
      top.bounce_rate,
      1,
    )} on ${fmtInt(top.sessions)} sessions — your best-in-class engagement template. Reuse its hero, internal-link pattern, and CTA layout on the offenders above.`,
    evidence: `Source: page_path sheet · path "${top.page}" · ${fmtInt(
      top.sessions,
    )} sessions · ${fmtPct(top.bounce_rate, 1)} bounce`,
    target: top.page,
    metric: top.bounce_rate,
    other_offenders: sorted.slice(1, 4).map((p) => ({
      name: p.page,
      sessions: num(p.sessions),
      bounce_rate: num(p.bounce_rate),
    })),
  };
}

function recommendFromMonthlyTrend(analyzed) {
  // Volatility recommendation: tie a bounce spike month to a real value from
  // the monthly array, plus contrast with the best month.
  const monthly = analyzed.monthly || [];
  if (monthly.length < 3) return null;

  const valid = monthly.filter((m) => Number.isFinite(num(m.bounce_rate)));
  if (valid.length < 3) return null;

  const best = [...valid].sort((a, b) => num(a.bounce_rate) - num(b.bounce_rate))[0];
  const worst = [...valid].sort((a, b) => num(b.bounce_rate) - num(a.bounce_rate))[0];
  const gap = num(worst.bounce_rate) - num(best.bounce_rate);

  if (gap < 0.05) return null;

  return {
    id: 'seasonality',
    severity: 'medium',
    title: `Investigate ${worst.month_name}'s bounce spike`,
    body: `${worst.month_name} bounced at ${fmtPct(
      worst.bounce_rate,
      1,
    )} (${fmtInt(worst.sessions)} sessions) versus ${fmtPct(
      best.bounce_rate,
      1,
    )} in ${best.month_name} — a ${(gap * 100).toFixed(
      1,
    )}-point swing. Compare campaigns, top landing pages, and traffic mix between the two months to isolate the cause.`,
    evidence: `Source: medium / page_path sheets aggregated by month · spike ${fmtPct(
      worst.bounce_rate,
      1,
    )} (${worst.month_name}) vs trough ${fmtPct(best.bounce_rate, 1)} (${best.month_name})`,
    target: worst.month_name,
    metric: worst.bounce_rate,
  };
}

function recommendFromBots(analyzed) {
  // If bot share is meaningful, tell them filtering will *improve* their
  // benchmark position because automated traffic inflates bounce.
  const bots = analyzed.bots || {};
  const summary = analyzed.summary || {};
  const totalSessions = num(summary.total_sessions);
  const botSessions = num(bots.confirmed_bot_sessions || bots.confirmed_sessions);
  if (totalSessions <= 0 || botSessions <= 0) return null;

  const share = botSessions / totalSessions;
  if (share < 0.03) return null;

  return {
    id: 'filter-bots',
    severity: 'medium',
    title: `Filter ${fmtInt(botSessions)} bot sessions to clean the benchmark`,
    body: `${fmtPct(share, 1)} of sessions originate from confirmed-bot signatures. Excluding them in GA4 (or via the bot-classification table on this dashboard) typically drops site-wide bounce 1–3 points and gives you a truer position on the industry scale.`,
    evidence: `Source: bot classification module · ${fmtInt(
      botSessions,
    )} confirmed-bot sessions of ${fmtInt(totalSessions)} total`,
    target: 'Bot traffic',
    metric: share,
  };
}

// ---------------------------------------------------------------------------
// Master entrypoint
// ---------------------------------------------------------------------------

export function runBounceBenchmark(analyzed) {
  if (!analyzed || !analyzed.bounce) {
    return {
      tiers: BOUNCE_BENCHMARK_TIERS,
      industry_median: BOUNCE_INDUSTRY_MEDIAN,
      site: null,
      channels: [],
      pages: [],
      distribution: [],
      recommendations: [],
    };
  }

  const summary = analyzed.summary || {};
  const siteRate = num(
    summary.site_avg_bounce_rate ?? analyzed.bounce.site_avg_bounce_rate,
  );

  const channels = buildChannelPlacements(analyzed.bounce.by_channel);
  const pages = buildPagePlacements(
    analyzed.pages?.top_pages || analyzed.pages?.pages || [],
  );

  const distribution = tierDistribution(analyzed.bounce.by_channel);

  const recommendations = [
    recommendForChannels(channels),
    recommendForPages(pages),
    recommendFromBots(analyzed),
    recommendFromMonthlyTrend(analyzed),
    recommendFromUnicorns(analyzed),
  ].filter(Boolean);

  return {
    tiers: BOUNCE_BENCHMARK_TIERS,
    industry_median: BOUNCE_INDUSTRY_MEDIAN,
    site: {
      rate: siteRate,
      ...placement(siteRate),
    },
    channels,
    pages,
    distribution,
    recommendations,
  };
}
