import { LuFolderOpen } from 'react-icons/lu';
import { Link } from 'react-router-dom';

import { useData } from '../../context/DataContext.jsx';

export function EmptyState({
  title = 'No data uploaded yet',
  body = 'Upload your GA4 property export and Semrush report as Excel workbooks (.xlsx or .xls), then run analysis — together they populate this dashboard.',
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
