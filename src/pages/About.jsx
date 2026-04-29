// Help pages — concise client-facing explanations for the dashboard.

import {
  LuBot,
  LuChartBar,
  LuCompass,
  LuDatabase,
  LuFileText,
  LuLightbulb,
  LuLock,
  LuMail,
  LuRadio,
  LuSearch,
  LuShieldAlert,
  LuShieldCheck,
  LuSparkles,
  LuTrendingDown,
  LuUpload,
  LuUsers,
  LuZap,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';

const DATA_SOURCES = [
  {
    icon: LuDatabase,
    title: 'GA4 reports',
    body: 'Traffic, engagement, bounce rate, conversions, channels, pages, users, and form signals from Google Analytics 4 exports.',
  },
  {
    icon: LuChartBar,
    title: 'Semrush reports',
    body: 'Organic keyword rankings, position changes, volume, CPC, and estimated search value from Semrush Organic Performance PDFs.',
  },
  {
    icon: LuBot,
    title: 'Live site crawl',
    body: 'The SEO / AEO tab can crawl the public website to compare ranking keywords against real page titles, headings, copy, links, and technical signals.',
  },
];

const DASHBOARD_TABS = [
  {
    icon: LuCompass,
    title: 'Overview',
    body: 'Executive snapshot: what changed, what matters, and where performance needs attention.',
  },
  {
    icon: LuLightbulb,
    title: 'Actionable Insights',
    body: 'Prioritized recommendations. Start here when deciding what to fix first.',
  },
  {
    icon: LuSearch,
    title: 'Keywords (Semrush)',
    body: 'Organic search visibility. Shows ranking movement, searcher intent, keyword themes, page matches, and estimated value. Counts are keywords, not people or advertisers.',
  },
  {
    icon: LuBot,
    title: 'SEO / AEO Crawl',
    body: 'Search and answer-engine readiness. Combines Semrush demand with a live crawl to find page improvements, AI-answer questions, campaign clusters, and technical cleanup.',
  },
  {
    icon: LuTrendingDown,
    title: 'Bounce Rate',
    body: 'Pages or channels where visitors leave too quickly. Use it to find weak landing-page experiences.',
  },
  {
    icon: LuUsers,
    title: 'User ID Engagement',
    body: 'Visitor quality. Separates casual visits from repeat or high-engagement audience behavior.',
  },
  {
    icon: LuRadio,
    title: 'Traffic Sources',
    body: 'Channel mix. Shows where sessions come from and which sources are most useful.',
  },
  {
    icon: LuFileText,
    title: 'Page Path Analysis',
    body: 'Page-level performance. Shows which URLs attract, retain, or lose visitors.',
  },
  {
    icon: LuSparkles,
    title: 'Unicorn Pages',
    body: 'Standout pages. Highlights pages outperforming expectations so they can be reused or expanded.',
  },
  {
    icon: LuMail,
    title: 'Contact Form Intel',
    body: 'Lead-form behavior. Connects form activity back to the pages and sessions that drive inquiries.',
  },
  {
    icon: LuShieldAlert,
    title: 'Bot Traffic Intelligence',
    body: 'Traffic quality checks. Flags likely automated or suspicious traffic that can distort results.',
  },
];

const HOW_TO_STEPS = [
  {
    icon: LuUpload,
    title: '1. Upload the reports',
    body: 'Use GA4 Excel files for website behavior. Use Semrush PDFs for keyword and SEO views.',
  },
  {
    icon: LuCompass,
    title: '2. Start with Overview',
    body: 'Use the top cards to answer: what changed, how big is it, and is it good or bad?',
  },
  {
    icon: LuSearch,
    title: '3. Use Keywords for search demand',
    body: 'Treat keyword counts as tracked search terms. Use volume and rank to decide which SEO topics deserve attention.',
  },
  {
    icon: LuBot,
    title: '4. Use SEO / AEO for page fixes',
    body: 'Run the crawl, then work from weak matches, answer-engine questions, and technical cleanup.',
  },
  {
    icon: LuLightbulb,
    title: '5. Turn findings into actions',
    body: 'Prioritize fixes with high traffic, high value, weak engagement, or clear page-to-keyword gaps.',
  },
];

const KEY_DEFINITIONS = [
  {
    icon: LuSearch,
    title: 'Keyword count',
    body: 'Number of tracked Semrush keyword rows in a group. It is not visitor count, lead count, or advertiser count.',
  },
  {
    icon: LuChartBar,
    title: 'Volume',
    body: 'Estimated monthly searches for the keywords in that group.',
  },
  {
    icon: LuZap,
    title: 'Estimated value',
    body: 'A directional value based on rank, search volume, click-through-rate assumptions, and Semrush CPC.',
  },
  {
    icon: LuShieldCheck,
    title: 'AEO',
    body: 'Answer Engine Optimization: content structured so AI tools and search snippets can understand and quote the answer.',
  },
];

const COMMITMENTS = [
  {
    icon: LuLock,
    title: 'Browser-only processing',
    body: 'Uploaded files are parsed in the browser. No API keys are required.',
  },
  {
    icon: LuShieldCheck,
    title: 'Cross-checks built in',
    body: 'When the same KPI appears in multiple places, the dashboard checks for mismatches.',
  },
  {
    icon: LuZap,
    title: 'Designed for decisions',
    body: 'Every tab is built to answer what happened, why it matters, and what to do next.',
  },
];

function BulletList({ items, variant = '' }) {
  return (
    <ul className={`about-bullets${variant ? ` about-bullets--${variant}` : ''}`}>
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

function HelpCallout() {
  return (
    <aside className="about-callout" aria-label="Client note">
      <LuShieldCheck size={20} aria-hidden="true" />
      <p>
        <strong>Client note:</strong> keyword views describe search terms and page
        opportunities. They do not count individual people, leads, or advertisers.
      </p>
    </aside>
  );
}

export function About() {
  return (
    <>
      <PageHeader
        badge="Help"
        title="About the dashboard"
        subtitle="Short definitions for the data, tabs, and SEO signals used in this report."
      />

      <HelpCallout />

      <h2 className="section-header">
        Data <em>sources</em>
      </h2>
      <p className="section-subhead">
        The dashboard reads standard client exports and turns them into decision-ready views.
      </p>
      <BulletList items={DATA_SOURCES} />

      <h2 className="section-header">
        Dashboard <em>tabs</em>
      </h2>
      <p className="section-subhead">
        Each tab answers one business question. Use the descriptions below as the client glossary.
      </p>
      <BulletList items={DASHBOARD_TABS} />

      <h2 className="section-header">
        Key <em>definitions</em>
      </h2>
      <BulletList items={KEY_DEFINITIONS} variant="compact" />

      <h2 className="section-header">
        Trust <em>checks</em>
      </h2>
      <BulletList items={COMMITMENTS} variant="compact" />
    </>
  );
}

export function HowToUse() {
  return (
    <>
      <PageHeader
        badge="Help"
        title="How to use this dashboard"
        subtitle="A quick workflow for reading the report without guessing what each number means."
      />

      <HelpCallout />

      <h2 className="section-header">
        Recommended <em>workflow</em>
      </h2>
      <BulletList items={HOW_TO_STEPS} variant="steps" />

      <h2 className="section-header">
        Read the SEO tabs <em>this way</em>
      </h2>
      <div className="about-guide-grid">
        <article className="about-guide-card">
          <LuSearch size={22} aria-hidden="true" />
          <h3>Keywords</h3>
          <p>
            Use this tab to understand search demand: which topics rank, which
            terms moved, what searchers likely want, and which site pages match those keywords.
          </p>
        </article>
        <article className="about-guide-card">
          <LuBot size={22} aria-hidden="true" />
          <h3>SEO / AEO Crawl</h3>
          <p>
            Use this tab after running the crawl. It turns keyword demand into page
            fixes, direct-answer ideas, campaign topics, and technical cleanup.
          </p>
        </article>
      </div>

      <h2 className="section-header">
        Common <em>questions</em>
      </h2>
      <BulletList items={KEY_DEFINITIONS} variant="compact" />
    </>
  );
}
