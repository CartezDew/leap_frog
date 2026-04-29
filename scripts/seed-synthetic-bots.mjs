// Inject bot signals into sample-data/synthetic_ga4.xlsx so the dashboard
// renders a believable "Confirmed Bots" alert.
//
//   - Cities: append Russia + Venezuela with very-low engagement, ~100%
//     bounce, and high session counts so cityBotScore() crosses the
//     "Confirmed Bot" threshold (≥ 7).
//   - Sources: append search.webnavigator.com, moodle.emica.ca, and
//     promo-redirect.xyz so sourceBotScore() classifies them as confirmed
//     bots — bringing the synthetic data to 4 confirmed bot sources total
//     (the original JBCF Zfzcfefuvc row stays).
//
// The City and Source pivot sheets share this layout:
//
//   col 0:   dimension name (City / Session source)
//   cols 1..96: 12 month-blocks of 8 metrics each, in this order:
//              Sessions, Engaged sessions, Total users, New users,
//              Active users, Bounce rate, Event count, Avg engagement time
//
// Writes the result back to sample-data/synthetic_ga4.xlsx and also to
// Upload DATA/leapfrog-2025-synthetic.xlsx so both copies stay in sync.
//
//   node scripts/seed-synthetic-bots.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

const SOURCE_FILE = path.resolve('sample-data/synthetic_ga4.xlsx');
const TARGETS = [
  SOURCE_FILE,
  path.resolve('Upload DATA/leapfrog-2025-synthetic.xlsx'),
];

const buf = await readFile(SOURCE_FILE);
const wb = XLSX.read(buf, { type: 'buffer' });

const COL_COUNT = 1 + 12 * 8; // 97

// Build a single pivot row matching the layout described in the file
// header. `monthly` is an object whose values are 12-element arrays.
function buildRow({ dim, sessions, engaged, totalUsers, newUsers, activeUsers, bounce, events, avgEng }) {
  const row = new Array(COL_COUNT).fill(null);
  row[0] = dim;
  for (let m = 0; m < 12; m += 1) {
    const base = 1 + m * 8;
    row[base + 0] = sessions[m];
    row[base + 1] = engaged[m];
    row[base + 2] = totalUsers[m];
    row[base + 3] = newUsers[m];
    row[base + 4] = activeUsers[m];
    row[base + 5] = bounce[m];
    row[base + 6] = events[m];
    row[base + 7] = avgEng[m];
  }
  return row;
}

const flat = (value) => new Array(12).fill(value);

// ---- New City rows ---------------------------------------------------------
//
// cityBotScore breakdown for these rows (no datacenter-list match needed):
//   +4  avgEng < 1.0  AND sessions > 50
//   +4  bounce >= 0.9
//   +2  eventsPer < 1.0  AND sessions > 20
//   = 10 ⇒ Confirmed Bot

const cityRows = [
  buildRow({
    dim: 'Russia',
    sessions: flat(240),
    engaged: flat(4),
    totalUsers: flat(228),
    newUsers: flat(220),
    activeUsers: flat(228),
    bounce: flat(0.98),
    events: flat(96), // events/session = 0.4
    avgEng: flat(0.6),
  }),
  buildRow({
    dim: 'Venezuela',
    sessions: flat(180),
    engaged: flat(2),
    totalUsers: flat(172),
    newUsers: flat(168),
    activeUsers: flat(172),
    bounce: flat(0.99),
    events: flat(86),
    avgEng: flat(0.4),
  }),
];

// ---- New Source rows -------------------------------------------------------
//
// sourceBotScore breakdown:
//   +3  avgEng < 2.0  AND sessions > 20
//   +4  bounce >= 0.9 AND sessions > 10
//   +5  source matches KNOWN_SPAM_SOURCES (true for the first two)
//   = 7..12 ⇒ Confirmed Bot

const sourceRows = [
  buildRow({
    dim: 'search.webnavigator.com',
    sessions: flat(45),
    engaged: flat(1),
    totalUsers: flat(43),
    newUsers: flat(43),
    activeUsers: flat(43),
    bounce: flat(0.97),
    events: flat(45),
    avgEng: flat(0.5),
  }),
  buildRow({
    dim: 'moodle.emica.ca',
    sessions: flat(38),
    engaged: flat(0),
    totalUsers: flat(37),
    newUsers: flat(37),
    activeUsers: flat(37),
    bounce: flat(0.99),
    events: flat(38),
    avgEng: flat(0.3),
  }),
  buildRow({
    dim: 'promo-redirect.xyz',
    sessions: flat(52),
    engaged: flat(2),
    totalUsers: flat(50),
    newUsers: flat(50),
    activeUsers: flat(50),
    bounce: flat(0.96),
    events: flat(52),
    avgEng: flat(0.7),
  }),
];

function appendRows(sheetName, newRows) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

  // Read raw 2D array so the leading two header rows survive untouched.
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Re-running this script must be idempotent — drop any prior rows we
  // already injected (matched by the dimension name in column 0) before
  // appending the canonical versions.
  const dimsToReplace = new Set(newRows.map((r) => r[0]));
  const filtered = aoa.filter((row) => !dimsToReplace.has(row?.[0]));

  filtered.push(...newRows);
  const next = XLSX.utils.aoa_to_sheet(filtered);

  // Preserve column widths and any merge bands from the original.
  if (sheet['!merges']) next['!merges'] = sheet['!merges'];
  if (sheet['!cols']) next['!cols'] = sheet['!cols'];
  wb.Sheets[sheetName] = next;
}

appendRows('City', cityRows);
appendRows('Source', sourceRows);

const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
for (const dest of TARGETS) {
  await writeFile(dest, out);
  console.log(`✓ wrote ${dest}`);
}

console.log('\nNew City rows:');
for (const row of cityRows) {
  console.log(`  + ${row[0].padEnd(12)} sessions/mo=${row[1]}  bounce=${row[6]}  avgEng=${row[8]}s`);
}
console.log('New Source rows:');
for (const row of sourceRows) {
  console.log(`  + ${row[0].padEnd(28)} sessions/mo=${row[1]}  bounce=${row[6]}  avgEng=${row[8]}s`);
}
