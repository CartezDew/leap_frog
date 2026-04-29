import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

const buf = await readFile(path.resolve('sample-data/synthetic_ga4.xlsx'));
const wb = XLSX.read(buf, { type: 'buffer' });

for (const name of ['City', 'Source']) {
  const sheet = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  console.log(`\n=== ${name} (${aoa.length} rows × ${aoa[0]?.length} cols) ===`);
  console.log(`!ref = ${sheet['!ref']}`);
  console.log(`!merges count = ${(sheet['!merges'] || []).length}`);
  for (let r = 0; r < Math.min(aoa.length, 6); r += 1) {
    console.log(`row[${r}] (len ${aoa[r].length}):`, aoa[r].slice(0, 16), '...');
  }
}
