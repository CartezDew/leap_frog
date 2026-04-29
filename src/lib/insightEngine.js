// Dynamic Top-10 insight engine.
//
// Each candidate signal below evaluates the analyzed payload and returns
// EITHER a single insight `{ id, title, evidence, category, severity, priority }`
// OR `null` if there isn't enough data to support it. Signals never use
// hard-coded text or canned facts — every word is interpolated from the
// dataset, so a different upload yields a different top 10.
//
// `category` (the action verb shown in the priority pill):
//   critical    — must address before the next reporting cycle
//   fix         — concrete problem with a known remedy
//   filter      — data-quality / hygiene issue
//   investigate — anomaly worth digging into
//   understand  — context the team should internalise
//   leverage    — strength to exploit
//   scale       — high-quality channel to invest more in
//   watch       — emerging signal to monitor over time
//
// `priority` is the legacy 3-bucket field other parts of the app (chat
// engine, ActionableInsights page) still read — we map category -> priority
// so nothing else has to change.

import { detectAiSource } from './levers.js';

const CATEGORY_PRIORITY = {
  critical: 'high',
  fix: 'high',
  scale: 'high',
  filter: 'medium',
  investigate: 'medium',
  understand: 'low',
  leverage: 'low',
  watch: 'low',
};

export const CATEGORY_META = {
  critical: { label: 'Critical', tone: 'red' },
  fix: { label: 'Fix', tone: 'amber' },
  scale: { label: 'Scale', tone: 'red' },
  filter: { label: 'Filter', tone: 'amber' },
  investigate: { label: 'Investigate', tone: 'amber' },
  understand: { label: 'Understand', tone: 'amber' },
  leverage: { label: 'Leverage', tone: 'green' },
  watch: { label: 'Watch', tone: 'green' },
};

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtInt(v) {
  const n = num(v);
  return Math.round(n).toLocaleString('en-US');
}

function fmtPct(v, digits = 1) {
  const n = num(v);
  return `${(n * 100).toFixed(digits)}%`;
}

// `playbook` (optional) gives the reader a deeper "what this means / how to
// fix it" panel. Schema:
//   {
//     meaning:       string  — plain-English interpretation of the signal
//     actions:       string[] — ordered, concrete remediation steps
//     where_to_look: { label, route }? — pointer to the relevant dashboard tab
//   }
function pickInsight(args) {
  return {
    id: args.id,
    title: args.title,
    evidence: args.evidence,
    category: args.category,
    priority: CATEGORY_PRIORITY[args.category] || 'low',
    severity: args.severity,
    playbook: args.playbook || null,
  };
}

// ---------------------------------------------------------------------------
// Signals — each returns 0 or 1 insight
// ---------------------------------------------------------------------------

function siteBounceSignal(analyzed) {
  const rate = num(analyzed?.summary?.site_bounce_rate);
  if (!rate) return null;
  if (rate >= 0.6) {
    return pickInsight({
      id: 'site-bounce-critical',
      category: 'critical',
      severity: 95 + Math.min(5, (rate - 0.6) * 25),
      title: `Site-wide bounce rate is critically high at ${fmtPct(rate)}`,
      evidence: `More than half of all visitors leave without engaging. Audit top landing pages and traffic-quality before any new acquisition spend.`,
      playbook: {
        meaning: `${fmtPct(rate)} of visitors arrive on a page and leave without a click, scroll, or second pageview. The benchmark for B2B services is 40–50%; you're well above that, which means most of the ad spend, SEO work, and referral traffic landing on the site is going to waste.`,
        actions: [
          'Open the Page Path Analysis tab and sort by Bounce % — the top 5–10 pages drive the average.',
          'For each high-bounce page: check that the H1 matches the headline of the ad/search query that sent the visitor there (message-match).',
          'Move the primary CTA above the fold and shorten intro copy to ≤ 3 lines before the value prop.',
          'Pause or re-target any paid campaign whose landing page sits in the worst 10% — you are paying to bounce.',
          'Re-run the analysis after 30 days and compare the bounce rate trend on those specific pages.',
        ],
        where_to_look: { label: 'Page Path Analysis', route: '/pages' },
      },
    });
  }
  if (rate >= 0.5) {
    return pickInsight({
      id: 'site-bounce-fix',
      category: 'fix',
      severity: 80,
      title: `Site bounce rate trending high at ${fmtPct(rate)}`,
      evidence: `Above the 50% threshold where engagement quality starts hurting acquisition ROI. Investigate top landing pages for messaging fit.`,
      playbook: {
        meaning: `Roughly half of visitors leave on the page they land on. That isn't catastrophic, but it's the threshold where each new dollar of acquisition spend starts producing diminishing returns — you're filling a leaky bucket.`,
        actions: [
          'Identify the 3 top-traffic pages with bounce above the site average — these usually account for most of the leak.',
          'Audit message-match: does the page headline mirror what the visitor clicked to get here (ad copy, SERP title, referral context)?',
          'Make the primary action obvious in the first viewport (clear CTA, supporting trust signal, no hero-only walls of text).',
          'Add 2–3 internal links to genuinely related pages so curious visitors have a next step that isn\'t "back".',
          'Re-check the Bounce Rate tab after the next monthly export — target a 5-point drop on the audited pages.',
        ],
        where_to_look: { label: 'Bounce Rate', route: '/bounce' },
      },
    });
  }
  if (rate <= 0.35) {
    return pickInsight({
      id: 'site-bounce-leverage',
      category: 'leverage',
      severity: 45,
      title: `Healthy site bounce rate at ${fmtPct(rate)}`,
      evidence: `Below the 40% benchmark — visitors are finding what they came for. Use these patterns as the bar for new pages.`,
    });
  }
  return null;
}

function botFilterSignal(analyzed) {
  const bots = analyzed?.bots?.summary || {};
  const total = num(analyzed?.summary?.total_sessions);
  const confirmed = num(bots.confirmed_bot_sessions);
  if (!total || !confirmed) return null;
  const share = confirmed / total;
  if (share < 0.03) return null;
  return pickInsight({
    id: 'bot-filter',
    category: 'filter',
    severity: 60 + Math.min(25, share * 100),
    title: `Bot traffic is inflating reported volume by ${fmtPct(share)}`,
    evidence: `${fmtInt(confirmed)} confirmed-bot sessions across ${fmtInt(num(bots.bot_user_ids))} bot user IDs. Filter these out before reporting figures to leadership.`,
  });
}

function topChannelSignal(analyzed) {
  const sources = analyzed?.sources || [];
  const total = num(analyzed?.summary?.total_sessions);
  if (!sources.length || !total) return null;
  const candidates = sources.filter((s) => {
    if (s.bot_classification !== 'human') return false;
    if (detectAiSource(s.source)) return false;
    if (num(s.sessions) < Math.max(50, total * 0.03)) return false;
    return num(s.engagement_rate) >= 0.5;
  });
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      num(b.engagement_rate) * num(b.sessions) -
      num(a.engagement_rate) * num(a.sessions),
  );
  const top = candidates[0];
  const share = num(top.sessions) / total;
  return pickInsight({
    id: `scale-channel:${top.source}`,
    category: 'scale',
    severity: 70 + Math.min(15, share * 100),
    title: `${top.source} is your highest-quality acquisition channel`,
    evidence: `${fmtInt(top.sessions)} sessions · ${fmtPct(top.bounce_rate)} bounce · ${fmtPct(top.engagement_rate)} engagement. Intent-driven visitors convert better — invest more here.`,
  });
}

function worstChannelSignal(analyzed) {
  const sources = analyzed?.sources || [];
  const total = num(analyzed?.summary?.total_sessions);
  if (!sources.length || !total) return null;
  const candidates = sources.filter((s) => {
    if (s.bot_classification !== 'human') return false;
    if (detectAiSource(s.source)) return false;
    return num(s.sessions) >= Math.max(100, total * 0.05);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => num(b.bounce_rate) - num(a.bounce_rate));
  const worst = candidates[0];
  if (num(worst.bounce_rate) < 0.6) return null;
  const share = num(worst.sessions) / total;
  return pickInsight({
    id: `worst-channel:${worst.source}`,
    category: share >= 0.2 ? 'critical' : 'fix',
    severity: 85 + Math.min(10, share * 50),
    title: `${worst.source} traffic is #1 in volume but worst in quality`,
    evidence: `${fmtInt(worst.sessions)} sessions · ${fmtPct(worst.bounce_rate)} bounce · ${fmtPct(worst.engagement_rate)} engagement — high entry, low engagement.`,
    playbook: {
      meaning: `"${worst.source}" sends ${fmtInt(worst.sessions)} sessions (${fmtPct(share)} of all traffic), but ${fmtPct(worst.bounce_rate)} of them leave on the first page. Big channels with weak engagement are the most expensive problem on the site — every fix here multiplies across thousands of visits.`,
      actions: [
        `Open the Traffic Sources tab and click into "${worst.source}" to see which landing pages it points at.`,
        'For Direct/(none) traffic specifically: check that bookmarked URLs and external links point to live pages — broken or redirect-heavy entries inflate bounce.',
        'Confirm UTM hygiene — un-tagged campaigns get bucketed into Direct and skew this number.',
        'If the source is paid: tighten audience targeting and rewrite the landing page intro to match the ad creative.',
        'If the source is organic/social: improve internal linking on the entry pages so visitors have somewhere obvious to go next.',
      ],
      where_to_look: { label: 'Traffic Sources', route: '/sources' },
    },
  });
}

function unicornSignal(analyzed) {
  const unicorns = analyzed?.unicorns || [];
  if (!unicorns.length) return null;
  const top = [...unicorns].sort(
    (a, b) => num(a.bounce_rate) - num(b.bounce_rate),
  )[0];
  return pickInsight({
    id: 'unicorn-pages',
    category: 'leverage',
    severity: 55 + Math.min(15, unicorns.length * 2),
    title: `${unicorns.length} unicorn page${unicorns.length === 1 ? '' : 's'} drive deep engagement`,
    evidence: `Best performer: ${top.page} — ${fmtPct(top.bounce_rate)} bounce on ${fmtInt(top.sessions)} sessions. Mine the messaging to reuse on weaker pages.`,
  });
}

function refreshCandidatesSignal(analyzed) {
  const opps = analyzed?.opportunities || [];
  if (!opps.length) return null;
  const sorted = [...opps].sort((a, b) => num(b.sessions) - num(a.sessions));
  const top = sorted[0];
  const totalLeak = opps.reduce((acc, p) => acc + num(p.sessions), 0);
  const worstNames = sorted.slice(0, 3).map((p) => p.page).filter(Boolean);
  return pickInsight({
    id: 'refresh-candidates',
    category: 'fix',
    severity: 75 + Math.min(15, opps.length),
    title: `${opps.length} high-traffic page${opps.length === 1 ? '' : 's'} bleeding visitors`,
    evidence: `${fmtInt(totalLeak)} sessions affected. Worst: ${top.page} — ${fmtInt(top.sessions)} sessions, ${fmtPct(top.bounce_rate)} bounce. Rewrite intros and add a clear CTA above the fold.`,
    playbook: {
      meaning: `These pages already attract real traffic (${fmtInt(totalLeak)} sessions across ${opps.length} page${opps.length === 1 ? '' : 's'}), but most visitors leave without taking a second action. A "bleeding" page is a sales asset that's quietly underperforming — the audience showed up, the page didn't close the loop.`,
      actions: [
        `Start with the worst offender: ${top.page} (${fmtInt(top.sessions)} sessions, ${fmtPct(top.bounce_rate)} bounce). Open it in an incognito window and read the first viewport as a stranger would.`,
        'Rewrite the intro: lead with the specific problem the visitor came to solve, not the company background.',
        'Place a single, unambiguous CTA above the fold (Contact, Book a call, Download, etc.) — remove or demote competing buttons.',
        'Add 3–5 internal links to closely-related pages (services, case studies, FAQs) to give visitors a path forward.',
        worstNames.length > 1
          ? `Repeat for the next two: ${worstNames.slice(1).join(', ')}.`
          : 'Apply the same playbook to any new pages that drift above 45% bounce.',
        'Re-check the Page Path Analysis tab next month — a 10-point bounce drop on these pages is a reasonable target.',
      ],
      where_to_look: { label: 'Page Path Analysis', route: '/pages' },
    },
  });
}

function salesLeadSignal(analyzed) {
  const cs = analyzed?.contacts_summary || {};
  const total = num(cs.total);
  const sales = num(cs.by_type?.['Sales Lead']);
  if (!total) return null;
  const ratio = sales / total;
  if (sales === 0) {
    return pickInsight({
      id: 'sales-leads-zero',
      category: 'critical',
      severity: 90,
      title: `Zero sales leads from ${fmtInt(total)} contact submissions`,
      evidence: `Form attracts spam, job seekers, or vendors — signal-to-noise problem. Tighten qualifying questions or add a routing step.`,
      playbook: {
        meaning: `${fmtInt(total)} people filled out the contact form, and not one of them was classified as a sales-qualified buyer. That's a signal-to-noise problem: the form is collecting submissions, but it's collecting the wrong audience (spam bots, recruiters, vendor pitches, support questions).`,
        actions: [
          'Open the Contact Form Intel tab and review the message text by category — confirm the classification is correct.',
          'Add a required "What brings you here today?" multi-choice question (e.g. Buying, Hiring, Partnership, Support) to route submissions before they hit the inbox.',
          'Add hCaptcha or honeypot fields to cut spam at the form level.',
          'Move support/job-seeker traffic to dedicated forms or pages so the contact form is reserved for buyers.',
          'Audit the page that hosts the form: is the headline actually targeting buyers, or is it generic "Get in touch" copy?',
        ],
        where_to_look: { label: 'Contact Form Intel', route: '/contact' },
      },
    });
  }
  if (total >= 10 && ratio < 0.25) {
    return pickInsight({
      id: 'sales-leads-low',
      category: 'fix',
      severity: 78,
      title: `Only ${fmtInt(sales)} genuine sales lead${sales === 1 ? '' : 's'} from ${fmtInt(total)} contact form submissions`,
      evidence: `${fmtPct(ratio)} sales-qualified — the form attracts the wrong audience. Add a "what brings you here" qualifier.`,
      playbook: {
        meaning: `Only ${fmtPct(ratio)} of submissions look like real buyers. The form is working mechanically — submissions are coming in — but the people filling it out aren't the people who close.`,
        actions: [
          'Read the Contact Form Intel tab to see who is actually submitting (job seekers, partners, support requests, spam).',
          'Add a single qualifying question at the top: "What brings you here?" — Buying / Hiring / Partnership / Other.',
          'Route non-sales submissions to a separate inbox so the sales team only sees qualified leads.',
          'Tighten the headline above the form — say who it\'s for ("For teams evaluating X") instead of "Contact us".',
          'Add a low-friction alternative for non-buyers (FAQ, careers page link) so they self-serve and stop submitting.',
        ],
        where_to_look: { label: 'Contact Form Intel', route: '/contact' },
      },
    });
  }
  if (sales >= 3 && ratio >= 0.4) {
    return pickInsight({
      id: 'sales-leads-strong',
      category: 'leverage',
      severity: 60,
      title: `${fmtInt(sales)} sales-qualified leads ready to route this week`,
      evidence: `${fmtPct(ratio)} of ${fmtInt(total)} form submissions classified as Sales Lead. Hand directly to outbound for follow-up.`,
    });
  }
  return null;
}

function spamSignal(analyzed) {
  const cs = analyzed?.contacts_summary || {};
  const total = num(cs.total);
  const spam = num(cs.by_type?.Spam);
  if (!total || spam < 5) return null;
  const ratio = spam / total;
  if (ratio < 0.15) return null;
  return pickInsight({
    id: 'contact-spam',
    category: 'filter',
    severity: 55 + Math.min(20, ratio * 40),
    title: `${fmtInt(spam)} spam submissions clogging the contact form`,
    evidence: `${fmtPct(ratio)} of submissions are spam. Add hCaptcha or honeypot fields before the spam-to-signal ratio gets worse.`,
  });
}

function multiMonthSignal(analyzed) {
  const count = num(analyzed?.users_summary?.multi_month);
  if (count < 5) return null;
  const totalIds = num(analyzed?.users_summary?.total_ids);
  const share = totalIds ? count / totalIds : 0;
  return pickInsight({
    id: 'multi-month-research',
    category: 'understand',
    severity: 40 + Math.min(15, share * 100),
    title: `${fmtInt(count)} user IDs return across 3+ months`,
    evidence: `${fmtPct(share)} of identified audience is doing long-funnel B2B research before reaching out. Sequence remarketing accordingly — they're already in the buying journey.`,
  });
}

function aiSearchSignal(analyzed) {
  const sources = analyzed?.sources || [];
  let aiSessions = 0;
  const matches = [];
  for (const s of sources) {
    const name = detectAiSource(s.source);
    if (!name) continue;
    aiSessions += num(s.sessions);
    matches.push({ name, source: s.source, sessions: num(s.sessions) });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.sessions - a.sessions);
  const top = matches[0];
  return pickInsight({
    id: 'ai-search-emerging',
    category: 'watch',
    severity: 45 + Math.min(15, matches.length * 5),
    title: `${top.source} is an emerging referral source — ${fmtInt(aiSessions)} session${aiSessions === 1 ? '' : 's'} this period`,
    evidence: `AI-assisted discovery (${matches.map((m) => m.name).slice(0, 3).join(', ')}) is growing. Optimize for AI search indexing — add FAQ schema and clear page summaries.`,
  });
}

function homepageSpikeSignal(analyzed) {
  const homepage = analyzed?.bounce?.homepage_monthly || [];
  if (homepage.length < 3) return null;
  const sorted = [...homepage].sort(
    (a, b) => num(b.bounce_rate) - num(a.bounce_rate),
  );
  const worst = sorted[0];
  const others = homepage.filter((m) => m.month !== worst.month);
  const avgOthers = others.length
    ? others.reduce((acc, m) => acc + num(m.bounce_rate), 0) / others.length
    : 0;
  if (num(worst.bounce_rate) < 0.45) return null;
  if (num(worst.bounce_rate) - avgOthers < 0.08) return null;
  return pickInsight({
    id: `homepage-spike:${worst.month}`,
    category: 'investigate',
    severity: 55 + Math.min(20, (num(worst.bounce_rate) - avgOthers) * 100),
    title: `Homepage bounce spiked to ${fmtPct(worst.bounce_rate)} in ${worst.month_name || worst.month}`,
    evidence: `vs ${fmtPct(avgOthers)} average across the other ${others.length} months. Check campaigns or landing-page experiments running that month.`,
  });
}

function monthlyAnomalySignal(analyzed) {
  const anomalies = analyzed?.unique?.anomalies?.anomalies || [];
  const sessionAnoms = anomalies.filter((a) => a.metric === 'sessions');
  const bounceAnoms = anomalies.filter((a) => a.metric === 'bounce_rate');
  if (sessionAnoms.length === 0 && bounceAnoms.length === 0) return null;
  const total = sessionAnoms.length + bounceAnoms.length;
  const months = [...new Set([...sessionAnoms, ...bounceAnoms].map((a) => a.month))];
  return pickInsight({
    id: 'monthly-anomalies',
    category: 'investigate',
    severity: 50 + Math.min(20, total * 4),
    title: `${total} month${total === 1 ? '' : 's'} flagged as anomalous (>1.5σ from baseline)`,
    evidence: `${months.slice(0, 3).join(', ')}${months.length > 3 ? `, +${months.length - 3} more` : ''}. Cross-reference with marketing calendar — campaign, content, or platform change usually explains the swing.`,
  });
}

function concentrationSignal(analyzed) {
  const conc = analyzed?.unique?.concentration?.pages;
  if (!conc || !conc.count) return null;
  if (num(conc.top5) < 0.5) return null;
  return pickInsight({
    id: 'page-concentration',
    category: 'understand',
    severity: 35 + Math.min(20, conc.top5 * 30),
    title: `Top 5 pages capture ${fmtPct(conc.top5)} of all sessions`,
    evidence: `Site behaves as if it had ${conc.effective?.toFixed(1) || '?'} equally-loaded pages (HHI ${conc.hhi?.toLocaleString?.() || '—'}). Heavy dependency — protect those pages and diversify the funnel.`,
  });
}

function newUserRateSignal(analyzed) {
  const rate = num(analyzed?.summary?.new_user_rate);
  const totalUsers = num(analyzed?.summary?.total_users);
  if (!totalUsers || !rate) return null;
  if (rate >= 0.85) {
    return pickInsight({
      id: 'new-users-very-high',
      category: 'understand',
      severity: 38,
      title: `${fmtPct(rate)} of users are first-time visitors`,
      evidence: `Acquisition is healthy but retention is weak — only ${fmtPct(1 - rate)} return. Build a returning-visitor experience (newsletter, gated assets, retargeting).`,
    });
  }
  if (rate <= 0.4) {
    return pickInsight({
      id: 'new-users-low',
      category: 'fix',
      severity: 65,
      title: `Only ${fmtPct(rate)} of users are new — the audience is stagnating`,
      evidence: `${fmtInt(totalUsers)} total users this period. Acquisition channels aren't refreshing the top of the funnel — review SEO and paid campaigns.`,
      playbook: {
        meaning: `Most of the traffic this period (${fmtPct(1 - rate)}) was returning visitors. Returning audiences are valuable, but a healthy site refreshes the top of its funnel — without new users, the pipeline shrinks over time and any growth target gets harder.`,
        actions: [
          'Open Traffic Sources and check whether organic search, paid, and referral channels are flat or declining month-over-month.',
          'Audit the top 5 SEO pages — are they ranking for queries that would attract new audiences, or is it mostly branded search?',
          'Add or revive a content cadence (blog, resource, comparison page) targeting top-of-funnel keywords.',
          'If paid campaigns exist: review audience targeting — are they over-indexed on retargeting (which only re-touches existing users)?',
          'Set a monthly "new users" target and re-check on the next upload.',
        ],
        where_to_look: { label: 'Traffic Sources', route: '/sources' },
      },
    });
  }
  return null;
}

function fractionalSignal(analyzed) {
  const fractional = num(analyzed?.users_summary?.fractional);
  const totalIds = num(analyzed?.users_summary?.total_ids);
  if (!totalIds || fractional < 5) return null;
  const share = fractional / totalIds;
  if (share < 0.15) return null;
  return pickInsight({
    id: 'fractional-cookies',
    category: 'filter',
    severity: 50 + Math.min(20, share * 50),
    title: `${fmtInt(fractional)} cross-device / Google Signals cookie IDs are inflating user counts`,
    evidence: `${fmtPct(share)} of identified IDs are cookie artifacts (.2 cross-device, .17/.18 Google Signals). Add Leapfrog office IPs to GA4 internal-traffic filters and exclude these from outbound lists.`,
  });
}

function emailQualitySignal(analyzed) {
  const sources = analyzed?.sources || [];
  const siteBounce = num(analyzed?.summary?.site_bounce_rate);
  if (!siteBounce) return null;
  const email = sources.find((s) => /email|newsletter|mailchimp|hubspot/i.test(String(s.source || '')));
  if (!email || num(email.sessions) < 30) return null;
  const lift = siteBounce - num(email.bounce_rate);
  if (lift < 0.05) return null;
  return pickInsight({
    id: 'email-quality',
    category: 'leverage',
    severity: 50 + Math.min(15, lift * 100),
    title: `Email channel has the best bounce rate (${fmtPct(email.bounce_rate)})`,
    evidence: `vs ${fmtPct(siteBounce)} site average — email visitors are the warmest audience you have. Increase send cadence and segment by intent.`,
  });
}

function trustScoreSignal(analyzed) {
  const trust = analyzed?.unique?.trust;
  if (!trust || typeof trust.score !== 'number') return null;
  if (trust.score >= 80) return null;
  return pickInsight({
    id: 'trust-score',
    category: trust.score < 50 ? 'critical' : 'investigate',
    severity: trust.score < 50 ? 88 : 60,
    title: `Data trust score is ${Math.round(trust.score)}/100 — ${trust.label || 'review needed'}`,
    evidence: `${(trust.flags || []).slice(0, 2).map((f) => f.label || f.title || f).join('; ') || 'See the trust panel for the full list of caveats.'}`,
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const SIGNALS = [
  siteBounceSignal,
  worstChannelSignal,
  topChannelSignal,
  refreshCandidatesSignal,
  unicornSignal,
  salesLeadSignal,
  botFilterSignal,
  spamSignal,
  fractionalSignal,
  homepageSpikeSignal,
  monthlyAnomalySignal,
  multiMonthSignal,
  aiSearchSignal,
  emailQualitySignal,
  newUserRateSignal,
  concentrationSignal,
  trustScoreSignal,
];

export function buildTopInsights(analyzed, limit = 10) {
  if (!analyzed) return [];
  const all = [];
  for (const signal of SIGNALS) {
    try {
      const result = signal(analyzed);
      if (result) all.push(result);
    } catch (err) {
      // A bad signal shouldn't take down the whole engine.
      // eslint-disable-next-line no-console
      console.warn(`[insightEngine] signal threw: ${err?.message}`);
    }
  }
  all.sort((a, b) => num(b.severity) - num(a.severity));
  // Dedupe by id (in case a signal accidentally fires twice).
  const seen = new Set();
  const out = [];
  for (const ins of all) {
    if (seen.has(ins.id)) continue;
    seen.add(ins.id);
    out.push(ins);
    if (out.length >= limit) break;
  }
  return out;
}
