// Lightweight, dependency-free table.
// Columns: { key, header, format?, align?, className?, render?, sortable?, sortValue? }
//
// Right-aligned cells that look like whole numbers (sessions, counts, etc.)
// get en-US thousands separators by default when no `format` or `render` is
// supplied — keeps tables readable without repeating formatters everywhere.
//
// Sorting:
//   - Every column is sortable by default (set `sortable: false` to opt out,
//     e.g. action/icon columns).
//   - The first click on a header that hasn't been sorted yet picks a sensible
//     default direction: descending for right-aligned/numeric columns,
//     ascending for everything else. Subsequent clicks toggle.
//   - Provide `sortValue: (row) => primitive` for columns whose displayed
//     value is a JSX render (badges, status pills) — otherwise we fall back
//     to the raw `row[col.key]`.
//   - Pass `defaultSort={{ key, dir }}` to seed the initial order; otherwise
//     the rows are shown in the order they arrive.

import { useMemo, useState } from 'react';

import { formatInteger } from '../../lib/formatters.js';

function defaultCellValue(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.align !== 'right' || col.format || col.render) return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return value;
  return formatInteger(n);
}

function getSortValue(col, row) {
  if (typeof col.sortValue === 'function') return col.sortValue(row);
  return row?.[col.key];
}

// Stable comparator that:
//   - keeps null/undefined/empty values at the bottom regardless of direction,
//   - compares numbers numerically (including numeric strings),
//   - falls back to a locale-aware string compare.
function compareValues(a, b, dir) {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);
  const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);

  let cmp;
  if (bothNumeric) {
    cmp = aNum - bNum;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  return dir === 'asc' ? cmp : -cmp;
}

function defaultDirFor(col) {
  return col.align === 'right' ? 'desc' : 'asc';
}

function SortIndicator({ state }) {
  // state: 'asc' | 'desc' | 'none'
  return (
    <span className={`table__sort table__sort--${state}`} aria-hidden="true">
      <span className="table__sort-up">▲</span>
      <span className="table__sort-down">▼</span>
    </span>
  );
}

export function DataTable({
  columns,
  rows,
  title,
  hint,
  emptyMessage = 'No rows.',
  toolbarRight,
  defaultSort,
}) {
  const [sort, setSort] = useState(() =>
    defaultSort && defaultSort.key
      ? { key: defaultSort.key, dir: defaultSort.dir || 'asc' }
      : null,
  );

  function handleHeaderClick(col) {
    if (col.sortable === false) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) {
        return { key: col.key, dir: defaultDirFor(col) };
      }
      return { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  const sortedRows = useMemo(() => {
    if (!sort || !Array.isArray(rows) || rows.length === 0) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    // Decorate-sort-undecorate to keep the sort stable across browsers.
    return rows
      .map((row, idx) => ({ row, idx, value: getSortValue(col, row) }))
      .sort((a, b) => {
        const cmp = compareValues(a.value, b.value, sort.dir);
        return cmp !== 0 ? cmp : a.idx - b.idx;
      })
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

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
      {!sortedRows || sortedRows.length === 0 ? (
        <div className="table-empty">{emptyMessage}</div>
      ) : (
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = col.sortable !== false;
                const isActive = sortable && sort && sort.key === col.key;
                const dir = isActive ? sort.dir : 'none';
                const ariaSort = !sortable
                  ? undefined
                  : isActive
                    ? dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none';
                const classes = [
                  col.align === 'right' ? 'num' : '',
                  sortable ? 'is-sortable' : '',
                  isActive ? 'is-sorted' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <th
                    key={col.key}
                    className={classes || undefined}
                    aria-sort={ariaSort}
                    scope="col"
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="table__sort-btn"
                        onClick={() => handleHeaderClick(col)}
                        title={`Sort by ${typeof col.header === 'string' ? col.header : col.key}`}
                      >
                        <span className="table__sort-label">{col.header}</span>
                        <SortIndicator state={dir} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => (
              <tr key={row.id || row.key || idx}>
                {columns.map((col) => {
                  const value = row[col.key];
                  const content = col.render
                    ? col.render(row, idx)
                    : col.format
                      ? col.format(value, row)
                      : defaultCellValue(col, value);
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
        </div>
      )}
    </div>
  );
}
