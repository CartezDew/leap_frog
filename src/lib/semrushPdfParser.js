// Semrush "Organic Performance" PDF parser.
//
// Parses one Semrush keyword export PDF in the browser using pdfjs-dist.
// Returns a structured monthly snapshot:
//
//   {
//     month:        '2025-10',                  // YYYY-MM
//     label:        'Oct 2025',                 // human label
//     generated_on: '2025-11-08',               // ISO date
//     filename:     'LF-Keywords-10-1-25.pdf',
//     local:        [{ keyword, position, cpc, volume }, …],
//     national:     [{ keyword, position, cpc, volume }, …],
//   }
//
// Cleaning notes:
//   - `position` is the SERP rank. `null` means the keyword was tracked but
//     not in the top 100 that month (Semrush prints "-").
//   - `cpc` and `volume` are taken straight from Semrush; "n/a" → null.
//   - The printed "Diff" column is intentionally dropped — the up/down
//     arrow glyphs do not survive PDF text extraction reliably, so the
//     keyword analyzer recomputes month-over-month direction from the raw
//     position values across snapshots.

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a static URL we hand to PDF.js for its worker.
import PDF_WORKER_URL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerConfigured = false;
function ensureWorker() {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  workerConfigured = true;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

// Replace control characters and non-breaking spaces with regular spaces so
// downstream regexes that use \s match cleanly. Semrush's exporter emits a
// stray NULL byte between adjacent fields (e.g. between report-period
// dates), which would otherwise prevent `\s+` from matching.
function cleanText(str) {
  return String(str || '')
    // Strip C0/C1 control chars (incl. \u0000) and the BOM.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\ufeff]/g, ' ')
    // Normalize NBSP → space.
    .replace(/[\u00a0\u202f\u2007]/g, ' ');
}

async function extractLines(buffer) {
  ensureWorker();
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();

    // Group items by Y so we get one logical line per visual row.
    const rows = new Map();
    for (const item of text.items) {
      if (!item || !item.str) continue;
      const trimmed = cleanText(item.str).trim();
      if (!trimmed) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ str: trimmed, x: item.transform[4] });
    }

    // Top → bottom of the page (PDF y origin is at the bottom).
    const sortedY = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const sorted = rows.get(y).sort((a, b) => a.x - b.x);
      const joined = sorted
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (joined) lines.push(joined);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Header parsing — report period + generated-on date
// ---------------------------------------------------------------------------

function parseShortDate(str) {
  // "10/1/25" → Date(2025, 9, 1) at UTC noon (avoid TZ slip)
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year = 2000 + year;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function periodFromDate(date, generatedOn) {
  if (!date) return { monthKey: null, monthLabel: null, generatedOn };
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return {
    monthKey: `${y}-${String(m + 1).padStart(2, '0')}`,
    monthLabel: `${MONTH_NAMES[m]} ${y}`,
    generatedOn,
  };
}

// Try to recover a report month from the filename. Semrush exports usually
// look like "LF-Keywords-10-1-25-10-31-25.pdf" — first M-D-YY pair is the
// period start.
function periodFromFilename(filename) {
  if (!filename) return null;
  const stripped = String(filename).replace(/\.[a-z0-9]+$/i, '');
  // Match "<m>-<d>-<yy>" anywhere in the name.
  const match = stripped.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year = 2000 + year;
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function parsePeriod(lines, filename) {
  let startDate = null;
  let generatedOn = null;

  // Loose pattern: two M/D/YY tokens with anything (incl. control chars
  // we already stripped, but also stray words) between them.
  const TWO_DATES_RX =
    /(\d{1,2}\/\d{1,2}\/\d{2,4})[^\d]+(\d{1,2}\/\d{1,2}\/\d{2,4})/;
  const SINGLE_DATE_RX = /(\d{1,2}\/\d{1,2}\/\d{2,4})/g;

  for (const line of lines) {
    if (!startDate) {
      const m = line.match(TWO_DATES_RX);
      if (m) startDate = parseShortDate(m[1]);
    }
    if (!generatedOn) {
      const g = line.match(/Generated on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
      if (g) {
        const d = new Date(`${g[1]} UTC`);
        if (!Number.isNaN(d.getTime())) {
          generatedOn = d.toISOString().slice(0, 10);
        }
      }
    }
    if (startDate && generatedOn) break;
  }

  // Fallback 1: scan all lines for M/D/YY tokens; the first one is the
  // period start. Catches PDFs whose two dates ended up on different
  // visual rows after extraction.
  if (!startDate) {
    for (const line of lines) {
      const all = line.match(SINGLE_DATE_RX);
      if (all && all.length > 0) {
        startDate = parseShortDate(all[0]);
        if (startDate) break;
      }
    }
  }

  // Fallback 2: pull the month from the filename (e.g. LF-Keywords-10-1-25…).
  if (!startDate) {
    startDate = periodFromFilename(filename);
  }

  // Fallback 3: derive from "Generated on" — Semrush typically generates
  // the report a few days after the period ends, so subtract a day and use
  // that calendar month.
  if (!startDate && generatedOn) {
    const gen = new Date(`${generatedOn}T12:00:00Z`);
    if (!Number.isNaN(gen.getTime())) {
      gen.setUTCDate(gen.getUTCDate() - 5);
      startDate = gen;
    }
  }

  return periodFromDate(startDate, generatedOn);
}

// ---------------------------------------------------------------------------
// Row parsing — `<rank>. <keyword> <position> <diff> <cpc> <volume>`
// ---------------------------------------------------------------------------

// 5-column ranked row. The diff column may be 1+ tokens (Semrush prints an
// arrow glyph that PDF.js sometimes returns as a separate item), so we use
// `(?:\s+\S+)+?` to skip it.
const RANKED_RX =
  /^\d+\.\s+(.+?)\s+(\d{1,3})(?:\s+\S+)+?\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;

// 4-column unranked row — Semrush prints "-" instead of a position and
// omits the diff entirely.
const UNRANKED_RX =
  /^\d+\.\s+(.+?)\s+-\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;

function num(token) {
  if (token == null) return null;
  const s = String(token).trim().toLowerCase();
  if (s === 'n/a' || s === '-' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseRankingLine(line) {
  if (!/^\d+\.\s/.test(line)) return null;

  let m = line.match(RANKED_RX);
  if (m) {
    return {
      keyword: m[1].trim().toLowerCase(),
      position: num(m[2]),
      cpc: num(m[3]),
      volume: num(m[4]),
    };
  }
  m = line.match(UNRANKED_RX);
  if (m) {
    return {
      keyword: m[1].trim().toLowerCase(),
      position: null,
      cpc: num(m[2]),
      volume: num(m[3]),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Section detection — Local Rankings vs National Rankings
// ---------------------------------------------------------------------------
//
// A single Semrush PDF usually has one Local table and one National table,
// each preceded by a section header. We track which section we are in by
// looking at the most recent header line we passed.

function buildSnapshot(lines, filename) {
  const period = parsePeriod(lines, filename);
  const local = [];
  const national = [];
  /** @type {'local'|'national'|null} */
  let section = null;

  // De-dupe by keyword (the same keyword can appear twice in malformed
  // exports; we keep the first occurrence in each section).
  const seen = { local: new Set(), national: new Set() };

  for (const line of lines) {
    if (/^Local Rankings/i.test(line)) {
      section = 'local';
      continue;
    }
    if (/^National Rankings/i.test(line)) {
      section = 'national';
      continue;
    }
    if (!section) continue;

    const row = parseRankingLine(line);
    if (!row) continue;
    if (seen[section].has(row.keyword)) continue;
    seen[section].add(row.keyword);
    (section === 'local' ? local : national).push(row);
  }

  return {
    month: period.monthKey,
    label: period.monthLabel,
    generated_on: period.generatedOn,
    filename: filename || null,
    local,
    national,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look for the literal "semrush" brand string anywhere in the extracted PDF
 * text. Used as a quick fingerprint check before we commit to parsing the
 * file as a Semrush keyword export.
 */
function hasSemrushFingerprint(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  for (const line of lines) {
    if (/semrush/i.test(line)) return true;
  }
  return false;
}

/**
 * Parse one Semrush PDF buffer.
 *
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {Promise<object>} monthly snapshot (see file header)
 */
export async function parseSemrushPdf(buffer, filename) {
  if (!buffer) throw new Error('No PDF buffer provided.');
  const lines = await extractLines(buffer);

  // Brand-fingerprint check first — refuse PDFs that don't even mention
  // Semrush, since the row-parser is tuned for their printed layout.
  const hasBrand = hasSemrushFingerprint(lines);
  if (!hasBrand) {
    throw new Error(
      `"${filename || 'PDF'}" doesn't appear to be a Semrush export — the word "Semrush" was not found in the document. Upload the original Semrush "Organic Performance" PDF.`,
    );
  }

  const snap = buildSnapshot(lines, filename);
  if (!snap.month && snap.local.length === 0 && snap.national.length === 0) {
    throw new Error(
      'PDF looked like Semrush but contained no ranking rows or report period — was a single page exported?',
    );
  }

  // Mark the snapshot as a verified Semrush export so downstream code can
  // distinguish it from any future PDF source we might add.
  snap.source = 'semrush';
  return snap;
}

/**
 * Sort an array of monthly snapshots oldest → newest and de-dupe by month
 * (keeping the most recently uploaded version). Snapshots that have no
 * month at all are kept and bucketed under a synthetic key so the page
 * still surfaces the keyword data instead of silently dropping it.
 */
export function consolidateSnapshots(snapshots) {
  const byMonth = new Map();
  let unknownCounter = 0;
  for (const s of snapshots) {
    if (!s) continue;
    const key = s.month || `unknown-${(unknownCounter += 1)}`;
    byMonth.set(key, { ...s, month: s.month || key });
  }
  return [...byMonth.values()].sort((a, b) =>
    String(a.month).localeCompare(String(b.month)),
  );
}
