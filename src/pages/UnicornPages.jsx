import { LuSparkles } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { DataTable } from '../components/DataTable/DataTable.jsx';
import { EmptyState } from '../components/EmptyState/EmptyState.jsx';
import { useData } from '../context/DataContext.jsx';
import {
  bounceClass,
  formatInteger,
  formatPercent,
} from '../lib/formatters.js';

const columns = [
  { key: 'page', header: 'Page Path', className: 'col-strong' },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    format: (v) => formatInteger(v),
  },
  {
    key: 'bounce_rate',
    header: 'Bounce',
    align: 'right',
    render: (row) => (
      <span className={bounceClass(row.bounce_rate)}>
        {formatPercent(row.bounce_rate)}
      </span>
    ),
    exportValue: (row) => formatPercent(row.bounce_rate),
  },
  {
    key: 'avg_engagement_time',
    header: 'Avg Engagement',
    align: 'right',
    format: (v) => `${(v || 0).toFixed(1)}s`,
  },
  {
    key: 'content_role',
    header: 'Role',
    exportValue: (row) => row.content_role ?? '',
  },
];

export function UnicornPages() {
  const { hasData, analyzed } = useData();
  if (!hasData || !analyzed) return <EmptyState />;

  const unicorns = analyzed.unicorns || [];
  const opportunities = analyzed.opportunities || [];

  const manufacturing = unicorns.filter((p) =>
    String(p.page || '').toLowerCase().includes('manufactur'),
  );

  return (
    <>
      <PageHeader
        badge="Live data"
        badgeVariant="green"
        title="Unicorn Pages"
        subtitle="Pages with ≥ 100 sessions and ≤ 25% bounce — your best engagement assets."
      />

      <div className="callout callout--green">
        <span className="callout__icon">
          <LuSparkles size={18} />
        </span>
        <div>
          <strong>{unicorns.length}</strong> unicorn page{unicorns.length === 1 ? '' : 's'}{' '}
          identified. Mine the messaging, structure, and CTAs from these and reuse them on
          high-bounce pages.
        </div>
      </div>

      <h2 className="section-header">All <em>unicorns</em></h2>
      <DataTable
        columns={columns}
        rows={unicorns}
        emptyMessage="No unicorn pages detected — bounce thresholds not met or page data missing."
        defaultSort={{ key: 'bounce_rate', dir: 'asc' }}
        exportFileStem="unicorn-pages-low-bounce"
      />

      {manufacturing.length > 0 && (
        <>
          <h2 className="section-header">Manufacturing-vertical <em>unicorns</em></h2>
          <DataTable
            columns={columns}
            rows={manufacturing}
            defaultSort={{ key: 'bounce_rate', dir: 'asc' }}
            exportFileStem="unicorn-pages-manufacturing"
          />
        </>
      )}

      <h2 className="section-header">Opportunity <em>counterparts</em></h2>
      <p className="section-subhead">
        Pages with traffic but bounce ≥ 45% — borrow content patterns from the unicorns
        above.
      </p>
      <DataTable
        columns={columns}
        rows={opportunities}
        emptyMessage="No high-bounce opportunity pages."
        defaultSort={{ key: 'bounce_rate', dir: 'desc' }}
        exportFileStem="unicorn-pages-high-bounce"
      />
    </>
  );
}
