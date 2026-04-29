// Auto-italicize the final word of a string title for the brand "italic accent"
// treatment described in DASHBOARD.md. If a JSX node is passed, render as-is.
function renderTitle(title) {
  if (typeof title !== 'string') return title;
  const trimmed = title.trim();
  if (!trimmed) return title;
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) {
    return <em className="page-title__accent">{trimmed}</em>;
  }
  return (
    <>
      {trimmed.slice(0, lastSpace)}{' '}
      <em className="page-title__accent">{trimmed.slice(lastSpace + 1)}</em>
    </>
  );
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  badge,
  badgeVariant = 'purple',
}) {
  const hasMeta = Boolean(meta || actions);

  return (
    <header className="page-header">
      <div className="page-header__lead">
        {(badge || hasMeta) && (
          <div
            className={`page-header__eyebrow-row${
              hasMeta ? ' page-header__eyebrow-row--has-meta' : ''
            }`}
          >
            {badge ? (
              <span
                className={`page-badge${
                  badgeVariant === 'green' ? ' page-badge--green' : ''
                }`}
              >
                <span className="page-badge__dot" />
                {badge}
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
            {hasMeta && (
              <div className="page-meta">
                {meta}
                {actions}
              </div>
            )}
          </div>
        )}
        <h1 className="page-title">{renderTitle(title)}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
    </header>
  );
}
