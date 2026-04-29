// One-off smoke test: parse the Semrush PDFs with the same parser the
// browser uses and print a summary. Helps debug "the analyze button does
// nothing" cases where the failure happens deep inside parsing or merging.
//
//   node scripts/smoke-pdf.mjs
//
// pdfjs-dist v5 needs DOMMatrix/Path2D shims to run under Node; we provide
// minimal no-op stubs so the text extractor still works.

import fs from 'node:fs';
import path from 'node:path';

// ---- Node shims so pdfjs-dist v5 boots without a DOM -----------------------
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

function parseShortDate(str) {
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year = 2000 + year;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

const RANKED_RX =
  /^\d+\.\s+(.+?)\s+(\d{1,3})(?:\s+\S+)+?\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;
const UNRANKED_RX =
  /^\d+\.\s+(.+?)\s+-\s+(n\/a|\d+(?:\.\d+)?)\s+(n\/a|\d+)$/i;

function num(token) {
  if (token == null) return null;
  const s = String(token).trim().toLowerCase();
  if (s === 'n/a' || s === '-' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanText(str) {
  // eslint-disable-next-line no-control-regex
  return String(str || '').replace(/[\u0000-\u001f\u007f-\u009f\ufeff]/g, ' ').replace(/[\u00a0\u202f\u2007]/g, ' ');
}

async function extractLines(buffer) {
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, disableWorker: true })
    .promise;
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

function parsePeriod(lines) {
  let startDate = null;
  let generatedOn = null;
  for (const line of lines) {
    if (!startDate) {
      const m = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})[^\d]+(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (m) {
        startDate = parseShortDate(m[1]);
      }
    }
    if (!generatedOn) {
      const g = line.match(/Generated on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
      if (g) {
        const d = new Date(`${g[1]} UTC`);
        if (!Number.isNaN(d.getTime())) generatedOn = d.toISOString().slice(0, 10);
      }
    }
    if (startDate && generatedOn) break;
  }
  if (!startDate) return { monthKey: null, monthLabel: null, generatedOn };
  const y = startDate.getUTCFullYear();
  const m = startDate.getUTCMonth();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    monthKey: `${y}-${String(m + 1).padStart(2, '0')}`,
    monthLabel: `${monthNames[m]} ${y}`,
    generatedOn,
  };
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
    filename,
    local,
    national,
  };
}

const dir = path.resolve('src/Excel');
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
console.log(`Found ${files.length} PDF(s) in ${dir}`);

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  process.stdout.write(`\n--- ${f} ---\n`);
  try {
    const lines = await extractLines(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const snap = buildSnapshot(lines, f);
    console.log(`  month=${snap.month} (${snap.label}) generated_on=${snap.generated_on}`);
    console.log(`  local=${snap.local.length} national=${snap.national.length}`);
    if (snap.local[0]) console.log('  local[0]:', snap.local[0]);
    if (snap.national[0]) console.log('  national[0]:', snap.national[0]);
    if (!snap.month) {
      console.log('  ⚠️  No month detected. ALL lines containing "/":');
      lines.forEach((l, i) => {
        if (/\d\/\d/.test(l)) {
          const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/;
          const m = l.match(re);
          console.log(`     [${i}] match=${!!m} | ${JSON.stringify(l)}`);
        }
      });
    }
  } catch (err) {
    console.error('  ❌', err.message);
    console.error(err.stack);
  }
}
