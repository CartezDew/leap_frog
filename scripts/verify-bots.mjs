// Run the analyzer against the just-seeded synthetic workbook and print the
// confirmed-bot cities and sources so we can confirm Russia, Venezuela and
// the three injected sources land in the right buckets.
//
//   node scripts/verify-bots.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseWorkbookBuffer } from '../src/lib/parser.js';
import { runAllAnalysis } from '../src/lib/analyzer.js';

const file = path.resolve('sample-data/synthetic_ga4.xlsx');
const buf = await readFile(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const { parsed, analysisSheets, rawTotals } = parseWorkbookBuffer(ab, 'synthetic.xlsx');
const analyzed = runAllAnalysis(parsed, { rawTotals, analysisSheets });

const bots = analyzed.bots || {};
const summary = bots.summary || {};

console.log('\n=== Bot summary ===');
console.log(JSON.stringify(summary, null, 2));

const confirmedCities = (bots.cities || []).filter(
  (c) => c.bot_classification === 'confirmed_bot',
);
const confirmedSources = (bots.sources || []).filter(
  (s) => s.bot_classification === 'confirmed_bot',
);

console.log(`\n=== Confirmed bot CITIES (${confirmedCities.length}) ===`);
for (const c of confirmedCities) {
  console.log(`  ${c.city.padEnd(20)}  sessions=${c.sessions}  bounce=${(c.bounce_rate ?? 0).toFixed(2)}  avgEng=${(c.avg_engagement_time ?? 0).toFixed(1)}s  score=${c.bot_score}`);
}

console.log(`\n=== Confirmed bot SOURCES (${confirmedSources.length}) ===`);
for (const s of confirmedSources) {
  console.log(`  ${s.source.padEnd(28)}  sessions=${s.sessions}  bounce=${(s.bounce_rate ?? 0).toFixed(2)}  avgEng=${(s.avg_engagement_time ?? 0).toFixed(1)}s  score=${s.bot_score}`);
}
