// Quick inspector for the synthetic GA4 workbook.
// Lists every sheet, its first row of headers, and a couple of sample rows
// so we can see exactly which columns drive bot scoring.
//
//   node scripts/inspect-synthetic.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

const file = path.resolve('sample-data/synthetic_ga4.xlsx');
const buf = await readFile(file);
const wb = XLSX.read(buf, { type: 'buffer' });

function summarize(name) {
  const sheet = wb.Sheets[name];
  if (!sheet) {
    console.log(`(no sheet "${name}")`);
    return;
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log(`\n=== ${name} (${rows.length} rows) ===`);
  for (const row of rows) {
    const dim =
      row.City || row['Session source'] || row['Session medium'] || row['Page path and screen class'] || '(?)';
    if (dim === '(?)' || /city|source|medium|page/i.test(String(dim))) continue;
    const sess = (row['1'] || 0) + (row['2'] || 0) + (row['3'] || 0); // approx
    const bounce = row['1_5'];
    const eng = row['1_7'];
    console.log(`  ${dim} | sample sessions(jan-mar): ${sess} | jan bounce: ${bounce?.toFixed?.(2) ?? bounce} | jan avgEng: ${eng?.toFixed?.(1) ?? eng}`);
  }
}

console.log('Sheets:', wb.SheetNames.join(', '));
summarize('City');
summarize('Source');
summarize('Medium');
