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

import { useMemo, useState, useCallback } from 'react';
import { LuChevronDown } from 'react-icons/lu';

import { formatInteger } from '../../lib/formatters.js';
import { compareValues, defaultDirForColumn } from '../../lib/sortValues.js';
import { downloadSheetAsXlsx, downloadTableAsPdf } from '../../lib/tableExport.js';
import { VizExportToolbar } from '../VizExportToolbar/VizExportToolbar.jsx';

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

function headerLabel(col) {
  return typeof col.header === 'string' ? col.header : String(col.key ?? '');
}

function exportCellString(col, row, rowIdx) {
  if (typeof col.exportValue === 'function') {
    const v = col.exportValue(row, rowIdx);
    return v == null ? '' : String(v);
  }
  const value = row[col.key];
  if (col.render) {
    if (typeof col.format === 'function') {
      return String(col.format(value, row));
    }
    return value == null ? '' : String(value);
  }
  if (typeof col.format === 'function') {
    return String(col.format(value, row));
  }
  return String(defaultCellValue(col, value));
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
  /** Base filename (no extension); enables spreadsheet + PDF export of the current sorted rows. */
  exportFileStem,
  /** Export buttons appear only when sorted row count is strictly greater than this (default: 5 → 6+ rows). */
  minRowsForExport = 5,
  /**
   * Optional row-level disclosure that mirrors the Top-10 insights "How to fix" pattern.
   *
   *   expandable: {
   *     triggerColumn: 'recommendation',     // which column shows the toggle pill
   *     showLabel: 'How to fix',             // (optional) collapsed label
   *     hideLabel: 'Hide details',           // (optional) expanded label
   *     render: (row, idx) => <node>,        // detail content for the full-width row
   *   }
   *
   * The trigger column header still renders normally — only the cell body is
   * replaced with the pill. Excel/PDF exports still receive the column's
   * full text via `exportValue` / `format` / raw value, so the disclosure is
   * UI-only.
   */
  expandable,
}) {
  const [sort, setSort] = useState(() =>
    defaultSort && defaultSort.key
      ? { key: defaultSort.key, dir: defaultSort.dir || 'asc' }
      : null,
  );
  const [expandedRows, setExpandedRows] = useState(() => new Set());

  function handleHeaderClick(col) {
    if (col.sortable === false) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) {
        return { key: col.key, dir: defaultDirForColumn(col) };
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

  const showExport = Boolean(
    exportFileStem && sortedRows?.length > minRowsForExport,
  );

  const onExportXlsx = useCallback(() => {
    if (
      !exportFileStem ||
      !sortedRows?.length ||
      sortedRows.length <= minRowsForExport
    ) {
      return;
    }
    const headers = columns.map(headerLabel);
    const body = sortedRows.map((row, rowIdx) =>
      columns.map((col) => exportCellString(col, row, rowIdx)),
    );
    downloadSheetAsXlsx(exportFileStem, 'Data', headers, body);
  }, [columns, exportFileStem, minRowsForExport, sortedRows]);

  const onExportPdf = useCallback(() => {
    if (
      !exportFileStem ||
      !sortedRows?.length ||
      sortedRows.length <= minRowsForExport
    ) {
      return;
    }
    const headers = columns.map(headerLabel);
    const body = sortedRows.map((row, rowIdx) =>
      columns.map((col) => exportCellString(col, row, rowIdx)),
    );
    downloadTableAsPdf(exportFileStem, headers, body);
  }, [columns, exportFileStem, minRowsForExport, sortedRows]);

  return (
    <div className="table-wrap">
      {(title || toolbarRight || hint) && (
        <div className="table-toolbar">
          <div>
            {title && <h3 className="table-toolbar__title">{title}</h3>}
            {hint && <p className="table-toolbar__hint">{hint}</p>}
          </div>
          <div className="table-toolbar__actions">
            {toolbarRight}
          </div>
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
            {sortedRows.flatMap((row, idx) => {
              const rowKey = row.id || row.key || idx;
              const triggerKey = expandable?.triggerColumn;
              // Treat the row as expandable only if the trigger column has
              // non-empty content for this row — empty cells stay as a dash.
              const triggerValue =
                triggerKey != null ? row[triggerKey] : null;
              const hasDetail = Boolean(
                expandable && triggerKey && triggerValue != null && String(triggerValue).trim() !== '',
              );
              const isOpen = hasDetail && expandedRows.has(rowKey);
              const showLabel = expandable?.showLabel ?? 'How to fix';
              const hideLabel = expandable?.hideLabel ?? 'Hide details';
              const trEls = [
                <tr
                  key={rowKey}
                  className={isOpen ? 'is-open' : undefined}
                >
                  {columns.map((col) => {
                    const value = row[col.key];
                    let content;
                    if (hasDetail && col.key === triggerKey) {
                      content = (
                        <button
                          type="button"
                          className={`table__expand-trigger${isOpen ? ' is-open' : ''}`}
                          aria-expanded={isOpen}
                          onClick={() => {
                            setExpandedRows((prev) => {
                              const next = new Set(prev);
                              if (next.has(rowKey)) next.delete(rowKey);
                              else next.add(rowKey);
                              return next;
                            });
                          }}
                        >
                          <LuChevronDown size={14} aria-hidden="true" />
                          <span className="table__expand-trigger-label">
                            {isOpen ? hideLabel : showLabel}
                          </span>
                        </button>
                      );
                    } else if (col.render) {
                      content = col.render(row, idx);
                    } else if (col.format) {
                      content = col.format(value, row);
                    } else {
                      content = defaultCellValue(col, value);
                    }
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
                </tr>,
              ];
              if (isOpen) {
                trEls.push(
                  <tr
                    key={`${rowKey}-detail`}
                    className="table__detail-row"
                  >
                    <td colSpan={columns.length}>
                      <div className="table__detail-content">
                        {expandable.render
                          ? expandable.render(row, idx)
                          : String(triggerValue ?? '')}
                      </div>
                    </td>
                  </tr>,
                );
              }
              return trEls;
            })}
          </tbody>
        </table>
        </div>
      )}
      {showExport && (
        <div className="table-export-dock">
          <span className="table-export-dock__label">Download table</span>
          <VizExportToolbar
            onXlsx={onExportXlsx}
            onPdf={onExportPdf}
            className="viz-export-toolbar--dock"
          />
        </div>
      )}
    </div>
  );
}
