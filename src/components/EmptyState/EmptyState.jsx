import { LuFolderOpen } from 'react-icons/lu';
import { Link } from 'react-router-dom';

import { useData } from '../../context/DataContext.jsx';

export function EmptyState({
  title = 'No data uploaded yet',
  body = 'Upload your GA4 (Excel or CSV) and/or Semrush (PDF) reports, then run analysis — together they populate this dashboard.',
  cta = { to: '/upload', label: 'Go to Upload' },
  icon: Icon = LuFolderOpen,
  /** Use `start` when `body` is long diagnostics (lists); default centers short copy. */
  bodyAlign = 'center',
}) {
  // Suppress the "no data" flash while we're still rehydrating from
  // localStorage. Once hydrated, if the dashboard truly has no data,
  // pages re-render past their `!hasData` guard and we render normally.
  const { hydrated } = useData();
  if (!hydrated) {
    return <div className="empty-state empty-state--loading" aria-hidden="true" />;
  }

  const bodyClass =
    bodyAlign === 'start'
      ? 'empty-state__body empty-state__body--start'
      : 'empty-state__body';

  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon size={28} />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      {typeof body === 'string' ? (
        <p className={bodyClass}>{body}</p>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
      {cta && (
        <Link to={cta.to} className="btn btn--primary">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/**
 * Convenience preset: shown on a GA4-driven page (Insights, Bounce, Users…)
 * when the user has only uploaded a Semrush PDF and not a GA4 workbook.
 */
export function NeedsGA4EmptyState({
  pageLabel = 'This report',
  icon = LuFolderOpen,
}) {
  return (
    <EmptyState
      icon={icon}
      title={`${pageLabel} needs a GA4 report`}
      body={`${pageLabel} is built from a GA4 Excel export. Upload your GA4 workbook (.xlsx / .xls) and re-run analysis to unlock this view.`}
      cta={{ to: '/upload', label: 'Upload a GA4 report' }}
    />
  );
}

/**
 * Convenience preset: shown on the Keywords page when the user has only
 * uploaded a GA4 workbook and not a Semrush PDF.
 */
export function NeedsSemrushEmptyState({
  pageLabel = 'Keywords Intelligence',
  icon = LuFolderOpen,
}) {
  return (
    <EmptyState
      icon={icon}
      title={`${pageLabel} needs a Semrush report`}
      body={`${pageLabel} is built from Semrush "Organic Performance" PDF exports. Upload one or more Semrush PDFs and re-run analysis to unlock this view.`}
      cta={{ to: '/upload', label: 'Upload a Semrush PDF' }}
    />
  );
}
