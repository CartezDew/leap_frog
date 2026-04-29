// Constants extracted from SKILL.md.
// All thresholds, alias dictionaries, and known-bot lists are pinned here
// so the parser and analyzer always read from a single source of truth.

export const METRIC_ALIASES = {
  sessions: ['sessions', 'session count', 'total sessions'],
  engaged_sessions: [
    'engaged sessions',
    'engaged session count',
    'engagedsessions',
  ],
  total_users: ['total users', 'users', 'user count', 'unique users'],
  new_users: [
    'new users',
    'new user count',
    'first time users',
    'first visit users',
  ],
  active_users: ['active users', 'active user count'],
  bounce_rate_raw: [
    'bounce rate',
    'bouncerate',
    'bounce rate %',
    'bounce rate pct',
    'avg bounce',
    'average bounce',
    'avg bounce rate',
  ],
  event_count: ['event count', 'events', 'total events', 'event total'],
  avg_engagement_time: [
    'average engagement time per session',
    'avg engagement time',
    'average session duration',
    'avg session duration',
    'engagement time',
    'session duration',
    'avg duration',
    'average duration',
    'avg session time',
  ],
  views: [
    'views',
    'screen views',
    'pageviews',
    'page views',
    'screen page views',
    'total views',
  ],
  engagement_rate: [
    'engagement rate',
    'engagement',
    'engagement %',
    'engagement pct',
  ],
  months_active: [
    'months active',
    'active months',
    'month count',
    'unique months',
  ],
  months_list: ['months list', 'month list', 'months'],
  id_type: ['user type', 'id type', 'persona type'],
  views_per_session: [
    'views per session',
    'pages per session',
    'pageviews per session',
    'screen views per session',
  ],
  events_per_session: ['events per session', 'event count per session'],
  effective_user_id: [
    'effective user id',
    'user id',
    'userid',
    'client id',
    'ga client id',
  ],
  stream_name: ['stream name', 'data stream', 'stream'],
  conversion_date: [
    'conversion date',
    'date',
    'submission date',
    'form date',
  ],
  conversion_page: [
    'conversion page',
    'page',
    'landing page',
    'form page',
  ],
  conversion_title: [
    'conversion title',
    'page title',
    'form title',
  ],
  how_can_we_help: [
    'how can we help you',
    'how can we help you_',
    'message',
    'inquiry',
    'comments',
    'form message',
    'description',
  ],
};

export const KNOWN_DATACENTER_CITIES = [
  'Lanzhou',
  'Shanghai',
  'Lhasa',
  'Hangzhou',
  'Beijing',
  'Guangzhou',
  'Zhengzhou',
  'Shenzhen',
  'Moses Lake',
  'Boydton',
  'Ashburn',
  'Council Bluffs',
  'Des Moines',
  'Singapore',
  'North Charleston',
];

export const KNOWN_SPAM_SOURCES = [
  'JBCF Zfzcfefuvc',
  'search.webnavigator.com',
  'moodle.emica.ca',
];

export const MONTH_MAP = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const SHEET_CATEGORIES = [
  'source',
  'medium',
  'device',
  'city',
  'page_path',
  'user',
  'contact',
  'source_medium_device',
  'new_established',
  'consolidated',
];

export const BOT_CLASSIFICATION = {
  confirmed_bot: { min_score: 7, label: 'Confirmed Bot' },
  likely_bot: { min_score: 4, label: 'Likely Bot' },
  suspicious: { min_score: 2, label: 'Suspicious' },
  human: { min_score: 0, label: 'Human Traffic' },
};

export function classifyBotScore(score) {
  if (score >= 7) return 'confirmed_bot';
  if (score >= 4) return 'likely_bot';
  if (score >= 2) return 'suspicious';
  return 'human';
}

// Page-level thresholds (SKILL.md Section 6).
export const UNICORN_MIN_SESSIONS = 100;
export const UNICORN_MAX_BOUNCE = 0.25;
export const OPPORTUNITY_MIN_SESSIONS = 100;
export const OPPORTUNITY_MIN_BOUNCE = 0.45;

// Bounce-rate color tiers (SKILL.md Section 9.2).
export const BOUNCE_TIER_RED = 0.55;
export const BOUNCE_TIER_AMBER = 0.45;
export const BOUNCE_TIER_GREEN = 0.4;

// B2B services industry bounce-rate benchmarks.
// Source: industry-services performance bands the Leapfrog playbook scores
// against. The scale runs 0%–100%; each tier owns a contiguous band.
export const BOUNCE_BENCHMARK_TIERS = [
  {
    id: 'excellent',
    label: 'Excellent',
    min: 0,
    max: 0.3,
    description: 'Best-in-class B2B service site',
    tone: 'green',
  },
  {
    id: 'good',
    label: 'Good',
    min: 0.3,
    max: 0.4,
    description: 'Above-average performance',
    tone: 'green-soft',
  },
  {
    id: 'average',
    label: 'Average',
    min: 0.4,
    max: 0.55,
    description: 'Industry median for B2B services',
    tone: 'amber',
  },
  {
    id: 'poor',
    label: 'Poor',
    min: 0.55,
    max: 1,
    description: 'Significant UX or content-match issues',
    tone: 'red',
  },
];

// Industry midpoint used as a reference line on the visual scale.
export const BOUNCE_INDUSTRY_MEDIAN = 0.475; // midpoint of the "Average" band.

// High-engagement / multi-month user thresholds (SKILL.md Section 5.2).
export const HIGH_ENGAGEMENT_MIN_SESSIONS = 3;
export const HIGH_ENGAGEMENT_MIN_RATE = 0.6;
export const HIGH_ENGAGEMENT_MIN_DURATION = 60;
export const HIGH_ENGAGEMENT_MAX_BOT_SCORE = 3;

export const MULTI_MONTH_MIN_MONTHS = 3;
export const MULTI_MONTH_MIN_SESSIONS = 5;
export const MULTI_MONTH_MIN_RATE = 0.5;

// Upload limits.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx', '.xls'];

// Pre-built analysis sheet titles (passed through verbatim).
export const ANALYSIS_SHEET_KEYWORDS = [
  'executive summary',
  'actionable insights',
  'bounce rate',
  'user id engagement',
  'traffic sources',
  'page path analysis',
  'unicorn pages',
  'contact form intel',
  'bot traffic',
];

// Sheets the upload flow reports as "expected" — used by the validator.
export const EXPECTED_SHEETS = [
  'source',
  'medium',
  'device',
  'city',
  'page_path',
  'user',
  'contact',
];

// localStorage key for the persisted dataset.
export const STORAGE_KEY = 'leapfrog_data';
