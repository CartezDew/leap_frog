import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { LuArrowRight, LuClock, LuUsers, LuTarget } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../components/ChartWrapper/ChartWrapper.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { KpiCard } from '../components/KpiCard/KpiCard.jsx';
import { StoryCards } from '../components/StoryCards/StoryCards.jsx';
import { useData } from '../context/DataContext.jsx';
import { formatDate, formatInteger, formatPercent } from '../lib/formatters.js';

const TYPE_COLORS = {
  'Sales Lead': '#16a34a',
  Partnership: '#522e91',
  'Job Seeker': '#2563eb',
  'Support Request': '#d97706',
  Spam: '#dc2626',
  'Needs Review': '#6b7280',
  Unknown: '#9ca3af',
};

const messageColumns = [
  {
    key: 'conversion_date',
    header: 'Date',
    format: (v) => formatDate(v),
  },
  {
    key: 'lead_type',
    header: 'Type',
    render: (row) => (
      <span
        className="pill pill--purple"
        title={row.lead_type}
      >
        {row.lead_type}
      </span>
    ),
  },
  {
    key: 'how_can_we_help',
    header: 'Message',
    className: 'col-strong',
    format: (v) => {
      const text = String(v ?? '');
      return text.length > 220 ? `${text.slice(0, 220)}…` : text || '—';
    },
  },
  {
    key: 'conversion_page',
    header: 'Entry Page',
  },
];

export function ContactFormIntel() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const contacts = analyzed.contacts || [];
  const summary = analyzed.contacts_summary || { total: 0, by_type: {}, by_pct: {} };
  const bridge = analyzed.unique?.researcher_lead_bridge;
  const breakdown = Object.entries(summary.by_type || {}).map(([type, count]) => ({
    type,
    count,
    pct: summary.by_pct?.[type] || 0,
  }));

  const salesLeads = summary.by_type?.['Sales Lead'] || 0;
  const partnerships = summary.by_type?.Partnership || 0;
  const spam = summary.by_type?.Spam || 0;
  const total = summary.total || 0;
  const qualifiedPct = total ? (salesLeads + partnerships) / total : 0;
  const spamPct = total ? spam / total : 0;
  const totalUsers = analyzed.summary?.total_users || 0;
  const sessionToLeadRate = totalUsers ? salesLeads / totalUsers : 0;

  const bridgeCards = [
    {
      tone: 'green',
      icon: LuTarget,
      label: 'Lead quality',
      value: formatPercent(qualifiedPct, 0),
      headline: `${formatInteger(salesLeads)} sales lead${salesLeads === 1 ? '' : 's'} + ${formatInteger(partnerships)} partnership${partnerships === 1 ? '' : 's'}`,
      caption: spam > 0
        ? `${formatPercent(spamPct, 0)} spam already filtered. Clean signal at the top of the funnel.`
        : 'No spam in the dataset — clean signal at the top of the funnel.',
    },
    {
      tone: 'info',
      icon: LuClock,
      label: 'Avg research window',
      value: bridge?.avg_months_active ? `${bridge.avg_months_active.toFixed(1)} mo` : '—',
      headline: bridge?.multi_month_count
        ? `${bridge.multi_month_count} long-funnel researcher${bridge.multi_month_count === 1 ? '' : 's'} in the audience`
        : 'No multi-month researchers identified',
      caption: 'Multi-month researchers visit across multiple months before submitting — a buying signal Google Analytics never connects to your form.',
    },
    {
      tone: bridge && bridge.research_to_lead_ratio >= 1 ? 'green' : 'amber',
      icon: LuArrowRight,
      label: 'Researcher → Lead ratio',
      value: bridge?.research_to_lead_ratio
        ? bridge.research_to_lead_ratio.toFixed(2)
        : '—',
      headline:
        bridge && bridge.multi_month_count
          ? `${formatInteger(salesLeads)} qualified leads from ${formatInteger(bridge.multi_month_count)} researchers`
          : 'Not enough multi-month users to compute',
      caption: 'How efficiently long-funnel research turns into a sales conversation.',
    },
    {
      tone: 'purple',
      icon: LuUsers,
      label: 'Lead per 1k users',
      value: totalUsers ? (sessionToLeadRate * 1000).toFixed(1) : '—',
      headline: `${formatInteger(salesLeads)} leads from ${formatInteger(totalUsers)} unique users`,
      caption: 'Site-level conversion — your private benchmark across years and campaigns.',
    },
  ];

  if (contacts.length === 0) {
    return (
      <EmptyState
        title="No Contact sheet detected"
        body="Upload a workbook with a Contact sheet (how_can_we_help_you_) to populate this view."
      />
    );
  }

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Contact Form Intel"
        subtitle="Every form submission classified by intent — route sales leads, ignore spam, and watch for support."
      />

      <StoryCards
        eyebrow="Lead intelligence"
        title={<>From <em>research</em> to <em>request</em></>}
        cards={bridgeCards}
        ariaLabel="Lead intelligence callouts"
      />

      <div className="card-grid card-grid--cols-4">
        <KpiCard
          label="Total submissions"
          value={formatInteger(summary.total)}
        />
        <KpiCard
          label="Sales leads"
          value={formatInteger(summary.by_type?.['Sales Lead'] || 0)}
          accent="green"
        />
        <KpiCard
          label="Spam volume"
          value={formatInteger(summary.by_type?.Spam || 0)}
          accent="red"
        />
        <KpiCard
          label="Needs review"
          value={formatInteger(summary.by_type?.['Needs Review'] || 0)}
          accent="amber"
        />
      </div>

      {breakdown.length > 0 && (
        <ChartWrapper title="Submissions by category" subtitle="Counts per lead type.">
          <BarChart data={breakdown} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis dataKey="type" stroke="#6b7280" interval={0} angle={-15} textAnchor="end" height={50} />
            <YAxis stroke="#6b7280" />
            <Tooltip
              formatter={(value, _name, ctx) => [
                `${formatInteger(value)} (${formatPercent(ctx.payload.pct)})`,
                'Count',
              ]}
            />
            <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
              {breakdown.map((row, idx) => (
                <Cell key={idx} fill={TYPE_COLORS[row.type] || '#522e91'} />
              ))}
            </Bar>
          </BarChart>
        </ChartWrapper>
      )}

      <h2 className="section-header">All <em>submissions</em></h2>
      <DataTable columns={messageColumns} rows={contacts} hint={`${contacts.length} entries`} />
    </>
  );
}
