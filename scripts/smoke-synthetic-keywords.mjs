// End-to-end smoke test: parse the synthetic Semrush PDFs in
// `sample-data/`, feed them to the real keyword analyzer
// (`src/lib/keywordAnalyzer.js`), and print what the Keywords page would
// render. Run this after regenerating the PDFs to catch any regression in
// the parser ↔ analyzer contract.
//
//   node scripts/smoke-synthetic-keywords.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class DOMMatrixShim {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
  }
}
class Path2DShim {
  // eslint-disable-next-line class-methods-use-this
  addPath() {}
  // eslint-disable-next-line class-methods-use-this
  moveTo() {}
  // eslint-disable-next-line class-methods-use-this
  lineTo() {}
  // eslint-disable-next-line class-methods-use-this
  closePath() {}
}
globalThis.DOMMatrix = globalThis.DOMMatrix || DOMMatrixShim;
globalThis.Path2D = globalThis.Path2D || Path2DShim;
globalThis.ImageData =
  globalThis.ImageData ||
  class ImageData {
    constructor() {
      this.data = new Uint8ClampedArray();
    }
  };

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

// We mirror the parser inline (instead of importing
// `src/lib/semrushPdfParser.js`) because the browser version configures the
// pdfjs worker via a `?url` Vite import, which Node can't resolve. The
// parsing rules below are byte-for-byte identical to the browser code.

const RANKED_RX =
  /^\d+\.\s+(.+?)\s+(\d{1,3})(?:\s+\S+)+?\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;
const UNRANKED_RX =
  /^\d+\.\s+(.+?)\s+-\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function cleanText(str) {
  return String(str || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\ufeff]/g, ' ')
    .replace(/[\u00a0\u202f\u2007]/g, ' ');
}

async function extractLines(buffer) {
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, disableWorker: true }).promise;
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    const rows = new Map();
    for (const item of text.items) {
      if (!item || !item.str) continue;
      const trimmed = cleanText(item.str).trim();
      if (!trimmed) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ str: trimmed, x: item.transform[4] });
    }
    const sortedY = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const sorted = rows.get(y).sort((a, b) => a.x - b.x);
      const joined = sorted.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (joined) lines.push(joined);
    }
  }
  return lines;
}

function num(token) {
  if (token == null) return null;
  const s = String(token).trim().toLowerCase();
  if (s === 'n/a' || s === '-' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseRow(line) {
  if (!/^\d+\.\s/.test(line)) return null;
  let m = line.match(RANKED_RX);
  if (m) return { keyword: m[1].trim().toLowerCase(), position: num(m[2]), cpc: num(m[3]), volume: num(m[4]) };
  m = line.match(UNRANKED_RX);
  if (m) return { keyword: m[1].trim().toLowerCase(), position: null, cpc: num(m[2]), volume: num(m[3]) };
  return null;
}

function parseShortDate(str) {
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year = 2000 + year;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function parsePeriod(lines) {
  const TWO_DATES_RX = /(\d{1,2}\/\d{1,2}\/\d{2,4})[^\d]+(\d{1,2}\/\d{1,2}\/\d{2,4})/;
  for (const line of lines) {
    const m = line.match(TWO_DATES_RX);
    if (m) {
      const start = parseShortDate(m[1]);
      if (start) {
        const y = start.getUTCFullYear();
        const mo = start.getUTCMonth();
        return {
          monthKey: `${y}-${String(mo + 1).padStart(2, '0')}`,
          monthLabel: `${MONTH_NAMES[mo]} ${y}`,
        };
      }
    }
  }
  return { monthKey: null, monthLabel: null };
}

function buildSnapshot(lines, filename) {
  const period = parsePeriod(lines);
  const local = [];
  const national = [];
  let section = null;
  const seen = { local: new Set(), national: new Set() };
  for (const line of lines) {
    if (/^Local Rankings/i.test(line)) { section = 'local'; continue; }
    if (/^National Rankings/i.test(line)) { section = 'national'; continue; }
    if (!section) continue;
    const row = parseRow(line);
    if (!row) continue;
    if (seen[section].has(row.keyword)) continue;
    seen[section].add(row.keyword);
    (section === 'local' ? local : national).push(row);
  }
  return {
    month: period.monthKey,
    label: period.monthLabel,
    filename,
    local,
    national,
    source: 'semrush',
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLE_DIR = path.join(ROOT, 'sample-data');

const files = fs
  .readdirSync(SAMPLE_DIR)
  .filter((f) => /^synthetic-keywords-.*\.pdf$/i.test(f))
  .sort();

if (files.length === 0) {
  console.error('No synthetic-keywords-*.pdf files found. Run `node scripts/build-synthetic-semrush.mjs` first.');
  process.exit(1);
}

const snapshots = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(SAMPLE_DIR, f));
  const lines = await extractLines(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  snapshots.push(buildSnapshot(lines, f));
}

const sorted = snapshots.sort((a, b) => String(a.month).localeCompare(String(b.month)));

const { runKeywordAnalysis } = await import('../src/lib/keywordAnalyzer.js');
const result = runKeywordAnalysis({ semrush_keywords: sorted });

const summary = {
  empty: result.empty,
  domain: result.domain,
  source: result.source,
  monthly_count: result.monthly.length,
  trend_national: result.trend.national.map((m) => ({
    month: m.month,
    label: m.label,
    tracked: m.tracked,
    ranked: m.ranked,
    top10: m.top10,
    top3: m.top3,
    avg_position: m.avg_position?.toFixed(2),
    est_monthly_value: m.est_monthly_value,
  })),
  themes_national: result.themes.national.map((t) => ({
    label: t.label,
    keywords: t.keywords,
    avg_position: t.avg_position?.toFixed(1),
    est_value: t.est_value,
  })),
  intents: result.intents.map((i) => ({
    label: i.label,
    keywords: i.keywords,
    avg_position: i.avg_position?.toFixed(1),
    total_volume: i.total_volume,
  })),
  serp_mix: result.serp_mix,
  insights_counts: {
    movers: result.insights.movers.length,
    decliners: result.insights.decliners.length,
    fortress: result.insights.fortress.length,
    quick_wins: result.insights.quick_wins.length,
    value_drivers: result.insights.value_drivers.length,
  },
  top_movers: result.insights.movers.slice(0, 3).map((m) => ({
    keyword: m.keyword,
    mom_delta: m.mom_delta,
    latest: m.latest.position,
    prev: m.prev_position,
    theme: m.theme.label,
  })),
  top_decliners: result.insights.decliners.slice(0, 3).map((m) => ({
    keyword: m.keyword,
    mom_delta: m.mom_delta,
    latest: m.latest.position,
    prev: m.prev_position,
    theme: m.theme.label,
  })),
  fortress_sample: result.insights.fortress.slice(0, 5).map((m) => ({
    keyword: m.keyword,
    latest: m.latest.position,
    worst: m.worst_position,
  })),
  quick_wins_sample: result.insights.quick_wins.slice(0, 5).map((m) => ({
    keyword: m.keyword,
    latest: m.latest.position,
    volume: m.latest.volume,
    win_score: Math.round(m.win_score),
  })),
};

console.log(JSON.stringify(summary, null, 2));
