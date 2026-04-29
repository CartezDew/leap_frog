// Calculation accuracy matrix.
//
// PURPOSE: cross-check every formula and hand-typed total in the user's
// uploaded workbook against the dashboard's independently-computed value,
// and surface any discrepancies. This is the panel the user opens when
// they say "the dashboard doesn't match the number in my Excel."
//
// Three independent sources are compared per KPI:
//   1. The Dashboard value (what we display on the cards).
//   2. The same KPI re-summed from every relevant data sheet
//      (Medium / Source / Device / City / Page Path) and from the monthly
//      trend — they should all agree on partition sheets.
//   3. Any hand-typed value found on an "Executive Summary" / "Analysis"
//      tab in the user's workbook. We scrape labelled cells like
//      "Total Sessions: 21,844" and compare them too.
//
// Drift over 1% becomes a "warn" cell, drift over 10% becomes "error" — and
// the whole panel rolls those up into a banner so the user knows at a
// glance whether their numbers and ours agree.

import {
  LuShieldCheck,
  LuTriangleAlert,
  LuOctagonAlert,
  LuCircleHelp,
} from 'react-icons/lu';

const STATUS_TONE = {
  ok: 'green',
  warn: 'amber',
  error: 'red',
  info: 'info',
  reference: 'reference',
};

function statusIcon(status) {
  if (status === 'error') return LuOctagonAlert;
  if (status === 'warn') return LuTriangleAlert;
  if (status === 'ok') return LuShieldCheck;
  return LuCircleHelp;
}

function bannerHeadline(status, counts, userTypedCount) {
  if (status === 'error') {
    return `${counts.error || 0} KPI${counts.error === 1 ? '' : 's'} disagree with your uploaded calculations`;
  }
  if (status === 'warn') {
    return `${counts.warn || 0} KPI${counts.warn === 1 ? '' : 's'} drift slightly from your numbers`;
  }
  if (userTypedCount > 0) {
    return `Every dashboard number matches the ${userTypedCount} hand-typed total${userTypedCount === 1 ? '' : 's'} in your workbook`;
  }
  return 'Every KPI matches across all data sheets';
}

function bannerCopy(status, userTypedCount) {
  if (status === 'error') {
    return userTypedCount > 0
      ? `We compared the dashboard against ${userTypedCount} hand-typed total${userTypedCount === 1 ? '' : 's'} in your "Executive Summary"-style tab(s) and the cross-sheet rollups — at least one disagrees materially. Review the rows flagged red below to see which value to trust.`
      : 'Different sheets in the workbook report different totals for the same period. The dashboard uses the Medium sheet by default — review the matrix below to see which sheet you want to trust.';
  }
  if (status === 'warn') {
    return 'Numbers agree within a small tolerance. Review any rows flagged amber below — usually rounding or a slightly different formula in your workbook.';
  }
  return userTypedCount > 0
    ? 'Independent rollups from every data sheet agree, and they match the totals you typed by hand in your workbook. You can trust these numbers when reporting to leadership.'
    : 'Independent calculations across the Medium, Source, Device sheets, and the monthly trend all return the same totals. You can trust these numbers.';
}

function ProvenanceLine({ provenance, sheets }) {
  const list = sheets && sheets.length ? sheets.join(', ') : 'none';
  return (
    <p className="acc__prov">
      <strong>Source of truth:</strong> the dashboard reads site totals from the{' '}
      <code>{provenance || 'medium'}</code> sheet.
      <span className="acc__prov-sep"> · </span>
      <strong>Sheets compared:</strong> <code>{list}</code>
    </p>
  );
}

function deltaText(delta, deltaPct, format) {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  let formatted;
  if (format === 'pct') {
    formatted = `${(abs * 100).toFixed(1)} pts`;
  } else if (abs >= 1000) {
    formatted = Math.round(abs).toLocaleString('en-US');
  } else if (abs >= 10) {
    formatted = abs.toFixed(0);
  } else {
    formatted = abs.toFixed(2);
  }
  const pct =
    Number.isFinite(deltaPct) && deltaPct > 0
      ? ` (${(deltaPct * 100).toFixed(1)}%)`
      : '';
  return `${sign}${formatted}${pct}`;
}

function statusLabel(status) {
  if (status === 'error') return 'Disagrees';
  if (status === 'warn') return 'Drift';
  if (status === 'ok') return 'Match';
  if (status === 'info') return 'Different basis';
  return '—';
}

function Cell({ cell, format }) {
  const tone = STATUS_TONE[cell.status] || 'info';
  if (cell.role === 'reference') {
    return (
      <td className="acc__cell acc__cell--reference">
        <span className="acc__value">{cell.label_value}</span>
        <span className="acc__chip acc__chip--reference">Dashboard</span>
      </td>
    );
  }
  const delta = deltaText(cell.delta, cell.delta_pct, format);
  return (
    <td className={`acc__cell acc__cell--${tone}`}>
      <span className="acc__value">{cell.label_value}</span>
      {delta && (
        <span className={`acc__delta acc__delta--${tone}`}>{delta}</span>
      )}
      <span className={`acc__chip acc__chip--${tone}`}>
        {statusLabel(cell.status)}
      </span>
      {cell.note && <span className="acc__note">{cell.note}</span>}
    </td>
  );
}

function Row({ row }) {
  const tone = STATUS_TONE[row.status] || 'info';
  return (
    <>
      <tr className={`acc__row acc__row--${tone}`}>
        <th className="acc__row-head" scope="row">
          <span className="acc__kpi">{row.label}</span>
          {row.note && <span className="acc__row-note">{row.note}</span>}
        </th>
        {row.cells.map((cell) => (
          <Cell key={cell.id} cell={cell} format={row.format} />
        ))}
        {/* Pad if row has fewer cells than the column count (every row should
            have the same length, but this keeps tables aligned in edge
            cases). */}
      </tr>
    </>
  );
}

function GrandTotalDefenses({ defenses }) {
  if (!defenses || defenses.length === 0) return null;
  return (
    <div className="acc__defenses">
      <p className="acc__defenses-head">
        Pivot-table guards triggered
      </p>
      <ul className="acc__defenses-list">
        {defenses.map((d, idx) => (
          <li key={idx}>
            <strong>{d.sheet_name || d.sheet}</strong> — skipped{' '}
            <strong>
              {d.count} {d.kind === 'column' ? 'Grand Total column' : 'Grand Total row'}
              {d.count === 1 ? '' : 's'}
            </strong>{' '}
            ({d.labels.map((l) => `"${l}"`).join(', ')}). Including{' '}
            {d.kind === 'column' ? 'a column' : 'a row'} like that would have
            doubled the {d.sheet_name || d.sheet} total.
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProvenancePerSheet({ provenance }) {
  if (!provenance || Object.keys(provenance).length === 0) return null;
  const entries = Object.entries(provenance);
  return (
    <details className="acc__prov-detail">
      <summary>What was summed (per sheet)</summary>
      <ul className="acc__prov-list">
        {entries.map(([sheetKey, info]) => {
          const used = info.rows_used || [];
          const skipped = info.rows_skipped || [];
          const usedShort = used.length > 8 ? [...used.slice(0, 8), `…+${used.length - 8} more`] : used;
          return (
            <li key={sheetKey} className="acc__prov-sheet">
              <p className="acc__prov-sheet-head">
                <strong>{info.sheet_name || sheetKey}</strong>
                <span className="acc__prov-sheet-meta">
                  {info.months_detected} months · {info.metrics_per_month} metrics ·{' '}
                  {used.length} row{used.length === 1 ? '' : 's'} used
                  {skipped.length > 0
                    ? ` · ${skipped.length} skipped`
                    : ''}
                </span>
              </p>
              {usedShort.length > 0 && (
                <p className="acc__prov-sheet-rows">
                  <em>Rows summed:</em> {usedShort.join(', ')}
                </p>
              )}
              {skipped.length > 0 && (
                <p className="acc__prov-sheet-skipped">
                  <em>Rows skipped (looked like roll-ups):</em>{' '}
                  {skipped.map((s) => `"${s}"`).join(', ')}
                </p>
              )}
              {info.skipped_total_columns > 0 && (
                <p className="acc__prov-sheet-skipped">
                  <em>Columns skipped:</em>{' '}
                  {(info.rejected_column_headers || [])
                    .map((s) => `"${s}"`)
                    .join(', ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function WorstList({ worst, format = 'int' }) {
  if (!worst || worst.length === 0) return null;
  return (
    <div className="acc__worst">
      <p className="acc__worst-head">Largest gaps</p>
      <ol className="acc__worst-list">
        {worst.map((w, idx) => {
          const tone = STATUS_TONE[w.status] || 'info';
          const fmt = w.format === 'pct' ? 'pct' : format;
          const delta = deltaText(w.delta, w.delta_pct, fmt);
          return (
            <li key={idx} className={`acc__worst-item acc__worst-item--${tone}`}>
              <strong>{w.kpi_label}</strong> — {w.cell_label} reports{' '}
              <span className={`acc__delta acc__delta--${tone}`}>{delta}</span>{' '}
              vs dashboard.
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function AccuracyCheck({ accuracy }) {
  if (!accuracy || !Array.isArray(accuracy.rows) || accuracy.rows.length === 0) {
    return null;
  }

  const tone = STATUS_TONE[accuracy.status] || 'info';
  const Icon = statusIcon(accuracy.status);

  // Build the column header from the first row's cell labels (every row has
  // the same shape, so the first row is representative).
  const headerCells = accuracy.rows[0].cells.map((c) => c.label);
  const userTypedCount = accuracy.user_typed?.merged
    ? Object.keys(accuracy.user_typed.merged).length
    : 0;

  return (
    <section
      className={`acc acc--${tone}`}
      aria-label="Calculation accuracy check"
    >
      <header className="acc__head">
        <div className="acc__head-left">
          <span className={`acc__icon acc__icon--${tone}`} aria-hidden="true">
            <Icon size={20} />
          </span>
          <div>
            <p className="acc__eyebrow">
              Calculation accuracy check · your workbook vs the dashboard
            </p>
            <h2 className="acc__title">
              {bannerHeadline(accuracy.status, accuracy.counts, userTypedCount)}
            </h2>
            <p className="acc__sub">{bannerCopy(accuracy.status, userTypedCount)}</p>
          </div>
        </div>
        <div className="acc__counts">
          <span className="acc__count acc__count--ok">
            <strong>{accuracy.counts.ok || 0}</strong> match
          </span>
          <span className="acc__count acc__count--warn">
            <strong>{accuracy.counts.warn || 0}</strong> drift
          </span>
          <span className="acc__count acc__count--error">
            <strong>{accuracy.counts.error || 0}</strong> disagree
          </span>
        </div>
      </header>

      <ProvenanceLine
        provenance={accuracy.provenance}
        sheets={accuracy.available_sheets}
      />

      <GrandTotalDefenses defenses={accuracy.grand_total_defenses} />

      {accuracy.user_typed && (
        <p className="acc__user-typed">
          <strong>Your numbers, picked up automatically:</strong> we scanned{' '}
          <strong>
            {accuracy.user_typed.sheets_scanned.join(', ') || 'your analysis tabs'}
          </strong>{' '}
          for hand-typed totals (cells like "Total Sessions: 21,844") and
          paired each one with the dashboard's value below. Look for the row
          marked <em>"From your … tab"</em> — if it disagrees with the
          dashboard, check the formula in your spreadsheet.
        </p>
      )}

      <ProvenancePerSheet provenance={accuracy.provenance_per_sheet} />

      <div className="acc__table-wrap">
        <table className="acc__table">
          <thead>
            <tr>
              <th scope="col" className="acc__col-kpi">
                KPI
              </th>
              {headerCells.map((label, idx) => (
                <th key={idx} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accuracy.rows.map((row) => (
              <Row key={row.kpi} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <WorstList worst={accuracy.worst} />

      <details className="acc__how">
        <summary>How this works</summary>
        <ul>
          <li>
            <strong>Dashboard</strong> — the value we display on the cards. It
            comes from the <code>{accuracy.provenance || 'medium'}</code>{' '}
            sheet.
          </li>
          <li>
            <strong>Medium / Source / Device sheet</strong> — the same KPI
            re-summed independently from each sheet. They should all match
            because every session lands in exactly one row of each.
          </li>
          <li>
            <strong>City sheet</strong> — GA4 drops long-tail / “(not set)”
            cities, so the city total is usually <em>lower</em>. Compared for
            visibility only.
          </li>
          <li>
            <strong>Page Path sheet</strong> — one session can hit many pages,
            so the per-page total is usually <em>higher</em>. Compared for
            visibility only.
          </li>
          <li>
            <strong>Sum of monthly trend</strong> — sum across the 12 monthly
            buckets shown on the trend chart. Must equal the annual figure.
          </li>
          <li>
            <strong>From your “…” tab</strong> — when your workbook contains a
            tab with hand-typed KPI cells (e.g. “Total Sessions: 21,844”),
            we extract them and show them here so you can spot data-entry
            errors or formula differences.
          </li>
        </ul>
      </details>
    </section>
  );
}
