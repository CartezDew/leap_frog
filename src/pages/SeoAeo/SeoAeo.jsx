import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LuArrowUpRight,
  LuBot,
  LuChevronDown,
  LuExternalLink,
  LuFileSearch,
  LuGlobe,
  LuLink2,
  LuMegaphone,
  LuRefreshCw,
  LuSearch,
  LuShieldCheck,
  LuSparkles,
  LuTriangleAlert,
} from 'react-icons/lu';

import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { KpiCard } from '../../components/KpiCard/KpiCard.jsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.jsx';
import { useData } from '../../context/DataContext.jsx';
import { CRAWL_AUDIT_NOTE } from '../../lib/siteCrawler.js';
import { runSeoAeoAnalysis } from '../../lib/seoAeoAnalyzer.js';
import { formatInteger } from '../../lib/formatters.js';

import './SeoAeo.css';

function EmptyState({ hasSemrush, busy, onRun }) {
  function handleCardClick() {
    if (!hasSemrush || busy) return;
    onRun();
  }

  return (
    <section
      className={`seo-empty${hasSemrush ? ' seo-empty--actionable' : ''}${
        busy ? ' is-crawling' : ''
      }`}
      onClick={handleCardClick}
      aria-busy={busy ? 'true' : undefined}
    >
      <span className="seo-empty__icon">
        {busy ? (
          <LuRefreshCw size={26} className="seo-spin" aria-hidden="true" />
        ) : (
          <LuFileSearch size={26} aria-hidden="true" />
        )}
      </span>
      <h2>
        {busy
          ? 'Crawling the live site'
          : hasSemrush
            ? 'Crawl the live site'
            : 'Upload Semrush PDFs first'}
      </h2>
      <p>
        {busy
          ? 'Scanning Leapfrog pages, metadata, headings, links, and alt text. This can take a moment.'
          : hasSemrush
          ? 'Run the live crawl to compare Leapfrog website content against the Semrush keyword set.'
          : 'This report needs Semrush keyword PDFs so it can decide which website pages and AEO answers matter most.'}
      </p>
      {hasSemrush && (
        <button
          type="button"
          className="btn btn--primary seo-empty__action"
          onClick={(evt) => {
            evt.stopPropagation();
            handleCardClick();
          }}
          disabled={busy}
        >
          <LuRefreshCw size={14} className={busy ? 'seo-spin' : ''} aria-hidden="true" />
          {busy ? 'Crawl running...' : 'Crawl live site'}
        </button>
      )}
      {!hasSemrush && (
        <Link to="/upload" className="btn btn--primary">
          Upload Semrush reports <LuArrowUpRight size={14} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

function AuditIdentity({ siteCrawl }) {
  return (
    <section className="seo-audit-card">
      <div>
        <h2 className="section-header">
          Crawl <em>identity</em>
        </h2>
        <p className="section-subhead">
          {CRAWL_AUDIT_NOTE} Leapfrog can filter CDN/server logs by this user agent
          or the `X-Leapfrog-Audit` header. These requests read HTML only; they do not
          run browser JavaScript and should not create normal GA4 sessions.
        </p>
      </div>
      <dl className="seo-audit-card__meta">
        <div>
          <dt>User agent</dt>
          <dd>{siteCrawl?.userAgent || 'LeapfrogSEOAEOAudit/1.0'}</dd>
        </div>
        <div>
          <dt>Audit header</dt>
          <dd>X-Leapfrog-Audit: seo-aeo-dashboard</dd>
        </div>
      </dl>
    </section>
  );
}

function PriorityPill({ value }) {
  const cls = value === 'Create' ? 'seo-pill--hot' : value === 'Improve' ? 'seo-pill--warn' : '';
  return <span className={`seo-pill ${cls}`}>{value}</span>;
}

/** Full-width detail panel reused by every "How to fix" disclosure on this page. */
function FixDetail({ heading, text }) {
  const t = text == null ? '' : String(text).trim();
  if (!t) return null;
  return (
    <div className="seo-fix-detail">
      <h4 className="seo-fix-detail__heading">{heading}</h4>
      <p className="seo-fix-detail__text">{t}</p>
    </div>
  );
}

function CampaignClusterDetail({ row }) {
  const examples = Array.isArray(row.sampleKeywords) ? row.sampleKeywords : [];
  return (
    <div className="seo-campaign-detail">
      <div>
        <h4 className="seo-campaign-detail__heading">Keyword examples</h4>
        {examples.length > 0 ? (
          <ul className="seo-campaign-detail__chips">
            {examples.map((keyword) => (
              <li key={keyword}>{keyword}</li>
            ))}
          </ul>
        ) : (
          <p className="seo-campaign-detail__empty">No sample keywords available.</p>
        )}
      </div>
      <div>
        <h4 className="seo-campaign-detail__heading">Recommended use</h4>
        <p className="seo-campaign-detail__text">{row.recommendation || '—'}</p>
      </div>
    </div>
  );
}

export function SeoAeo() {
  const {
    analyzed,
    hasSemrush,
    siteCrawl,
    siteCrawlStatus,
    siteCrawlError,
    runSiteCrawl,
  } = useData();

  const busy = siteCrawlStatus === 'crawling';
  const analysis = useMemo(
    () => runSeoAeoAnalysis({ analyzed, siteCrawl }),
    [analyzed, siteCrawl],
  );

  const pageColumns = [
    { key: 'keyword', header: 'Keyword' },
    {
      key: 'position',
      header: 'Rank',
      align: 'right',
      format: (v) => (v == null ? '—' : `#${v}`),
    },
    { key: 'page', header: 'Best page' },
    { key: 'fit', header: 'Fit', align: 'right', format: (v) => `${v}%` },
    { key: 'priority', header: 'Priority', align: 'right' },
    { key: 'recommendation', header: 'Why this fix matters', sortable: false },
  ];

  const questionColumns = [
    { key: 'question', header: 'AEO question' },
    { key: 'keyword', header: 'Keyword source' },
    { key: 'page', header: 'Best page' },
    {
      key: 'priority',
      header: 'Action',
      render: (row) => <PriorityPill value={row.priority} />,
      sortValue: (row) => row.priority,
      exportValue: (row) => row.priority ?? '',
    },
    { key: 'recommendation', header: 'Recommended answer strategy', sortable: false },
  ];

  const technicalColumns = [
    { key: 'page', header: 'Page' },
    { key: 'issueCount', header: 'Issues', align: 'right' },
    { key: 'missingAlt', header: 'Missing alt', align: 'right' },
    { key: 'schema', header: 'Schema' },
    { key: 'recommendation', header: 'Client-ready fix explanation', sortable: false },
  ];

  const campaignColumns = [
    { key: 'theme', header: 'Campaign theme' },
    { key: 'keywordCount', header: 'Keywords', align: 'right' },
    { key: 'semrushScope', header: 'Semrush scope' },
    { key: 'totalVolume', header: 'Volume', align: 'right' },
    { key: 'avgCpc', header: 'Avg. CPC', align: 'right', format: (v) => `$${Number(v || 0).toFixed(2)}` },
    { key: 'modeledClicks', header: 'Est. clicks', align: 'right' },
    {
      key: 'paidValue',
      header: 'Est. traffic value',
      align: 'right',
      format: (v) => `$${formatInteger(v)}`,
    },
  ];

  async function handleCrawl() {
    await runSiteCrawl({
      origin: 'https://leapfrogservices.com',
      limit: 150,
    }).catch(() => {
      // The visible error banner is set by DataContext.
    });
  }

  return (
    <>
      <PageHeader
        badge="SEO / AEO crawler"
        badgeVariant="green"
        title="Search & Answer Engine Optimization"
        subtitle="Use uploaded Semrush keyword reports plus a live crawl of leapfrogservices.com to find stronger SEO, AEO, campaign, and earned-media opportunities."
        actions={
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleCrawl}
            disabled={!hasSemrush || busy}
          >
            <LuRefreshCw size={14} className={busy ? 'seo-spin' : ''} />
            {busy ? 'Crawling site...' : siteCrawl ? 'Recrawl live site' : 'Crawl live site'}
          </button>
        }
      />

      {siteCrawlError && (
        <div className="error-banner">
          <LuTriangleAlert size={14} /> {siteCrawlError}
        </div>
      )}

      <AuditIdentity siteCrawl={siteCrawl} />

      {!hasSemrush || !siteCrawl ? (
        <EmptyState hasSemrush={hasSemrush} busy={busy} onRun={handleCrawl} />
      ) : (
        <>
          {siteCrawl?.discoveredUrlCount > siteCrawl?.crawledUrlCount && (
            <div className="seo-crawl-limit-alert">
              <LuTriangleAlert size={16} aria-hidden="true" />
              <div>
                <strong>Full-site crawl requires a backend</strong>
                <p>
                  The live button crawled {formatInteger(siteCrawl.crawledUrlCount)} of{' '}
                  {formatInteger(siteCrawl.discoveredUrlCount)} discovered sitemap pages.
                  To crawl every discovered URL, connect this dashboard to a backend or
                  background crawl job that stores a full-site crawl snapshot.
                </p>
              </div>
            </div>
          )}

          <div className="card-grid card-grid--cols-4">
            <KpiCard
              label="Pages crawled"
              value={formatInteger(analysis.summary.crawledPages)}
              sub={`${formatInteger(analysis.summary.discoveredPages)} discovered in sitemaps; live button crawls up to 150`}
              accent="green"
            />
            <KpiCard
              label="Keyword fit"
              value={`${analysis.summary.avgFit}%`}
              sub="average page match score"
              accent="purple"
            />
            <KpiCard
              label="Weak matches"
              value={formatInteger(analysis.summary.weakMatches)}
              sub="keywords needing stronger page coverage"
              accent="amber"
            />
            <KpiCard
              label="Tech issues"
              value={formatInteger(analysis.summary.technicalIssues)}
              sub={`${formatInteger(analysis.summary.missingAlt)} missing image alt values`}
            />
          </div>

          {analysis.warnings?.length > 0 && (
            <div className="seo-warning-list">
              <LuTriangleAlert size={16} aria-hidden="true" />
              <div>
                <strong>Crawl notes</strong>
                <ul>
                  {analysis.warnings.slice(0, 5).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <section className="seo-story-grid">
            <article className="seo-story">
              <LuSearch size={22} aria-hidden="true" />
              <h3>SEO reach</h3>
              <p>
                Match high-value Semrush terms to the strongest existing page, then tighten
                title tags, H1s, internal links, and page copy where the fit is weak.
              </p>
            </article>
            <article className="seo-story">
              <LuBot size={22} aria-hidden="true" />
              <h3>AEO readiness</h3>
              <p>
                Turn ranking terms into natural questions that ChatGPT, Claude, Gemini,
                Perplexity, and search snippets can understand and quote.
              </p>
            </article>
            <article className="seo-story">
              <LuMegaphone size={22} aria-hidden="true" />
              <h3>Campaign fuel</h3>
              <p>
                Cluster keywords into organic, paid, and earned-media topics so marketing
                can reuse the same demand signal across channels.
              </p>
            </article>
          </section>

          <h2 className="section-header">
            Keyword-to-page <em>fit</em>
            <span className="section-header__hint">
              <LuGlobe size={14} aria-hidden="true" /> live website crawl
            </span>
          </h2>
          <p className="section-subhead">
            The highest-priority places to strengthen existing pages or create new landing
            pages based on Semrush keyword value and current on-site coverage.
          </p>
          <DataTable
            columns={pageColumns}
            rows={analysis.pageOpportunities.slice(0, 30)}
            defaultSort={{ key: 'priority', dir: 'desc' }}
            hint={`${analysis.pageOpportunities.length} keyword/page opportunities`}
            exportFileStem="seo-aeo-page-opportunities"
            expandable={{
              triggerColumn: 'recommendation',
              showLabel: 'How to fix',
              hideLabel: 'Hide details',
              render: (row) => (
                <FixDetail heading="Why this fix matters" text={row.recommendation} />
              ),
            }}
          />

          <h2 className="section-header section-header--inset">
            Answer engine <em>questions</em>
            <span className="section-header__hint">
              <LuSparkles size={14} aria-hidden="true" /> AEO / long-tail
            </span>
          </h2>
          <p className="section-subhead">
            These are concise question-answer blocks the site should answer directly so AI
            tools and search results can understand Leapfrog's fit.
          </p>
          <DataTable
            columns={questionColumns}
            rows={analysis.questionOpportunities.slice(0, 25)}
            defaultSort={{ key: 'fit', dir: 'asc' }}
            exportFileStem="seo-aeo-answer-questions"
            expandable={{
              triggerColumn: 'recommendation',
              showLabel: 'How to fix',
              hideLabel: 'Hide details',
              render: (row) => (
                <FixDetail
                  heading="Recommended answer strategy"
                  text={row.recommendation}
                />
              ),
            }}
          />

          <h2 className="section-header section-header--inset">
            Campaign <em>clusters</em>
            <span className="section-header__hint">
              <LuMegaphone size={14} aria-hidden="true" /> paid, organic, earned
            </span>
          </h2>
          <p className="section-subhead">
            Values use Semrush CPC and volume from the uploaded PDF rows. To avoid double-counting,
            each keyword contributes once: local scope for geo keywords, national scope otherwise.
            Formula: estimated clicks = volume × CTR by current rank; estimated traffic value =
            estimated clicks × Semrush CPC.
          </p>
          <DataTable
            columns={campaignColumns}
            rows={analysis.campaignClusters.slice(0, 12)}
            defaultSort={{ key: 'paidValue', dir: 'desc' }}
            exportFileStem="seo-aeo-campaign-clusters"
            expandable={{
              triggerColumn: 'theme',
              showLabel: 'View examples',
              hideLabel: 'Hide examples',
              renderTrigger: ({ row, isOpen, toggle, showLabel, hideLabel }) => (
                <div className="seo-campaign-trigger">
                  <span className="seo-campaign-trigger__theme">{row.theme}</span>
                  <button
                    type="button"
                    className={`seo-campaign-trigger__button${isOpen ? ' is-open' : ''}`}
                    aria-expanded={isOpen}
                    onClick={toggle}
                  >
                    <LuChevronDown size={13} aria-hidden="true" />
                    {isOpen ? hideLabel : showLabel}
                  </button>
                </div>
              ),
              render: (row) => <CampaignClusterDetail row={row} />,
            }}
          />

          <h2 className="section-header section-header--inset">
            Technical <em>cleanup</em>
            <span className="section-header__hint">
              <LuShieldCheck size={14} aria-hidden="true" /> crawlable signals
            </span>
          </h2>
          <DataTable
            columns={technicalColumns}
            rows={analysis.technical.slice(0, 30)}
            defaultSort={{ key: 'issueCount', dir: 'desc' }}
            exportFileStem="seo-aeo-technical-cleanup"
            expandable={{
              triggerColumn: 'recommendation',
              showLabel: 'How to fix',
              hideLabel: 'Hide details',
              render: (row) => (
                <FixDetail
                  heading="Client-ready fix explanation"
                  text={row.recommendation}
                />
              ),
            }}
          />

          {analysis.earnedMedia.length > 0 && (
            <section
              className="seo-earned-feature"
              aria-labelledby="seo-earned-feature-title"
            >
              <header className="seo-earned-feature__header">
                <span className="seo-earned-feature__eyebrow">
                  <LuMegaphone size={13} aria-hidden="true" />
                  Key insight · PR &amp; outreach playbook
                </span>
                <h2
                  id="seo-earned-feature-title"
                  className="seo-earned-feature__title"
                >
                  Earned media <em>angles</em>
                </h2>
                <p className="seo-earned-feature__subhead">
                  These are the strongest stories to pitch journalists, podcasters,
                  and analysts this quarter. Each angle pairs a topic Leapfrog can
                  credibly own with the page that should anchor the conversation.
                </p>
              </header>
              <ol className="seo-earned-grid">
                {analysis.earnedMedia.slice(0, 6).map((item, idx) => (
                  <li
                    key={item.topic}
                    className={`seo-earned-card${
                      idx === 0 ? ' seo-earned-card--featured' : ''
                    }`}
                  >
                    <span className="seo-earned-card__index" aria-hidden="true">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="seo-earned-card__theme">{item.theme}</span>
                    <h3 className="seo-earned-card__title">{item.topic}</h3>
                    <p className="seo-earned-card__angle">{item.angle}</p>
                    <div className="seo-earned-card__proof">
                      <LuLink2 size={13} aria-hidden="true" />
                      <span>{item.proof}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="seo-footer-link">
            <a href="https://leapfrogservices.com/" target="_blank" rel="noreferrer">
              Open live Leapfrog website <LuExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </>
      )}
    </>
  );
}
