// Calculation accuracy matrix.
//
// Why this module exists:
// -----------------------
// The user reported that totals on the dashboard didn't match the totals they
// computed by hand in Excel. We already had a verifier comparing two paths
// (raw cell sum vs long-format aggregation), but two related problems
// remained:
//
//   (a) GA4 exports the same period broken down by Medium, Source, Device,
//       City, etc. Each sheet should report identical session totals, but in
//       practice they often disagree by 5–25%. The dashboard picks ONE sheet
//       (Medium) for site totals — without ever telling the user that the
//       other sheets contain different numbers.
//
//   (b) Many users hand-build an "Executive Summary" tab in their workbook
//       with cells like "Total Sessions: 21,844". Our parser never reads
//       those tabs, so when the user sees 28,801 on the dashboard versus
//       21,844 in Excel they assume the dashboard is wrong.
//
// This module solves both:
//
//   1. Computes every headline KPI from every available data sheet, side by
//      side, and labels which one the dashboard is using.
//   2. Scans any "analysis" / "executive summary" tab in the uploaded
//      workbook for hand-typed KPI labels (Total Sessions, Engaged Sessions,
//      Site Avg Bounce, Total Users, New Users, …) and pairs them with the
//      computed value next to them.
//   3. Returns a flat matrix that the UI can render as one giant table:
//      KPI → { dashboard, medium, source, device, monthly_sum, user_typed }
//      with per-cell variance vs the dashboard value.
//
// All variances are pure data — the UI decides red/amber/green thresholds.

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Threshold (as a fraction) above which we tag a cell with status="warn".
const WARN_PCT = 0.01; // 1%
// Threshold above which we escalate to status="error".
const ERROR_PCT = 0.1; // 10%
// Absolute tolerance — drift smaller than this is treated as rounding noise.
const ABS_TOL = 1.0;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function num(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeDiv(a, b, fallback = 0) {
  const d = num(b, 0);
  if (!d) return fallback;
  return num(a, 0) / d;
}

function pctDelta(expected, actual) {
  const e = Math.abs(num(expected, 0));
  const a = Math.abs(num(actual, 0));
  if (e === 0 && a === 0) return 0;
  if (e === 0) return 1;
  return Math.abs(a - e) / e;
}

function classifyDelta(delta, deltaPct, format) {
  // Treat the variance as zero if both the absolute and percentage drift are
  // tiny (rounding-noise territory).
  if (Math.abs(delta) <= ABS_TOL && deltaPct <= WARN_PCT) return 'ok';
  if (deltaPct >= ERROR_PCT) return 'error';
  if (deltaPct >= WARN_PCT) return 'warn';
  if (format === 'pct' && Math.abs(delta) >= 0.005) return 'warn';
  return 'ok';
}

function fmtInt(v) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : String(v);
}

function fmtPct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : String(v);
}

// ---------------------------------------------------------------------------
// Per-sheet KPI rollup
// ---------------------------------------------------------------------------

// Returns a normalized rollup of the four headline metrics for a given
// long-format record set (output of parser.reshapeWideToLong).
function rollupRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let sessions = 0;
  let engaged = 0;
  let totalUsers = 0;
  let newUsers = 0;
  let activeUsers = 0;
  let eventCount = 0;
  let weightedBounce = 0;
  for (const r of records) {
    const s = num(r.sessions);
    sessions += s;
    engaged += num(r.engaged_sessions);
    totalUsers += num(r.total_users);
    newUsers += num(r.new_users);
    activeUsers += num(r.active_users);
    eventCount += num(r.event_count);
    weightedBounce += num(r.bounce_rate_raw) * s;
  }
  return {
    sessions,
    engaged_sessions: engaged,
    total_users: totalUsers,
    new_users: newUsers,
    active_users: activeUsers,
    event_count: eventCount,
    bounce_rate_calc: sessions ? 1 - engaged / sessions : 0,
    bounce_rate_weighted_raw: sessions ? weightedBounce / sessions : 0,
    engagement_rate: safeDiv(engaged, sessions, 0),
    new_user_rate: safeDiv(newUsers, totalUsers, 0),
  };
}

// ---------------------------------------------------------------------------
// Hand-typed KPI scraping
// ---------------------------------------------------------------------------

// Patterns we look for in any "analysis" sheet. Each entry is a label
// regex (case-insensitive) and the canonical KPI key it maps to.
//
// We deliberately avoid greedy patterns — we only match labels that are
// strongly KPI-shaped to keep false positives low.
const KPI_LABEL_PATTERNS = [
  { kpi: 'sessions', re: /^\s*(total\s+)?sessions?\s*$/i },
  { kpi: 'engaged_sessions', re: /^\s*engaged\s+sessions?\s*$/i },
  { kpi: 'total_users', re: /^\s*total\s+users?\s*$/i },
  { kpi: 'new_users', re: /^\s*new\s+users?\s*$/i },
  { kpi: 'active_users', re: /^\s*active\s+users?\s*$/i },
  { kpi: 'event_count', re: /^\s*event\s+count\s*$/i },
  {
    kpi: 'bounce_rate_calc',
    re: /^\s*(site\s+(avg\s+)?bounce|all[- ]medium\s+bounce|overall\s+bounce|bounce\s+rate)\s*$/i,
  },
  { kpi: 'organic_bounce', re: /^\s*organic\s+bounce\s*$/i },
  { kpi: 'direct_bounce', re: /^\s*direct\s+bounce\s*$/i },
  { kpi: 'contact_sessions', re: /^\s*contact\s+sessions?\s*$/i },
  { kpi: 'engagement_rate', re: /^\s*engagement\s+rate\s*$/i },
];

function looksLikePercent(value) {
  if (typeof value !== 'string') return false;
  return /%\s*$/.test(value.trim());
}

function coerceNumeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strip thousands separators, currency, and percent suffixes.
  const cleaned = trimmed.replace(/[\s,$£€]/g, '');
  const isPct = /%\s*$/.test(cleaned);
  const stripped = cleaned.replace(/%\s*$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(stripped)) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  return isPct ? n / 100 : n;
}

// Scan a 2D grid for KPI label cells with a numeric value within 4 cells to
// the right, below, or one diagonal step (to absorb merged-cell layouts).
function scrapeGridForKpis(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return {};

  const rows = grid.length;
  const cols = grid.reduce((max, r) => Math.max(max, r?.length || 0), 0);

  const found = {};
  // Walk every cell. KPI labels are usually in the leftmost columns, so we
  // scan column-major light-side-of-the-sheet first to bias toward genuine
  // KPI cards.
  for (let row = 0; row < rows; row += 1) {
    const rowArr = grid[row] || [];
    for (let col = 0; col < cols; col += 1) {
      const cell = rowArr[col];
      if (typeof cell !== 'string') continue;
      const label = cell.trim();
      if (label.length < 4 || label.length > 40) continue;

      const match = KPI_LABEL_PATTERNS.find(({ re }) => re.test(label));
      if (!match) continue;
      if (found[match.kpi]) continue; // first match wins

      // Try cells in order of likelihood:
      //   1. cell directly below                   (KPI card layout)
      //   2. cell directly right                   (label/value pair)
      //   3. two cells below                       (label / unit / value)
      //   4. two cells right
      const candidates = [
        [row + 1, col],
        [row, col + 1],
        [row + 2, col],
        [row, col + 2],
        [row + 1, col + 1],
      ];

      for (const [r, c] of candidates) {
        if (r >= rows || c >= cols) continue;
        const v = grid[r]?.[c];
        const isPct = looksLikePercent(v);
        const numeric = coerceNumeric(v);
        if (numeric === null) continue;
        found[match.kpi] = {
          label,
          value: numeric,
          format: isPct || /bounce|rate/i.test(match.kpi) ? 'pct' : 'int',
          row,
          col,
        };
        break;
      }
    }
  }

  return found;
}

function scrapeAnalysisSheets(analysisSheets) {
  if (!analysisSheets || typeof analysisSheets !== 'object') return null;
  const out = { by_sheet: {}, merged: {} };
  for (const [name, grid] of Object.entries(analysisSheets)) {
    const found = scrapeGridForKpis(grid);
    if (!found || Object.keys(found).length === 0) continue;
    out.by_sheet[name] = found;
    for (const [kpi, val] of Object.entries(found)) {
      // Prefer the first sheet that named a value (analysis sheets are
      // ordered; the executive summary usually wins).
      if (!out.merged[kpi]) out.merged[kpi] = { ...val, sheet: name };
    }
  }
  return Object.keys(out.merged).length === 0 ? null : out;
}

// ---------------------------------------------------------------------------
// Build the comparison matrix
// ---------------------------------------------------------------------------

const KPI_CATALOG = [
  { key: 'sessions', label: 'Total Sessions', format: 'int' },
  { key: 'engaged_sessions', label: 'Engaged Sessions', format: 'int' },
  { key: 'total_users', label: 'Total Users', format: 'int' },
  { key: 'new_users', label: 'New Users', format: 'int' },
  {
    key: 'bounce_rate_calc',
    label: 'Site Bounce Rate',
    format: 'pct',
    note: '1 − Engaged ÷ Sessions',
  },
  {
    key: 'engagement_rate',
    label: 'Engagement Rate',
    format: 'pct',
    note: 'Engaged ÷ Sessions',
  },
  { key: 'new_user_rate', label: 'New User Rate', format: 'pct' },
];

// Map KPI key on the rollup → corresponding key on the dashboard summary.
const SUMMARY_KEYS = {
  sessions: 'total_sessions',
  engaged_sessions: 'engaged_sessions',
  total_users: 'total_users',
  new_users: 'new_users',
  bounce_rate_calc: 'site_bounce_rate',
  engagement_rate: 'engagement_rate',
  new_user_rate: 'new_user_rate',
};

// Each sheet declares whether its session totals are EXPECTED to match the
// site total. Medium/Source/Device are pure partitions: every session lands
// in exactly one row, so the sums must match. City is sampled (GA4 drops
// long-tail rows, so the sum is usually smaller) and Page Path is multi-hit
// (one session can show in many rows, so the sum is usually larger). We
// surface those for transparency but classify drift on them as 'info', not
// 'error'.
const SHEET_LABELS = [
  {
    key: 'medium',
    label: 'Medium sheet',
    expected_match: true,
    note: 'Sessions partitioned by traffic medium — should equal the site total.',
  },
  {
    key: 'source',
    label: 'Source sheet',
    expected_match: true,
    note: 'Sessions partitioned by traffic source — should equal the site total.',
  },
  {
    key: 'device',
    label: 'Device sheet',
    expected_match: true,
    note: 'Sessions partitioned by device — should equal the site total.',
  },
  {
    key: 'city',
    label: 'City sheet',
    expected_match: false,
    note: 'GA4 drops long-tail / "(not set)" cities. Total here is usually LOWER than the site total — that is expected.',
  },
  {
    key: 'page_path',
    label: 'Page Path sheet',
    expected_match: false,
    note: 'A session can hit many pages, so the per-page total is usually HIGHER than the site total. Compared for visibility only.',
  },
];

function buildSheetRollups(parsed) {
  const out = {};
  for (const { key } of SHEET_LABELS) {
    out[key] = rollupRecords(parsed?.[key]);
  }
  return out;
}

function monthlySumOf(monthly, key) {
  if (!Array.isArray(monthly) || monthly.length === 0) return null;
  return monthly.reduce((acc, m) => acc + num(m[key], 0), 0);
}

// Map a KPI catalog key to the corresponding monthly key.
const MONTHLY_KEYS = {
  sessions: 'sessions',
  engaged_sessions: 'engaged_sessions',
  total_users: 'total_users',
  new_users: 'new_users',
};

function makeRow({
  catalog,
  dashboardValue,
  rollups,
  monthlySumValue,
  userTyped,
}) {
  const cells = [];
  const fmt = catalog.format === 'pct' ? fmtPct : fmtInt;

  // Reference cell: the dashboard value. All variances are vs this.
  const dash = num(dashboardValue, NaN);
  const dashKnown = Number.isFinite(dash);

  cells.push({
    id: 'dashboard',
    label: 'Dashboard',
    role: 'reference',
    value: dashKnown ? dash : null,
    label_value: dashKnown ? fmt(dash) : '—',
    delta: 0,
    delta_pct: 0,
    status: 'reference',
  });

  for (const { key, label, expected_match, note } of SHEET_LABELS) {
    const rollup = rollups?.[key];
    if (!rollup) continue;
    const val = num(rollup[catalog.key], NaN);
    if (!Number.isFinite(val)) continue;
    const delta = dashKnown ? val - dash : 0;
    const deltaPct = dashKnown ? pctDelta(dash, val) : 0;
    let status;
    if (!dashKnown) {
      status = 'info';
    } else if (!expected_match) {
      // Don't escalate to warn/error for sheets where drift is expected.
      status = 'info';
    } else {
      status = classifyDelta(delta, deltaPct, catalog.format);
    }
    cells.push({
      id: `sheet.${key}`,
      label,
      role: 'sheet',
      expected_match,
      value: val,
      label_value: fmt(val),
      delta,
      delta_pct: deltaPct,
      status,
      note,
    });
  }

  if (monthlySumValue !== null && monthlySumValue !== undefined) {
    const val = num(monthlySumValue, NaN);
    if (Number.isFinite(val)) {
      const delta = dashKnown ? val - dash : 0;
      const deltaPct = dashKnown ? pctDelta(dash, val) : 0;
      cells.push({
        id: 'monthly_sum',
        label: 'Sum of monthly trend',
        role: 'derived',
        value: val,
        label_value: fmt(val),
        delta,
        delta_pct: deltaPct,
        status: dashKnown ? classifyDelta(delta, deltaPct, catalog.format) : 'info',
      });
    }
  }

  if (userTyped && Number.isFinite(num(userTyped.value, NaN))) {
    const val = num(userTyped.value);
    const delta = dashKnown ? val - dash : 0;
    const deltaPct = dashKnown ? pctDelta(dash, val) : 0;
    cells.push({
      id: 'user_typed',
      label: `From your "${userTyped.sheet}" tab`,
      role: 'user',
      value: val,
      label_value: fmt(val),
      delta,
      delta_pct: deltaPct,
      status: dashKnown ? classifyDelta(delta, deltaPct, catalog.format) : 'info',
      note: `Cell labelled "${userTyped.label}"`,
    });
  }

  // Worst status across non-reference cells dictates the row status.
  let rowStatus = 'ok';
  for (const c of cells) {
    if (c.role === 'reference') continue;
    if (c.status === 'error') rowStatus = 'error';
    else if (c.status === 'warn' && rowStatus !== 'error') rowStatus = 'warn';
  }

  return {
    kpi: catalog.key,
    label: catalog.label,
    format: catalog.format,
    note: catalog.note || null,
    cells,
    status: rowStatus,
  };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

// Map per-sheet rawTotals (from parser) → a small "what we summed" record
// the UI can show under each sheet, so the user can audit exactly which rows
// landed in the total and which were skipped.
function buildProvenancePerSheet(rawTotals) {
  if (!rawTotals || typeof rawTotals !== 'object') return {};
  const out = {};
  for (const [sheetKey, info] of Object.entries(rawTotals)) {
    if (!info) continue;
    out[sheetKey] = {
      sheet_name: info.sheet_name || null,
      rows_used: Array.isArray(info.rows_used) ? info.rows_used : [],
      rows_skipped: Array.isArray(info.rows_skipped) ? info.rows_skipped : [],
      skipped_total_rows: num(info.skipped_total_rows, 0),
      skipped_total_columns: num(info.skipped_total_columns, 0),
      rejected_column_headers: Array.isArray(info.rejected_column_headers)
        ? info.rejected_column_headers
        : [],
      months_detected: num(info.months_detected, 0),
      metrics_per_month: num(info.metrics_per_month, 0),
      sessions: num(info.sessions, 0),
      engaged_sessions: num(info.engaged_sessions, 0),
      total_users: num(info.total_users, 0),
      new_users: num(info.new_users, 0),
      event_count: num(info.event_count, 0),
    };
  }
  return out;
}

export function runAccuracyCheck({
  parsed,
  analysisSheets,
  summary,
  monthly,
  rawTotals,
}) {
  const rollups = buildSheetRollups(parsed);
  const userTypedAll = scrapeAnalysisSheets(analysisSheets);
  const provenance_per_sheet = buildProvenancePerSheet(
    rawTotals || parsed?._rawTotals,
  );

  const rows = [];
  for (const catalog of KPI_CATALOG) {
    const dashKey = SUMMARY_KEYS[catalog.key];
    const dashboardValue = summary?.[dashKey];
    const monthlyKey = MONTHLY_KEYS[catalog.key];
    const monthlySumValue = monthlyKey ? monthlySumOf(monthly, monthlyKey) : null;
    const userTyped = userTypedAll?.merged?.[catalog.key]
      ? {
          ...userTypedAll.merged[catalog.key],
          sheet: userTypedAll.merged[catalog.key].sheet,
        }
      : null;
    rows.push(
      makeRow({
        catalog,
        dashboardValue,
        rollups,
        monthlySumValue,
        userTyped,
      }),
    );
  }

  const status = rows.reduce((acc, r) => {
    if (r.status === 'error') return 'error';
    if (r.status === 'warn' && acc !== 'error') return 'warn';
    return acc;
  }, 'ok');

  // Counts & pretty summaries for the banner.
  const counts = { ok: 0, warn: 0, error: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  // Build a small leaderboard of the worst variances so the banner has
  // something concrete to surface.
  const worst = [];
  for (const row of rows) {
    for (const c of row.cells) {
      if (c.role === 'reference') continue;
      if (c.status !== 'warn' && c.status !== 'error') continue;
      worst.push({
        kpi: row.kpi,
        kpi_label: row.label,
        format: row.format,
        cell_label: c.label,
        delta: c.delta,
        delta_pct: c.delta_pct,
        status: c.status,
        dashboard: row.cells[0]?.value ?? null,
        candidate: c.value,
      });
    }
  }
  worst.sort((a, b) => b.delta_pct - a.delta_pct);

  // Provenance: which sheet did the dashboard pick for site totals?
  const provenance = parsed?.medium?.length
    ? 'medium'
    : parsed?.source?.length
      ? 'source'
      : parsed?.device?.length
        ? 'device'
        : null;

  // List the sheets we even had available.
  const available_sheets = Object.entries(rollups)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // Aggregate "skipped Grand Total" warnings into a single signal the UI
  // can highlight loudly: if any sheet had a Grand Total row/column rejected,
  // we emit a top-level note so users know we actively defended against the
  // most common pivot-table over-count bug.
  const grand_total_defenses = [];
  for (const [sheetKey, info] of Object.entries(provenance_per_sheet)) {
    if (info.skipped_total_rows > 0) {
      grand_total_defenses.push({
        sheet: sheetKey,
        sheet_name: info.sheet_name,
        kind: 'row',
        count: info.skipped_total_rows,
        labels: info.rows_skipped,
      });
    }
    if (info.skipped_total_columns > 0) {
      grand_total_defenses.push({
        sheet: sheetKey,
        sheet_name: info.sheet_name,
        kind: 'column',
        count: info.skipped_total_columns,
        labels: info.rejected_column_headers,
      });
    }
  }

  return {
    status,
    counts,
    rows,
    worst: worst.slice(0, 5),
    provenance,
    provenance_per_sheet,
    grand_total_defenses,
    available_sheets,
    user_typed: userTypedAll
      ? {
          merged: userTypedAll.merged,
          by_sheet: userTypedAll.by_sheet,
          sheets_scanned: Object.keys(analysisSheets || {}),
        }
      : null,
    rollups,
  };
}
