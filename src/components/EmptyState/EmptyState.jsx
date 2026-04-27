import { LuFolderOpen } from 'react-icons/lu';
import { Link } from 'react-router-dom';

import { useData } from '../../context/DataContext.jsx';

export function EmptyState({
  title = 'No data uploaded yet',
  body = 'Upload a GA4 Excel export to populate this section.',
  cta = { to: '/upload', label: 'Go to Upload' },
  icon: Icon = LuFolderOpen,
}) {
  // Suppress the "no data" flash while we're still rehydrating from
  // localStorage. Once hydrated, if the dashboard truly has no data,
  // pages re-render past their `!hasData` guard and we render normally.
  const { hydrated } = useData();
  if (!hydrated) {
    return <div className="empty-state empty-state--loading" aria-hidden="true" />;
  }

  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon size={28} />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__body">{body}</p>
      {cta && (
        <Link to={cta.to} className="btn btn--primary">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
