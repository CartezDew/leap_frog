// Generate synthetic Semrush "Organic Performance" PDFs that match the
// real exporter's text layout closely enough for the dashboard's
// in-browser PDF parser (`src/lib/semrushPdfParser.js`) to consume.
//
//   node scripts/build-synthetic-semrush.mjs
//
// Writes four monthly PDFs (Jan–Apr 2026) into both:
//   - sample-data/                            (committed reference samples)
//   - Upload DATA/                            (one-click test files)
//
// The generated keyword set is intentionally tuned to flex every part of
// the Keywords page:
//   - Brand fortress (always top-10) keywords
//   - Quick-win page-2 candidates
//   - Movers + decliners with believable month-over-month drift
//   - "New" keywords that appear partway through the window
//   - Always-unranked tracked keywords
//   - Local + National sections so the scope toggle has data
//   - Theme + intent diversity (vCISO, cybersecurity, managed IT, geo,
//     planning) so the heatmap, intent panel, and value drivers all
//     populate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MONTHS = [
  { key: '2026-01', label: 'Jan 2026', range: ['1/1/26', '1/31/26'], gen: 'February 4, 2026', dateLabel: '31 Jan' },
  { key: '2026-02', label: 'Feb 2026', range: ['2/1/26', '2/28/26'], gen: 'March 5, 2026', dateLabel: '28 Feb' },
  { key: '2026-03', label: 'Mar 2026', range: ['3/1/26', '3/31/26'], gen: 'April 4, 2026', dateLabel: '31 Mar' },
  { key: '2026-04', label: 'Apr 2026', range: ['4/1/26', '4/30/26'], gen: 'May 5, 2026', dateLabel: '30 Apr' },
];

// ---------------------------------------------------------------------------
// Synthetic dataset — every position drift, CPC, and volume is fabricated.
// Positions are arrays of length 4 (Jan, Feb, Mar, Apr). null = unranked.
// ---------------------------------------------------------------------------

const NATIONAL = [
  { kw: 'it services atlanta',                       positions: [4, 3, 2, 2],     cpc: 13.50, volume: 590 },
  { kw: 'managed it services atlanta',               positions: [8, 7, 6, 5],     cpc: 16.89, volume: 880 },
  { kw: 'cybersecurity services atlanta',            positions: [12, 11, 10, 9],  cpc: 18.20, volume: 290 },
  { kw: 'vciso services',                            positions: [15, 14, 13, 12], cpc: 22.00, volume: 720 },
  { kw: 'virtual ciso atlanta',                      positions: [18, 16, 14, 11], cpc: 24.50, volume: 320 },
  { kw: 'it services marietta',                      positions: [6, 5, 5, 4],     cpc: 9.68,  volume: 210 },
  { kw: 'managed it services marietta',              positions: [5, 4, 4, 3],     cpc: 14.20, volume: 170 },
  { kw: 'managed services marietta',                 positions: [6, 5, 4, 4],     cpc: 11.30, volume: 140 },
  { kw: 'it services norcross',                      positions: [4, 4, 3, 3],     cpc: 8.40,  volume: 90  },
  { kw: 'managed it services norcross',              positions: [9, 8, 8, 7],     cpc: 12.10, volume: 110 },
  { kw: 'managed it support',                        positions: [22, 20, 18, 17], cpc: 18.95, volume: 480 },
  { kw: 'managed it service provider atlanta',       positions: [9, 9, 8, 7],     cpc: 21.10, volume: 130 },
  { kw: 'cybersecurity atlanta',                     positions: [9, 8, 7, 6],     cpc: 19.40, volume: 720 },
  { kw: 'cybersecurity companies atlanta',           positions: [14, 13, 11, 9],  cpc: 22.30, volume: 320 },
  { kw: 'cyberrisk',                                 positions: [20, 18, 17, 16], cpc: 7.70,  volume: 880 },
  { kw: 'cyber risk assessment',                     positions: [25, 25, 24, 23], cpc: 14.40, volume: 590 },
  { kw: 'cyber risk consulting',                     positions: [33, 31, 28, 26], cpc: 18.20, volume: 210 },
  { kw: 'cyber risk management solution',            positions: [57, 53, 50, 47], cpc: 23.10, volume: 90  },
  { kw: 'outsourced it services',                    positions: [35, 33, 30, 28], cpc: 17.30, volume: 320 },
  { kw: 'outsourced it support',                     positions: [45, 42, 40, 38], cpc: 14.80, volume: 170 },
  { kw: 'outsource it services atlanta',             positions: [19, 18, 17, 15], cpc: 21.40, volume: 90  },
  { kw: 'it security companies',                     positions: [19, 21, 23, 25], cpc: 16.90, volume: 480 },
  { kw: 'it budgeting',                              positions: [30, 32, 35, 37], cpc: 11.10, volume: 90  },
  { kw: 'it strategy planning',                      positions: [42, 45, 48, 52], cpc: 13.20, volume: 70  },
  { kw: 'virtual chief security officer services',   positions: [null, 94, 76, 58], cpc: 28.40, volume: 50 },
  { kw: 'best managed it services atlanta',          positions: [null, null, 65, 52], cpc: 24.10, volume: 70 },
  { kw: 'top it providers atlanta',                  positions: [null, 80, 70, 62], cpc: 25.30, volume: 50 },
  { kw: 'governance risk and compliance atlanta',    positions: [null, null, null, null], cpc: null, volume: 30 },
];

const LOCAL = [
  { kw: 'it services atlanta',                positions: [1, 1, 1, 1],   cpc: 13.50, volume: 590  },
  { kw: 'managed it services atlanta',        positions: [3, 2, 2, 1],   cpc: 16.89, volume: 880  },
  { kw: 'cybersecurity atlanta',              positions: [4, 3, 2, 2],   cpc: 19.40, volume: 720  },
  { kw: 'it services marietta',               positions: [2, 2, 1, 1],   cpc: 9.68,  volume: 210  },
  { kw: 'managed services marietta',          positions: [3, 3, 2, 2],   cpc: 11.30, volume: 140  },
  { kw: 'virtual ciso atlanta',               positions: [8, 6, 5, 4],   cpc: 24.50, volume: 320  },
  { kw: 'cybersecurity services atlanta',     positions: [5, 4, 4, 3],   cpc: 18.20, volume: 290  },
  { kw: 'it support atlanta',                 positions: [7, 6, 5, 5],   cpc: 15.20, volume: 1300 },
  { kw: 'outsourced it services atlanta',     positions: [12, 10, 8, 7], cpc: 21.40, volume: 90   },
  { kw: 'it services norcross',               positions: [5, 4, 3, 3],   cpc: 8.40,  volume: 90   },
  { kw: 'managed it services norcross',       positions: [9, 8, 7, 6],   cpc: 12.10, volume: 110  },
  { kw: 'cybersecurity companies atlanta',    positions: [6, 5, 4, 3],   cpc: 22.30, volume: 320  },
  { kw: 'it strategy atlanta',                positions: [null, 25, 22, 18], cpc: 16.30, volume: 70 },
  { kw: 'cyber risk assessment atlanta',      positions: [null, null, 30, 25], cpc: 18.40, volume: 50 },
  { kw: 'it budgeting atlanta',               positions: [null, null, null, null], cpc: 11.10, volume: 30 },
];

// ---------------------------------------------------------------------------
// Row formatting
// ---------------------------------------------------------------------------

function formatCpc(cpc) {
  if (cpc == null) return 'n/a';
  return cpc.toFixed(2);
}

function formatVolume(vol) {
  if (vol == null) return 'n/a';
  return String(vol);
}

function diffToken(prev, curr) {
  // Diff column matches `(?:\s+\S+)+?` — one+ non-whitespace tokens. We
  // emit a single signed integer that mirrors how Semrush prints it after
  // the arrow glyph is stripped during text extraction.
  if (prev == null || curr == null) return '0';
  const delta = prev - curr; // positive = improved (smaller rank number)
  return String(delta);
}

function buildRow(rank, entry, monthIdx) {
  const pos = entry.positions[monthIdx];
  const prev = monthIdx > 0 ? entry.positions[monthIdx - 1] : null;
  const cpc = formatCpc(entry.cpc);
  const vol = formatVolume(entry.volume);

  if (pos == null) {
    // Unranked row format: `<rank>. <keyword> - <cpc> <vol>` (no diff column)
    return `${rank}. ${entry.kw} - ${cpc} ${vol}`;
  }
  const diff = diffToken(prev, pos);
  return `${rank}. ${entry.kw} ${pos} ${diff} ${cpc} ${vol}`;
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

const PAGE_OPTS = { size: 'LETTER', margin: 50 };
const ROW_X = 50;
const ROW_FONT_SIZE = 10;
const ROW_LINE_HEIGHT = 16;
const PAGE_BOTTOM = 740;

function renderSectionHeader(doc, y, label) {
  doc.fontSize(13).text(label, ROW_X, y, { lineBreak: false });
  return y + 22;
}

function renderColumnHeader(doc, y, dateLabel) {
  // Match the real Semrush PDFs' two-line column header:
  //   "Keyword CPC Volume" / "<date> Diff"
  doc.fontSize(9).text(`Keyword ${dateLabel} Diff CPC Volume`, ROW_X, y, {
    lineBreak: false,
  });
  return y + 16;
}

function renderRow(doc, y, text) {
  doc.fontSize(ROW_FONT_SIZE).text(text, ROW_X, y, { lineBreak: false });
  return y + ROW_LINE_HEIGHT;
}

function renderTable(doc, startY, dateLabel, sectionLabel, entries, monthIdx) {
  let y = startY;
  y = renderSectionHeader(doc, y, sectionLabel);
  y = renderColumnHeader(doc, y, dateLabel);

  entries.forEach((entry, idx) => {
    if (y + ROW_LINE_HEIGHT > PAGE_BOTTOM) {
      doc.addPage();
      // Repeat the column header on the new page so a human reading the
      // PDF still has context — does not affect parsing.
      y = renderColumnHeader(doc, 60, dateLabel);
    }
    y = renderRow(doc, y, buildRow(idx + 1, entry, monthIdx));
  });

  return y;
}

function renderHeader(doc, month) {
  doc.font('Helvetica-Bold').fontSize(18).text('Leapfrog Services', ROW_X, 50, {
    lineBreak: false,
  });
  doc.font('Helvetica').fontSize(14).text('Organic Performance', ROW_X, 78, {
    lineBreak: false,
  });
  doc.fontSize(11).text(`${month.range[0]} ${month.range[1]}`, ROW_X, 102, {
    lineBreak: false,
  });
  doc.fontSize(9).text('leapfrogservices.com', ROW_X, 120, {
    lineBreak: false,
  });
  // Synthetic-data banner so a human flipping through the PDF immediately
  // sees this isn't a real export. Doesn't trip any parser regex.
  doc
    .fontSize(9)
    .fillColor('#888')
    .text(
      'SYNTHETIC TEST DATA — generated by build-synthetic-semrush.mjs. Numbers are fabricated and safe to share publicly.',
      ROW_X,
      136,
      { lineBreak: false },
    )
    .fillColor('black');
  // Generated-on note — parser also reads this as a fallback for the
  // report period, so emitting it makes the snapshot self-describing.
  doc
    .fontSize(8)
    .fillColor('#666')
    .text(`Generated on ${month.gen}`, ROW_X, 156, { lineBreak: false })
    .fillColor('black');
  // Brand fingerprint — `parseSemrushPdf()` rejects PDFs that don't mention
  // "semrush" anywhere. Drop a small attribution line so the synthetic file
  // passes that check.
  doc
    .fontSize(7)
    .fillColor('#999')
    .text('Layout modeled after Semrush — Organic Performance export.', ROW_X, 170, {
      lineBreak: false,
    })
    .fillColor('black');
  return 200; // y to start the first table
}

function renderMonthPdf(month, monthIdx, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(PAGE_OPTS);
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    const startY = renderHeader(doc, month);
    let y = renderTable(doc, startY, month.dateLabel, 'Local Rankings', LOCAL, monthIdx);

    // Always start National on a new page so the parser sees the section
    // header at the top of a clean page (matches real Semrush layout).
    doc.addPage();
    renderTable(doc, 60, month.dateLabel, 'National Rankings', NATIONAL, monthIdx);

    doc.end();
    void y;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SAMPLE_DIR = path.join(ROOT, 'sample-data');
const UPLOAD_DIR = path.join(ROOT, 'Upload DATA');

if (!fs.existsSync(SAMPLE_DIR)) fs.mkdirSync(SAMPLE_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const written = [];
for (let i = 0; i < MONTHS.length; i += 1) {
  const month = MONTHS[i];
  // Filename mirrors the real Semrush export naming convention so the
  // parser's filename-based period fallback also resolves correctly.
  const [m1, d1, y1] = month.range[0].split('/');
  const [m2, d2, y2] = month.range[1].split('/');
  const filename = `synthetic-keywords-${m1}-${d1}-${y1}-${m2}-${d2}-${y2}.pdf`;

  const samplePath = path.join(SAMPLE_DIR, filename);
  await renderMonthPdf(month, i, samplePath);
  // Copy bytes into Upload DATA/ so the file shows up in the in-app
  // library picker without forcing a manual drag.
  const uploadPath = path.join(UPLOAD_DIR, filename);
  fs.copyFileSync(samplePath, uploadPath);

  written.push({ month: month.label, sample: samplePath, upload: uploadPath });
}

console.log('Wrote synthetic Semrush PDFs:');
for (const w of written) {
  console.log(`  - ${w.month}`);
  console.log(`      sample-data : ${path.relative(ROOT, w.sample)}`);
  console.log(`      Upload DATA : ${path.relative(ROOT, w.upload)}`);
}
