import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  LuArrowRight,
  LuBriefcase,
  LuCalendar,
  LuClipboardList,
  LuCopy,
  LuFilter,
  LuFlame,
  LuHandshake,
  LuLifeBuoy,
  LuMail,
  LuShieldOff,
  LuSparkles,
  LuTarget,
  LuTrendingUp,
  LuUserCheck,
  LuUsers,
} from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  formatDate,
  formatInteger,
  formatPercent,
  parseExcelDate,
} from '../lib/formatters.js';

const TYPE_COLORS = {
  'Sales Lead': '#16a34a',
  Partnership: '#522e91',
  'Job Seeker': '#2563eb',
  'Support Request': '#d97706',
  'Event / Conference': '#0ea5e9',
  Spam: '#dc2626',
  'Needs Review': '#6b7280',
  Unknown: '#9ca3af',
};

const TYPE_DESCRIPTIONS = {
  'Sales Lead':
    'Prospects asking for IT services, MSP support, cybersecurity, CMMC, Microsoft 365, VoIP, or replacing a current provider. These are the messages your BD team should be calling within 24 hours.',
  Partnership:
    'Vendors, consultants, and resellers pitching collaboration, hardware, marketing services, payment processing, or facilities (cleaning, MDM, lead-gen). Useful to log, but not sales-qualified.',
  'Support Request':
    'Existing-client tickets that landed on the contact form by mistake — BitLocker lockouts, Citrix issues, network errors. Route to the help-desk queue immediately.',
  'Job Seeker':
    'Candidates following up on interviews, applications, or job opportunities. Forward to HR.',
  'Event / Conference':
    'Sponsorship, speaking, or event-collaboration outreach. Route to marketing for evaluation.',
  Spam: 'Clearly off-topic outreach — Wikipedia link farms, business brokers, crypto wallets, automated cold email. Safe to ignore.',
  'Needs Review':
    'Messages that didn’t match a known pattern. A human should glance at these to confirm intent.',
};

const TYPE_ICONS = {
  'Sales Lead': LuTarget,
  Partnership: LuHandshake,
  'Support Request': LuLifeBuoy,
  'Job Seeker': LuBriefcase,
  'Event / Conference': LuCalendar,
  Spam: LuShieldOff,
  'Needs Review': LuClipboardList,
  Unknown: LuClipboardList,
};

function shortPath(url) {
  if (!url) return '—';
  const s = String(url).trim();
  return s.replace(/^https?:\/\/[^/]+/i, '') || '/';
}

function snippet(text, max = 280) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const messageColumns = [
  {
    key: 'conversion_date',
    header: 'Date',
    format: (v) => formatDate(v),
    sortValue: (row) => {
      const d = parseExcelDate(row.conversion_date);
      return d ? d.getTime() : 0;
    },
  },
  {
    key: 'lead_type',
    header: 'Type',
    render: (row) => {
      const color = TYPE_COLORS[row.lead_type] || '#6b7280';
      return (
        <span
          className="lead-pill"
          style={{ background: `${color}1a`, color, borderColor: `${color}40` }}
          title={row.lead_type}
        >
          {row.lead_type}
        </span>
      );
    },
    sortValue: (row) => row.lead_type || '',
  },
  {
    key: 'how_can_we_help',
    header: 'Message',
    className: 'col-strong',
    format: (v) => snippet(v, 220) || '—',
  },
  {
    key: 'conversion_page',
    header: 'Entry Page',
    format: (v) => shortPath(v),
  },
];

export function ContactFormIntel() {
  const { hasData, analyzed } = useData();

  const summary = analyzed?.contacts_summary || {
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
  const contacts = analyzed?.contacts || [];

  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const da = parseExcelDate(a.conversion_date);
        const db = parseExcelDate(b.conversion_date);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      }),
    [contacts],
  );

  const recentSalesLeads = useMemo(
    () => sortedContacts.filter((c) => c.lead_type === 'Sales Lead').slice(0, 6),
    [sortedContacts],
  );

  if (!hasData || !analyzed) return <EmptyState />;

  if (contacts.length === 0) {
    return (
      <EmptyState
        title="No Contact sheet detected"
        body="Upload a GA4 or Semrush Excel workbook that includes a Contact sheet (how_can_we_help_you_) to populate this view."
      />
    );
  }

  const total = summary.total || 0;
  const salesLeads = summary.by_type?.['Sales Lead'] || 0;
  const partnerships = summary.by_type?.Partnership || 0;
  const support = summary.by_type?.['Support Request'] || 0;
  const spam = summary.by_type?.Spam || 0;
  const jobSeekers = summary.by_type?.['Job Seeker'] || 0;
  const events = summary.by_type?.['Event / Conference'] || 0;
  const totalUsers = analyzed.summary?.total_users || 0;
  const sessionToLeadRate = totalUsers ? salesLeads / totalUsers : 0;
  const dupes = summary.duplicates || { groups: 0, total_dupes: 0 };

  const breakdown = Object.entries(summary.by_type || {})
    .map(([type, count]) => ({
      type,
      count,
      pct: summary.by_pct?.[type] || 0,
    }))
    .sort((a, b) => b.count - a.count);

  const monthly = summary.monthly || [];
  const entryPages = summary.by_entry_page || [];
  const serviceInterest = summary.service_interest || [];
  const window = summary.window;

  // ---- Story cards: BD-team headline metrics.
  const bridgeCards = [
    {
      tone: 'green',
      icon: LuFlame,
      label: 'Sales-qualified leads',
      value: formatInteger(salesLeads),
      headline: `${formatPercent(salesLeads / Math.max(total, 1), 0)} of all submissions are real prospects`,
      caption: salesLeads
        ? 'Prospects explicitly asking about MSP, cybersecurity, CMMC, M365, VoIP, or replacing a current provider. Call within 24 hours.'
        : 'No sales-qualified messages detected in this window.',
    },
    {
      tone: 'purple',
      icon: LuUsers,
      label: 'Lead conversion rate',
      value: totalUsers ? `${(sessionToLeadRate * 1000).toFixed(2)} / 1k` : '—',
      headline: `${formatInteger(salesLeads)} leads from ${formatInteger(totalUsers)} unique users`,
      caption:
        'Sales leads per 1,000 site users. Use this as a private benchmark across years and campaigns.',
    },
    {
      tone: 'amber',
      icon: LuLifeBuoy,
      label: 'Existing-client misroutes',
      value: formatInteger(support),
      headline: support
        ? `${support} support ticket${support === 1 ? '' : 's'} landed on the contact form`
        : 'No misrouted support tickets',
      caption:
        'Existing clients hit the public form when they should be using the help-desk portal. Add a self-serve link to /contact/ to deflect.',
    },
    {
      tone: spam + jobSeekers + events > 0 ? 'red' : 'info',
      icon: LuShieldOff,
      label: 'Noise filtered',
      value: formatPercent((spam + jobSeekers + events) / Math.max(total, 1), 0),
      headline: `${formatInteger(spam)} spam + ${formatInteger(jobSeekers)} job + ${formatInteger(events)} event`,
      caption:
        'Submissions classified as low-priority noise. The classifier hides them so the BD queue stays clean.',
    },
  ];

  return (
    <>
      <PageHeader
        badge={window ? `Window: ${window.label}` : 'Live data'}
        badgeVariant="green"
        title="Contact Form Intel"
        subtitle={`${formatInteger(total)} form submission${total === 1 ? '' : 's'} captured and classified by intent — route real leads, ignore noise, watch for support.`}
      />

      <StoryCards
        eyebrow="What the inbox actually contains"
        title={
          <>
            <em>{formatInteger(salesLeads + partnerships)}</em> qualified out of {formatInteger(total)}
          </>
        }
        cards={bridgeCards}
        ariaLabel="Contact form intelligence callouts"
      />

      <div className="card-grid card-grid--cols-4">
        <KpiCard
          label="Total submissions"
          value={formatInteger(total)}
          sub={window?.label}
        />
        <KpiCard
          label="Sales-qualified"
          value={formatInteger(salesLeads)}
          sub={`${formatPercent(salesLeads / Math.max(total, 1), 0)} of inbox`}
          accent="green"
        />
        <KpiCard
          label="Partnership / vendor"
          value={formatInteger(partnerships)}
          sub={`${formatPercent(partnerships / Math.max(total, 1), 0)} of inbox`}
          accent="purple"
        />
        <KpiCard
          label="Spam / noise"
          value={formatInteger(spam + jobSeekers + events)}
          sub={`${formatInteger(spam)} spam · ${formatInteger(jobSeekers)} job · ${formatInteger(events)} event`}
          accent="red"
        />
      </div>

      {/* ----- Lead quality breakdown ----- */}
      <h2 className="section-header">
        Lead <em>quality breakdown</em>
        <span className="section-header__hint">
          <LuFilter size={14} aria-hidden="true" /> what each category means
        </span>
      </h2>
      <p className="section-subhead">
        Every message is auto-classified into one of six intent buckets so the inbox stops looking like noise.
        Hover the chart for counts; the legend on the right explains what each bucket actually means and what to do with it.
      </p>
      <div className="contact-breakdown">
        <div className="contact-breakdown__chart">
          <ChartWrapper height={300}>
            <PieChart>
              <Pie
                data={breakdown}
                dataKey="count"
                nameKey="type"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={2}
              >
                {breakdown.map((row) => (
                  <Cell key={row.type} fill={TYPE_COLORS[row.type] || '#522e91'} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, _name, ctx) => [
                  `${formatInteger(value)} (${formatPercent(ctx.payload.pct)})`,
                  ctx.payload.type,
                ]}
              />
            </PieChart>
          </ChartWrapper>
        </div>
        <ul className="contact-breakdown__legend" aria-label="Lead category descriptions">
          {breakdown.map((row) => {
            const Icon = TYPE_ICONS[row.type] || LuClipboardList;
            const color = TYPE_COLORS[row.type] || '#522e91';
            return (
              <li key={row.type} className="contact-legend-item">
                <span
                  className="contact-legend-item__icon"
                  style={{ background: `${color}1a`, color }}
                  aria-hidden="true"
                >
                  <Icon size={16} />
                </span>
                <div className="contact-legend-item__body">
                  <div className="contact-legend-item__title-row">
                    <span className="contact-legend-item__title">{row.type}</span>
                    <span className="contact-legend-item__count">
                      {formatInteger(row.count)}{' '}
                      <span className="contact-legend-item__pct">
                        ({formatPercent(row.pct, 0)})
                      </span>
                    </span>
                  </div>
                  <p className="contact-legend-item__desc">
                    {TYPE_DESCRIPTIONS[row.type] || ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ----- Monthly trend + entry pages side-by-side ----- */}
      <div className="card-grid card-grid--cols-2 contact-charts">
        {monthly.length > 0 && (
          <div className="contact-charts__cell">
            <h2 className="section-header">
              Monthly <em>submission mix</em>
              <span className="section-header__hint">
                <LuTrendingUp size={14} aria-hidden="true" /> when leads land
              </span>
            </h2>
            <p className="section-subhead">
              Stacked monthly volume by category. Sales-lead spikes correlate with campaign launches
              and SEO wins — match these months against the Traffic Sources page to find what worked.
            </p>
            <ChartWrapper height={280}>
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#6b7280" />
                <YAxis stroke="#6b7280" tickFormatter={(v) => formatInteger(v)} allowDecimals={false} />
                <Tooltip
                  formatter={(value, name) => [formatInteger(value), name]}
                  labelStyle={{ color: '#1f2937' }}
                />
                <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
                <Bar
                  dataKey="sales_leads"
                  stackId="contacts"
                  name="Sales Lead"
                  fill={TYPE_COLORS['Sales Lead']}
                />
                <Bar
                  dataKey="partnerships"
                  stackId="contacts"
                  name="Partnership"
                  fill={TYPE_COLORS.Partnership}
                />
                <Bar
                  dataKey="support"
                  stackId="contacts"
                  name="Support"
                  fill={TYPE_COLORS['Support Request']}
                />
                <Bar
                  dataKey="spam"
                  stackId="contacts"
                  name="Spam / noise"
                  fill={TYPE_COLORS.Spam}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartWrapper>
          </div>
        )}

        {entryPages.length > 0 && (
          <div className="contact-charts__cell">
            <h2 className="section-header">
              Entry-page <em>leaderboard</em>
              <span className="section-header__hint">
                <LuTarget size={14} aria-hidden="true" /> where leads come from
              </span>
            </h2>
            <p className="section-subhead">
              The pages where qualified leads start their journey. Double down on whatever is shipping prospects
              to the form — and audit pages that only attract spam.
            </p>
            <ul className="entry-page-list">
              {entryPages.slice(0, 6).map((row) => {
                const qualifiedRate = row.qualified_rate;
                return (
                  <li key={row.page} className="entry-page-item">
                    <div className="entry-page-item__head">
                      <code className="entry-page-item__path" title={row.page}>
                        {row.page}
                      </code>
                      <span className="entry-page-item__count">
                        {formatInteger(row.total)} sub{row.total === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="entry-page-item__bar" aria-hidden="true">
                      {row.sales_leads > 0 && (
                        <span
                          className="entry-page-item__bar-fill entry-page-item__bar-fill--sales"
                          style={{ width: `${(row.sales_leads / row.total) * 100}%` }}
                        />
                      )}
                      {row.partnerships > 0 && (
                        <span
                          className="entry-page-item__bar-fill entry-page-item__bar-fill--partner"
                          style={{ width: `${(row.partnerships / row.total) * 100}%` }}
                        />
                      )}
                      {row.support > 0 && (
                        <span
                          className="entry-page-item__bar-fill entry-page-item__bar-fill--support"
                          style={{ width: `${(row.support / row.total) * 100}%` }}
                        />
                      )}
                      {row.spam > 0 && (
                        <span
                          className="entry-page-item__bar-fill entry-page-item__bar-fill--spam"
                          style={{ width: `${(row.spam / row.total) * 100}%` }}
                        />
                      )}
                    </div>
                    <div className="entry-page-item__meta">
                      <span className="entry-page-item__chip entry-page-item__chip--sales">
                        {formatInteger(row.sales_leads)} sales
                      </span>
                      <span className="entry-page-item__chip entry-page-item__chip--partner">
                        {formatInteger(row.partnerships)} partner
                      </span>
                      <span className="entry-page-item__chip entry-page-item__chip--support">
                        {formatInteger(row.support)} support
                      </span>
                      <span className="entry-page-item__chip entry-page-item__chip--spam">
                        {formatInteger(row.spam)} spam
                      </span>
                      <span className="entry-page-item__rate">
                        {formatPercent(qualifiedRate, 0)} qualified
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ----- Service interest tag cloud ----- */}
      {serviceInterest.length > 0 && (
        <>
          <h2 className="section-header">
            What prospects are <em>actually asking for</em>
            <span className="section-header__hint">
              <LuSparkles size={14} aria-hidden="true" /> demand signal
            </span>
          </h2>
          <p className="section-subhead">
            Topics extracted from sales-lead and support messages — the things real customers and existing
            clients are bringing up. Use this to prioritize service pages, case studies, and proposal templates.
          </p>
          <div className="service-tags">
            {serviceInterest.map((tag) => (
              <div key={tag.label} className="service-tag">
                <span className="service-tag__count">{formatInteger(tag.count)}</span>
                <span className="service-tag__label">{tag.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ----- Sales lead hot list ----- */}
      {recentSalesLeads.length > 0 && (
        <>
          <h2 className="section-header">
            Sales-lead <em>hot list</em>
            <span className="section-header__hint">
              <LuUserCheck size={14} aria-hidden="true" /> route today
            </span>
          </h2>
          <p className="section-subhead">
            The {recentSalesLeads.length} most recent submissions classified as sales-qualified. Each card has
            the full message, entry page, and date — copy/paste straight into the CRM and call the prospect today.
          </p>
          <div className="lead-hotlist">
            {recentSalesLeads.map((row, idx) => (
              <article
                key={`${row.conversion_date}-${idx}`}
                className="lead-hotcard"
              >
                <header className="lead-hotcard__head">
                  <span className="lead-hotcard__icon" aria-hidden="true">
                    <LuMail size={16} />
                  </span>
                  <span className="lead-hotcard__date">
                    {formatDate(row.conversion_date)}
                  </span>
                  <span className="lead-hotcard__path" title={row.conversion_page}>
                    {shortPath(row.conversion_page)}
                  </span>
                </header>
                <p className="lead-hotcard__quote">"{snippet(row.how_can_we_help, 380)}"</p>
                <footer className="lead-hotcard__foot">
                  <span className="lead-hotcard__cta">
                    Route to BD <LuArrowRight size={12} />
                  </span>
                </footer>
              </article>
            ))}
          </div>
        </>
      )}

      {dupes.groups > 0 && (
        <div className="contact-callout">
          <span className="contact-callout__icon" aria-hidden="true">
            <LuCopy size={18} />
          </span>
          <div>
            <strong>{dupes.total_dupes} duplicate submission{dupes.total_dupes === 1 ? '' : 's'} detected</strong>
            <p>
              {dupes.groups} message{dupes.groups === 1 ? '' : 's'} appear more than once in the inbox —
              either a form-resend bug, a bot retrying, or the same person submitting from multiple devices.
              Worth a one-time audit of the form's success state.
            </p>
          </div>
        </div>
      )}

      <h2 className="section-header">All <em>submissions</em></h2>
      <DataTable
        columns={messageColumns}
        rows={sortedContacts}
        hint={`${formatInteger(sortedContacts.length)} entries`}
        defaultSort={{ key: 'conversion_date', dir: 'desc' }}
      />
    </>
  );
}
