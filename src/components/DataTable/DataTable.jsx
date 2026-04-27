// Lightweight, dependency-free table.
// Columns: { key, header, format?, align?, className?, render? }

export function DataTable({
  columns,
  rows,
  title,
  hint,
  emptyMessage = 'No rows.',
  toolbarRight,
}) {
  return (
    <div className="table-wrap">
      {(title || toolbarRight || hint) && (
        <div className="table-toolbar">
          <div>
            {title && <h3 className="table-toolbar__title">{title}</h3>}
            {hint && <p className="table-toolbar__hint">{hint}</p>}
          </div>
          {toolbarRight}
        </div>
      )}
      {!rows || rows.length === 0 ? (
        <div className="table-empty">{emptyMessage}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={col.align === 'right' ? 'num' : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id || row.key || idx}>
                {columns.map((col) => {
                  const value = row[col.key];
                  const content = col.render
                    ? col.render(row, idx)
                    : col.format
                      ? col.format(value, row)
                      : value === null || value === undefined || value === ''
                        ? '—'
                        : value;
                  const className = [
                    col.align === 'right' ? 'num' : '',
                    col.className || '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td key={col.key} className={className || undefined}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
