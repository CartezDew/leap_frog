// GA4 Excel parser — JavaScript port of server/services/parser.py.
//
// Implements every parsing rule from SKILL.md sections 1, 2, and 12:
//  - Sheet classification (sheet name -> column-header fingerprint).
//  - Defensive wide-format detection and reshaping.
//  - Flat-format reading for the User and Contact sheets.
//  - Pre-built analysis sheet pass-through.
//
// Operates on raw 2D arrays produced by SheetJS:
//   const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

import * as XLSX from 'xlsx';

import {
  ANALYSIS_SHEET_KEYWORDS,
  METRIC_ALIASES,
  MONTH_MAP,
} from './skillConfig.js';

// ---------------------------------------------------------------------------
// Header normalization & metric matching (SKILL.md 12.1, 12.2)
// ---------------------------------------------------------------------------

export function normalizeHeader(header) {
  if (header === null || header === undefined) return '';
  if (typeof header === 'number' && Number.isNaN(header)) return '';
  let s = String(header).trim().toLowerCase();
  s = s.replace(/[_-]/g, ' ');
  s = s.split(/\s+/).filter(Boolean).join(' ');
  return s;
}

export function matchMetric(normalized, aliases = METRIC_ALIASES) {
  if (!normalized) return null;
  for (const [canonical, list] of Object.entries(aliases)) {
    if (list.includes(normalized)) return canonical;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number' && Number.isNaN(v)) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

function safeNumber(v) {
  if (isBlank(v)) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function rowAt(grid, i) {
  return Array.isArray(grid?.[i]) ? grid[i] : [];
}

function shape(grid) {
  const rows = grid?.length || 0;
  let cols = 0;
  for (const r of grid || []) {
    if (Array.isArray(r) && r.length > cols) cols = r.length;
  }
  return [rows, cols];
}

// ---------------------------------------------------------------------------
// Sheet classification (SKILL.md 1.2)
// ---------------------------------------------------------------------------

function isAnalysisSheet(grid) {
  const [rows, cols] = shape(grid);
  if (rows < 1 || cols < 2) return false;
  const titleCells = rowAt(grid, 0).slice(0, Math.min(cols, 3));
  return titleCells.some((cell) => {
    if (isBlank(cell)) return false;
    const text = String(cell).toLowerCase();
    if (!text.includes('|')) return false;
    return (
      ANALYSIS_SHEET_KEYWORDS.some((kw) => text.includes(kw)) ||
      (text.includes('bot') && text.includes('traffic'))
    );
  });
}

function classifyByName(sheetName) {
  const name = String(sheetName || '').toLowerCase().trim();
  const nameClean = name.replace(/[-_]/g, ' ');
  const nameCompact = nameClean.replace(/\s+/g, '');

  if (nameClean.includes('source medium') || nameCompact.includes('sourcemedium')) {
    return 'source_medium_device';
  }
  if (nameClean.includes('consolidated')) return 'consolidated';
  if (nameClean.includes('new est') || nameClean.includes('established')) {
    return 'new_established';
  }
  if (nameClean.includes('page path') || nameCompact.includes('pagepath')) {
    return 'page_path';
  }
  if (nameClean.includes('contact')) return 'contact';
  if (nameClean.includes('city') || nameClean.includes('cities')) return 'city';
  if (nameClean.includes('device')) return 'device';
  if (nameClean.includes('medium')) return 'medium';
  if (nameClean.includes('user')) return 'user';
  if (nameClean.includes('source')) return 'source';
  return null;
}

function classifyByHeaders(grid) {
  const [rows] = shape(grid);
  if (rows === 0) return null;

  const tokens = [];
  for (const i of [0, 1]) {
    if (i >= rows) continue;
    for (const v of rowAt(grid, i)) tokens.push(normalizeHeader(v));
  }

  const has = (test) => tokens.some(test);
  const hasSessionSource = has((t) => t.includes('session source'));
  const hasDeviceCategory = has((t) => t.includes('device category'));
  const hasSessionMedium = has((t) => t.includes('session medium'));
  const hasCityHeader = has((t) => t === 'city');
  const hasPagePath = has(
    (t) => t.includes('page path') && t.includes('screen')
  );
  const hasUserId = has((t) => t === 'effective user id');
  const hasStreamName = has((t) => t === 'stream name');
  const hasHelp = has((t) => t.includes('how can we help'));
  const hasConversionDate = has((t) => t === 'conversion date');
  const hasNewEst = has(
    (t) => t.includes('new') && (t.includes('established') || t.includes('est'))
  );
  const hasCategory = has((t) => t === 'category');
  const hasMonth = has((t) => t === 'month');

  if (hasSessionSource && hasDeviceCategory) return 'source_medium_device';
  if (hasCategory && hasSessionSource && hasMonth) return 'consolidated';
  if (hasSessionSource) return 'source';
  if (hasSessionMedium) return 'medium';
  if (hasDeviceCategory) return 'device';
  if (hasCityHeader) return 'city';
  if (hasPagePath) return 'page_path';
  if (hasUserId || hasStreamName) return 'user';
  if (hasHelp || hasConversionDate) return 'contact';
  if (hasNewEst) return 'new_established';

  // Page paths can also appear as "/something" data values in column 0.
  for (let i = 2; i < Math.min(rows, 8); i += 1) {
    const v = rowAt(grid, i)[0];
    if (typeof v === 'string' && v.startsWith('/')) return 'page_path';
  }

  return null;
}

export function classifySheet(sheetName, grid) {
  // Report/calculation tabs can have names that overlap raw categories
  // ("Traffic Sources", "Contact Form Intel", "User ID Engagement"). Treat
  // banner-style sheets as reference material first so raw calculations only
  // come from the GA4 data tabs.
  if (isAnalysisSheet(grid)) return 'analysis';
  const byName = classifyByName(sheetName);
  if (byName) return byName;
  const byHeaders = classifyByHeaders(grid);
  if (byHeaders) return byHeaders;
  return 'unrecognized';
}

// ---------------------------------------------------------------------------
// Wide-format column detection & reshaping (SKILL.md 12.4, 12.5)
// ---------------------------------------------------------------------------

// Match cell values that look like a month indicator. Accepts:
//   - integers 1-12 (numeric or numeric-string)
//   - "Jan", "January", "Jan 2025", "January 2025", "2025-01", "2025/01"
const MONTH_TOKEN_RE = new RegExp(
  '^(?:' +
    // Year-month forms: "2025-01" or "2025/01"
    '\\d{4}[-/](0?[1-9]|1[0-2])' +
    '|' +
    // Optional month name with optional year
    '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)' +
    '(?:\\s+\\d{2,4})?' +
    ')$',
  'i',
);

function isMonthLabel(value) {
  if (isBlank(value)) return false;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 1 && value <= 12) return true;
    return false;
  }
  const s = String(value).trim();
  if (s === '') return false;
  if (/^(0?[1-9]|1[0-2])$/.test(s)) return true;
  return MONTH_TOKEN_RE.test(s);
}

// Match cell values that look like a "Grand Total" / "Total" / "All" rollup.
// We use this for both row labels and (now) row-0 column-group headers, so a
// "Grand Total" pivot column never gets interpreted as a 13th month.
const TOTAL_TOKEN_RE =
  /^(grand\s*totals?|grand\s*t|grand|totals?|sub\s*totals?|subtotal|all)\s*$/i;

function isTotalLabel(label) {
  if (label === null || label === undefined) return false;
  return TOTAL_TOKEN_RE.test(String(label).trim());
}

export function detectWideFormatColumns(grid, labelCols = 1) {
  const warnings = [];
  const [rows] = shape(grid);

  if (rows < 2) {
    warnings.push('Sheet has fewer than 2 header rows; cannot detect layout.');
    return {
      columnMap: {},
      metricsPerMonth: 0,
      numMonths: 0,
      warnings,
      skippedTotalColumns: 0,
      rejectedColumnHeaders: [],
    };
  }

  // Row 0: count distinct month transitions (skip label columns).
  // We must reject "Grand Total" / "Total" pivot-export columns or they get
  // counted as a 13th "month" and the year doubles. We must also stop scanning
  // past the last recognizable month so we don't pick up trailing summary or
  // commentary columns.
  const row0 = rowAt(grid, 0).slice(labelCols);
  const monthsFound = [];
  let currentMonth = null;
  let skippedTotalColumns = 0;
  const rejectedColumnHeaders = [];
  let stoppedAt = -1;

  for (let i = 0; i < row0.length; i += 1) {
    const v = row0[i];
    if (isBlank(v)) {
      if (currentMonth !== null) {
        // First trailing blank after we already started reading months ends
        // the month band — anything after a blank is summary / commentary.
        stoppedAt = i;
        break;
      }
      continue;
    }
    if (v === currentMonth) continue;
    if (isTotalLabel(v)) {
      skippedTotalColumns += 1;
      rejectedColumnHeaders.push(String(v).trim());
      stoppedAt = i;
      break;
    }
    if (currentMonth !== null && !isMonthLabel(v)) {
      // We were inside a month band and hit a non-month token — stop here so
      // we don't fold a "% YoY" or "Notes" column into the data.
      rejectedColumnHeaders.push(String(v).trim());
      stoppedAt = i;
      break;
    }
    monthsFound.push(v);
    currentMonth = v;
  }
  if (skippedTotalColumns > 0) {
    warnings.push(
      `Detected ${skippedTotalColumns} "Grand Total"-style column${
        skippedTotalColumns === 1 ? '' : 's'
      } in row 1 — those columns were skipped so totals are not double counted.`,
    );
  }
  if (rejectedColumnHeaders.length > 0 && skippedTotalColumns === 0) {
    warnings.push(
      `Stopped reading month columns at unrecognized header(s): ${rejectedColumnHeaders
        .map((h) => `"${h}"`)
        .join(', ')}. Anything to the right of this column was ignored.`,
    );
  }
  if (monthsFound.length > 12) {
    warnings.push(
      `Detected ${monthsFound.length} month groups in row 1 (> 12). Capping to the first 12 to avoid double-counting a roll-up column.`,
    );
    monthsFound.length = 12;
  }
  const numMonths = monthsFound.length;

  // Row 1: read first month-block headers.
  const row1 = rowAt(grid, 1).slice(labelCols);
  const firstBlockHeaders = [];
  for (const v of row1) {
    if (isBlank(v)) break;
    const norm = normalizeHeader(v);
    if (firstBlockHeaders.length > 0 && norm === firstBlockHeaders[0]) break;
    firstBlockHeaders.push(norm);
  }

  const metricsPerMonth = firstBlockHeaders.length;
  if (metricsPerMonth === 0) {
    warnings.push('Could not detect any metric headers in row 1.');
    return {
      columnMap: {},
      metricsPerMonth: 0,
      numMonths,
      warnings,
      skippedTotalColumns,
      rejectedColumnHeaders,
    };
  }

  const columnMap = {};
  firstBlockHeaders.forEach((header, offset) => {
    const canonical = matchMetric(header);
    if (canonical) {
      columnMap[canonical] = offset;
    } else {
      warnings.push(`Unrecognized metric in column offset ${offset}: '${header}'`);
    }
  });

  for (const required of ['sessions', 'engaged_sessions', 'total_users']) {
    if (!(required in columnMap)) {
      warnings.push(
        `REQUIRED METRIC MISSING: '${required}' not found. Headers detected: [${firstBlockHeaders.join(', ')}]`,
      );
    }
  }

  return {
    columnMap,
    metricsPerMonth,
    numMonths,
    warnings,
    skippedTotalColumns,
    rejectedColumnHeaders,
  };
}

function detectLabelCols(grid) {
  const [rows, cols] = shape(grid);
  if (cols < 2 || rows < 2) return 1;
  const r1c0 = normalizeHeader(rowAt(grid, 1)[0]);
  const r1c1 = normalizeHeader(rowAt(grid, 1)[1]);
  if (r1c1.includes('device') && (r1c0.includes('source') || r1c0.includes('medium'))) {
    return 2;
  }
  return 1;
}

const ALL_WIDE_METRICS = [
  'sessions',
  'engaged_sessions',
  'total_users',
  'new_users',
  'active_users',
  'bounce_rate_raw',
  'event_count',
  'avg_engagement_time',
];

export function reshapeWideToLong(grid, idColumnName) {
  const labelCols = detectLabelCols(grid);
  const {
    columnMap,
    metricsPerMonth,
    numMonths,
    warnings,
    skippedTotalColumns = 0,
    rejectedColumnHeaders = [],
  } = detectWideFormatColumns(grid, labelCols);

  // Independent column-walked totals. We compute these straight from the grid
  // — without going through aggregateWide — so the verifier can detect drift
  // between "sum every metric cell directly" and "sum after long-format
  // reshape + group-by". They should always match.
  const rawTotals = {
    row_count: 0,
    months_detected: numMonths,
    metrics_per_month: metricsPerMonth,
    label_cols: labelCols,
    skipped_total_rows: 0,
    skipped_total_columns: skippedTotalColumns,
    rejected_column_headers: rejectedColumnHeaders,
    rows_used: [],
    rows_skipped: [],
    sessions: 0,
    engaged_sessions: 0,
    total_users: 0,
    new_users: 0,
    active_users: 0,
    event_count: 0,
    sum_bounce_weighted: 0,
    sum_engagement_seconds: 0,
    rows_with_engaged_gt_sessions: 0,
    rows_with_new_gt_total_users: 0,
  };

  if (metricsPerMonth === 0 || numMonths === 0) {
    return { records: [], warnings, rawTotals };
  }

  const [rows, cols] = shape(grid);
  const records = [];

  for (let rowI = 2; rowI < rows; rowI += 1) {
    const row = rowAt(grid, rowI);
    const label = row[0];
    if (isBlank(label)) continue;
    const labelStr = String(label).trim();
    if (labelStr === '') continue;
    if (isTotalLabel(labelStr)) {
      rawTotals.skipped_total_rows += 1;
      rawTotals.rows_skipped.push(labelStr);
      continue;
    }

    let label2 = null;
    if (labelCols === 2) {
      const v = row[1];
      label2 = isBlank(v) ? '' : String(v).trim();
    }

    rawTotals.row_count += 1;
    rawTotals.rows_used.push(labelCols === 2 ? `${labelStr} / ${label2 || ''}` : labelStr);

    for (let monthIdx = 0; monthIdx < numMonths; monthIdx += 1) {
      const baseCol = labelCols + monthIdx * metricsPerMonth;
      const record = { [idColumnName]: labelStr, Month: monthIdx + 1 };
      if (labelCols === 2) record.Device = label2 || '';

      for (const metric of ALL_WIDE_METRICS) {
        if (metric in columnMap) {
          const col = baseCol + columnMap[metric];
          if (col < cols) {
            record[metric] = safeNumber(row[col]);
          } else {
            record[metric] = 0;
          }
        } else {
          record[metric] = 0;
        }
      }
      records.push(record);

      // Roll the same numbers into rawTotals using the SAME indices but a
      // separate accumulator, so a bug in aggregateWide can't mask itself.
      const sessions = record.sessions;
      const engaged = record.engaged_sessions;
      const totalUsers = record.total_users;
      const newUsers = record.new_users;
      const activeUsers = record.active_users;
      const events = record.event_count;
      const bounce = record.bounce_rate_raw;
      const engTime = record.avg_engagement_time;

      rawTotals.sessions += sessions;
      rawTotals.engaged_sessions += engaged;
      rawTotals.total_users += totalUsers;
      rawTotals.new_users += newUsers;
      rawTotals.active_users += activeUsers;
      rawTotals.event_count += events;
      rawTotals.sum_bounce_weighted += bounce * sessions;
      rawTotals.sum_engagement_seconds += engTime * sessions;

      if (engaged > sessions + 0.5) rawTotals.rows_with_engaged_gt_sessions += 1;
      if (newUsers > totalUsers + 0.5) rawTotals.rows_with_new_gt_total_users += 1;
    }
  }

  if (records.length === 0) {
    warnings.push(`No data rows found for ${idColumnName}.`);
  }

  return { records, warnings, rawTotals };
}

// ---------------------------------------------------------------------------
// Flat-format detection & reading (SKILL.md 12.6)
// ---------------------------------------------------------------------------

function gridToObjects(grid, { headerRow = 0 } = {}) {
  const [rows] = shape(grid);
  if (rows < 1) return { headers: [], records: [] };
  const headers = rowAt(grid, headerRow).map((h) =>
    isBlank(h) ? '' : String(h).trim(),
  );
  const records = [];
  for (let i = headerRow + 1; i < rows; i += 1) {
    const row = rowAt(grid, i);
    if (row.every(isBlank)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = row[idx] ?? null;
    });
    records.push(obj);
  }
  return { headers, records };
}

// Some hand-curated tabs (e.g. "USER ID ENGAGEMENT ANALYSIS | …") put a banner
// title in row 0 and a summary band in subsequent rows before the actual table
// header row. Walk the first ~12 rows looking for the row that has the most
// recognized column tokens and return its index. Falls back to row 0.
function findHeaderRow(grid, expectedTokens, lookahead = 12) {
  const [rows] = shape(grid);
  const limit = Math.min(rows, lookahead);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i += 1) {
    const row = rowAt(grid, i).map((c) => normalizeHeader(c));
    if (row.every((c) => c === '')) continue;
    let score = 0;
    for (const cell of row) {
      if (!cell) continue;
      if (matchMetric(cell)) score += 1;
      if (expectedTokens.some((t) => cell === t || cell.includes(t))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore > 0 ? bestIdx : 0;
}

function detectFlatColumns(headers) {
  const map = {};
  for (const col of headers) {
    const canonical = matchMetric(normalizeHeader(col));
    if (canonical && !(canonical in map)) {
      map[canonical] = col;
    }
  }
  return map;
}

function safeReadFlat(records, headers, columnMap, requiredColumns, optionalDefaults) {
  const warnings = [];
  // Reverse map: actual header name -> canonical.
  const reverse = Object.fromEntries(
    Object.entries(columnMap).map(([canonical, actual]) => [actual, canonical]),
  );

  const renamed = records.map((rec) => {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      const canonical = reverse[k];
      if (canonical) {
        out[canonical] = v;
      } else {
        // keep original column too in case it's useful (e.g. Month).
        out[k] = v;
      }
    }
    return out;
  });

  const present = new Set(Object.values(columnMap).map((actual) => reverse[actual]));

  for (const req of requiredColumns) {
    if (!present.has(req)) {
      warnings.push(
        `REQUIRED COLUMN MISSING: '${req}'. Dashboard section may be unavailable.`,
      );
    }
  }

  for (const [opt, defaultVal] of Object.entries(optionalDefaults)) {
    if (!present.has(opt)) {
      for (const r of renamed) if (!(opt in r)) r[opt] = defaultVal;
      warnings.push(`Optional column '${opt}' not found. Defaulting to ${defaultVal}.`);
    }
  }

  return { records: renamed, warnings };
}

function readUserSheet(grid) {
  // Hand-curated user sheets often start with a title banner row + a summary
  // band before the real header row (e.g. "USER ID ENGAGEMENT ANALYSIS | …").
  // Detect the header row dynamically so we don't need a perfectly clean export.
  const headerRow = findHeaderRow(grid, [
    'user id',
    'effective user id',
    'sessions',
    'total sessions',
  ]);
  const { headers, records } = gridToObjects(grid, { headerRow });
  const columnMap = detectFlatColumns(headers);

  // engaged_sessions and Month are no longer strictly required: many real
  // exports are pre-aggregated per user with engagement_rate / months_active
  // / months_list instead. We back-fill engaged_sessions and months_active
  // below so the analyzer always has something to work with.
  const required = ['effective_user_id', 'sessions'];
  const optional = {
    engaged_sessions: 0,
    new_users: 0,
    views: 0,
    views_per_session: 0,
    bounce_rate_raw: 0,
    avg_engagement_time: 0,
    event_count: 0,
    events_per_session: 0,
    engagement_rate: 0,
    months_active: 0,
    months_list: '',
    id_type: '',
    stream_name: '',
  };

  const flat = safeReadFlat(records, headers, columnMap, required, optional);

  // Locate Month column and convert to integer month_num.
  let monthCol = null;
  for (const h of headers) {
    if (normalizeHeader(h) === 'month') {
      monthCol = h;
      break;
    }
  }

  if (!monthCol) {
    for (const r of flat.records) r.month_num = null;
  } else {
    for (const r of flat.records) {
      const raw = r[monthCol];
      let monthNum = null;
      if (typeof raw === 'string') {
        monthNum = MONTH_MAP[raw.trim()] ?? null;
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        monthNum = Math.round(raw);
      }
      r.month_num = monthNum;
    }
  }

  // Back-fill engaged_sessions when only an engagement_rate column was given.
  // This is common in pre-aggregated user-level GA4 exports.
  for (const r of flat.records) {
    const sessions = safeNumber(r.sessions);
    const engaged = safeNumber(r.engaged_sessions);
    const rate = safeNumber(r.engagement_rate);
    if (engaged === 0 && sessions > 0 && rate > 0 && rate <= 1) {
      r.engaged_sessions = Math.round(sessions * rate);
    }
  }

  return flat;
}

function readContactSheet(grid) {
  const { headers, records } = gridToObjects(grid);
  const columnMap = detectFlatColumns(headers);
  const required = ['how_can_we_help'];
  const optional = {
    conversion_date: '',
    conversion_page: '',
    conversion_title: '',
    effective_user_id: '',
  };
  return safeReadFlat(records, headers, columnMap, required, optional);
}

function readConsolidatedSheet(grid) {
  const { records } = gridToObjects(grid);
  return { records, warnings: [] };
}

// ---------------------------------------------------------------------------
// XLSX reading helpers
// ---------------------------------------------------------------------------

export function readWorkbookFromArrayBuffer(arrayBuffer) {
  // SheetJS handles .xlsx, .xls, .xlsm.
  return XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
}

export function workbookToGrids(workbook) {
  const sheets = {};
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: true,
    });
    sheets[name] = grid;
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const ID_COLUMN_BY_CATEGORY = {
  source: 'Source',
  medium: 'Medium',
  device: 'Device',
  city: 'City',
  page_path: 'Page',
  source_medium_device: 'Source',
  new_established: 'Bucket',
};

export function parseWorkbookGrids(grids, filename = '') {
  const classifications = {};
  const warnings = [];
  const parsed = {};
  const analysisSheets = {};
  const rawTotalsByCategory = {};

  for (const [sheetName, grid] of Object.entries(grids)) {
    if (!Array.isArray(grid) || grid.length === 0) {
      classifications[sheetName] = 'empty';
      warnings.push(`Sheet '${sheetName}' is empty; skipping.`);
      continue;
    }

    const category = classifySheet(sheetName, grid);
    classifications[sheetName] = category;

    if (category === 'analysis') {
      analysisSheets[sheetName] = grid;
      continue;
    }

    if (category === 'unrecognized') {
      warnings.push(`Sheet '${sheetName}' could not be classified automatically.`);
      continue;
    }

    if (category === 'consolidated') {
      try {
        const { records } = readConsolidatedSheet(grid);
        const existing = parsed.consolidated || [];
        if (records.length >= existing.length) parsed.consolidated = records;
      } catch (err) {
        warnings.push(`Failed to parse consolidated sheet '${sheetName}': ${err.message}`);
      }
      continue;
    }

    if (category === 'user') {
      try {
        const { records, warnings: w } = readUserSheet(grid);
        warnings.push(...w);
        const existing = parsed.user || [];
        if (records.length >= existing.length) parsed.user = records;
      } catch (err) {
        warnings.push(`Failed to parse User sheet '${sheetName}': ${err.message}`);
      }
      continue;
    }

    if (category === 'contact') {
      try {
        const { records, warnings: w } = readContactSheet(grid);
        warnings.push(...w);
        // Some workbooks ship both a raw `Contact` sheet AND an analyst's
        // narrative report named "Contact Form Intel". Both pass header
        // detection, but the report sheet is mostly summary text with empty
        // contact fields. Pick the sheet with the most records that have a
        // real `how_can_we_help` message — not just the longest grid.
        const isValid = (r) =>
          r && String(r.how_can_we_help || '').trim().length > 0;
        const validCount = records.filter(isValid).length;
        const existing = parsed.contact || [];
        const existingValid = existing.filter(isValid).length;
        if (validCount > existingValid) parsed.contact = records;
      } catch (err) {
        warnings.push(`Failed to parse Contact sheet '${sheetName}': ${err.message}`);
      }
      continue;
    }

    // Wide-format sheets.
    const idCol = ID_COLUMN_BY_CATEGORY[category] || 'Dimension';
    try {
      const {
        records,
        warnings: w,
        rawTotals,
      } = reshapeWideToLong(grid, idCol);
      warnings.push(...w);

      if (records.length === 0) {
        warnings.push(`Sheet '${sheetName}' produced no records after reshape.`);
        continue;
      }

      const existing = parsed[category] || [];
      if (records.length >= existing.length) {
        parsed[category] = records;
        if (rawTotals) {
          rawTotalsByCategory[category] = { ...rawTotals, sheet_name: sheetName };
        }
      }
    } catch (err) {
      warnings.push(
        `Failed to reshape sheet '${sheetName}' as ${category}: ${err.message}`,
      );
    }
  }

  const sheetsFound = Object.keys(parsed).sort();

  return {
    parsed,
    analysisSheets,
    rawTotals: rawTotalsByCategory,
    metadata: {
      filename,
      classifications,
      sheets_found: sheetsFound,
      warnings,
      analysis_sheets_present: Object.keys(analysisSheets),
      raw_totals: rawTotalsByCategory,
    },
  };
}

// Convenience: parse straight from an ArrayBuffer + filename.
export function parseWorkbookBuffer(arrayBuffer, filename = '') {
  const wb = readWorkbookFromArrayBuffer(arrayBuffer);
  const grids = workbookToGrids(wb);
  return parseWorkbookGrids(grids, filename);
}
