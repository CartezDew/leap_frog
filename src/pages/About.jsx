// About page — explains what the dashboard analyzes and why it matters.
// Designed to be skimmable: short intro, then icon-led bullet groups so a
// first-time viewer can size up the product in well under a minute.

import {
  LuDatabase,
  LuChartBar,
  LuTrendingDown,
  LuUsers,
  LuRadio,
  LuFileText,
  LuSparkles,
  LuMail,
  LuShieldAlert,
  LuLightbulb,
  LuShieldCheck,
  LuLock,
  LuZap,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';

const DATA_SOURCES = [
  {
    icon: LuDatabase,
    title: 'GA4 Reports',
    body: 'Sessions, engaged sessions, bounce rate, conversions, monthly trends, traffic source mix, and per-page performance — pulled directly from your Google Analytics 4 export.',
  },
  {
    icon: LuChartBar,
    title: 'Semrush Reports',
    body: 'Organic keyword visibility, ranking shifts, and search performance signals that complement GA4 with the "why" behind your traffic.',
  },
];

const ANALYSES = [
  {
    icon: LuLightbulb,
    title: 'Actionable Insights',
    body: 'Prioritized findings ranked by impact — what to fix this week vs. what to investigate later.',
  },
  {
    icon: LuTrendingDown,
    title: 'Bounce Rate Diagnostics',
    body: 'Benchmarks your bounce rate against industry baselines and surfaces the pages dragging the average down.',
  },
  {
    icon: LuUsers,
    title: 'User Engagement',
    body: 'Engagement quality by user cohort — distinguishes one-and-done visitors from your real audience.',
  },
  {
    icon: LuRadio,
    title: 'Traffic Sources',
    body: 'Channel breakdown showing where your visitors come from and which sources actually convert.',
  },
  {
    icon: LuFileText,
    title: 'Page Path Analysis',
    body: 'Top entrance pages, exit pages, and the routes visitors take through your site.',
  },
  {
    icon: LuSparkles,
    title: 'Unicorn Pages',
    body: 'Outlier pages that punch far above their weight — the high-engagement, low-effort wins worth doubling down on.',
  },
  {
    icon: LuMail,
    title: 'Contact Form Intel',
    body: 'Lead-form performance: submissions, completion rates, and the pages driving the most inquiries.',
  },
  {
    icon: LuShieldAlert,
    title: 'Bot Traffic Intelligence',
    body: 'Identifies suspicious or automated traffic so your real numbers are not inflated by noise.',
  },
];

const COMMITMENTS = [
  {
    icon: LuLock,
    title: 'Browser-only processing',
    body: 'Your spreadsheets never leave your device. Every parse, calculation, and chart runs locally.',
  },
  {
    icon: LuShieldCheck,
    title: 'Cross-sheet accuracy checks',
    body: 'When the same KPI appears on multiple tabs, we cross-check the numbers and flag any disagreements.',
  },
  {
    icon: LuZap,
    title: 'Built for executives',
    body: 'Designed for a clear "what happened, why it matters, what to do next" — not raw data dumps.',
  },
];

function BulletList({ items }) {
  return (
    <ul className="about-bullets">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.title} className="about-bullet">
            <span className="about-bullet__icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <div className="about-bullet__body">
              <h3 className="about-bullet__title">{item.title}</h3>
              <p className="about-bullet__text">{item.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function About() {
  return (
    <>
      <PageHeader
        badge="About this dashboard"
        title="What you're looking at"
        subtitle="A quick tour of the data we analyze, the signals we surface, and how to use them."
      />

      <h2 className="section-header">
        Where the data <em>comes from</em>
      </h2>
      <p className="section-subhead">
        We accept the standard exports your team already produces — no setup,
        no integrations, no API keys.
      </p>
      <BulletList items={DATA_SOURCES} />

      <h2 className="section-header">
        What the dashboard <em>tells you</em>
      </h2>
      <p className="section-subhead">
        Each section answers a specific business question. Skim the icons to
        jump to whichever conversation you need to have today.
      </p>
      <BulletList items={ANALYSES} />

      <h2 className="section-header">
        How we keep it <em>trustworthy</em>
      </h2>
      <p className="section-subhead">
        A dashboard is only as useful as the numbers behind it. These are the
        commitments baked into how we calculate and present results.
      </p>
      <BulletList items={COMMITMENTS} />
    </>
  );
}
