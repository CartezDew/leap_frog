// Make the bundled synthetic GA4 workbook unmistakably test data.
//
// The dashboard uses the Medium sheet for headline KPI totals and compares
// Medium, Source, and Device totals during verification, so this script updates
// all three with matching month totals.
//
//   node scripts/mark-synthetic-demo-data.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

const SOURCE_FILE = path.resolve('sample-data/synthetic_ga4.xlsx');
const TARGETS = [
  SOURCE_FILE,
  path.resolve('Upload DATA/leapfrog-2025-synthetic.xlsx'),
];

const DEMO_MONTHLY_TOTALS = [
  1111, 2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999, 10101, 11111, 12121,
];
const DEMO_MONTHLY_METRICS = DEMO_MONTHLY_TOTALS.map((sessions, idx) => {
  const engagement = 0.52 + (idx % 4) * 0.015;
  const totalUsers = Math.round(sessions * 0.8);
  return {
    sessions,
    engaged: Math.round(sessions * engagement),
    totalUsers,
    newUsers: Math.round(totalUsers * 0.56),
    events: Math.round(sessions * (3.35 + (idx % 3) * 0.12)),
  };
});

const SHEET_CONFIGS = {
  Medium: [
    { dim: 'organic', share: 0.39, engagement: 0.58, users: 0.78, newUsers: 0.52, events: 3.8, avgEng: 134 },
    { dim: '(none)', share: 0.28, engagement: 0.49, users: 0.82, newUsers: 0.57, events: 3.2, avgEng: 92 },
    { dim: 'referral', share: 0.16, engagement: 0.63, users: 0.74, newUsers: 0.44, events: 4.1, avgEng: 166 },
    { dim: 'cpc', share: 0.1, engagement: 0.43, users: 0.86, newUsers: 0.71, events: 2.7, avgEng: 62 },
    { dim: 'email', share: 0.07, engagement: 0.68, users: 0.69, newUsers: 0.29, events: 4.4, avgEng: 58 },
  ],
  Source: [
    { dim: 'google', share: 0.34, engagement: 0.63, users: 0.77, newUsers: 0.48, events: 4.2, avgEng: 190 },
    { dim: '(direct)', share: 0.25, engagement: 0.51, users: 0.82, newUsers: 0.58, events: 3.1, avgEng: 121 },
    { dim: 'linkedin', share: 0.12, engagement: 0.57, users: 0.76, newUsers: 0.5, events: 3.4, avgEng: 87 },
    { dim: 'bing', share: 0.08, engagement: 0.62, users: 0.79, newUsers: 0.55, events: 3.6, avgEng: 78 },
    { dim: 'TEST-traffic.example', share: 0.06, engagement: 0.35, users: 0.9, newUsers: 0.88, events: 1.8, avgEng: 22 },
    { dim: 'JBCF Zfzcfefuvc', share: 0.03, engagement: 0.02, users: 0.96, newUsers: 0.96, events: 0.8, avgEng: 0.5 },
    { dim: 'search.webnavigator.com', share: 0.04, engagement: 0.02, users: 0.95, newUsers: 0.95, events: 0.8, avgEng: 0.5 },
    { dim: 'moodle.emica.ca', share: 0.03, engagement: 0.01, users: 0.96, newUsers: 0.96, events: 0.7, avgEng: 0.3 },
    { dim: 'promo-redirect.xyz', share: 0.05, engagement: 0.04, users: 0.95, newUsers: 0.95, events: 0.9, avgEng: 0.7 },
  ],
  Device: [
    { dim: 'desktop', share: 0.54, engagement: 0.58, users: 0.77, newUsers: 0.49, events: 3.9, avgEng: 142 },
    { dim: 'mobile', share: 0.38, engagement: 0.49, users: 0.85, newUsers: 0.62, events: 3.0, avgEng: 81 },
    { dim: 'tablet', share: 0.08, engagement: 0.52, users: 0.8, newUsers: 0.51, events: 3.2, avgEng: 74 },
  ],
};

const buf = await readFile(SOURCE_FILE);
const wb = XLSX.read(buf, { type: 'buffer' });

function allocate(total, shares) {
  const raw = shares.map((share) => total * share);
  const floored = raw.map(Math.floor);
  let remainder = total - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, idx) => ({ idx, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i += 1) {
    floored[order[i % order.length].idx] += 1;
  }
  return floored;
}

function rebalanceIntegers(values, target, maxes = []) {
  const out = values.map((value) => Math.max(0, Math.round(value)));
  let diff = target - out.reduce((sum, value) => sum + value, 0);
  let guard = 0;

  while (diff !== 0 && guard < 10000) {
    guard += 1;
    let changed = false;
    for (let i = 0; i < out.length && diff !== 0; i += 1) {
      if (diff > 0) {
        const max = maxes[i] ?? Infinity;
        if (out[i] < max) {
          out[i] += 1;
          diff -= 1;
          changed = true;
        }
      } else if (out[i] > 0) {
        out[i] -= 1;
        diff += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return out;
}

function buildRow(config, metricsByMonth) {
  const row = new Array(1 + 12 * 8).fill(null);
  row[0] = config.dim;
  for (let month = 0; month < 12; month += 1) {
    const metrics = metricsByMonth[month];
    const sessions = metrics.sessions;
    const engaged = metrics.engaged;
    const totalUsers = metrics.totalUsers;
    const newUsers = metrics.newUsers;
    const base = 1 + month * 8;
    row[base + 0] = sessions;
    row[base + 1] = engaged;
    row[base + 2] = totalUsers;
    row[base + 3] = newUsers;
    row[base + 4] = totalUsers;
    row[base + 5] = Number((1 - engaged / Math.max(sessions, 1)).toFixed(4));
    row[base + 6] = metrics.events;
    row[base + 7] = config.avgEng;
  }
  return row;
}

function allocateSheetMonth(configs, target) {
  const shares = configs.map((config) => config.share);
  const sessions = allocate(target.sessions, shares);
  const engagedDesired = configs.map((config, idx) => sessions[idx] * config.engagement);
  const usersDesired = configs.map((config, idx) => sessions[idx] * config.users);
  const totalUsers = rebalanceIntegers(usersDesired, target.totalUsers, sessions);
  const newUsersDesired = configs.map((config, idx) => totalUsers[idx] * config.newUsers);
  const newUsers = rebalanceIntegers(newUsersDesired, target.newUsers, totalUsers);
  const eventsDesired = configs.map((config, idx) => sessions[idx] * config.events);

  return {
    sessions,
    engaged: rebalanceIntegers(engagedDesired, target.engaged, sessions),
    totalUsers,
    newUsers,
    events: rebalanceIntegers(eventsDesired, target.events),
  };
}

function rewriteSheet(sheetName, configs) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerRows = aoa.slice(0, 2);
  const monthlyAllocations = DEMO_MONTHLY_METRICS.map((target) =>
    allocateSheetMonth(configs, target),
  );
  const rows = configs.map((config, configIdx) =>
    buildRow(
      config,
      monthlyAllocations.map((month) => ({
        sessions: month.sessions[configIdx],
        engaged: month.engaged[configIdx],
        totalUsers: month.totalUsers[configIdx],
        newUsers: month.newUsers[configIdx],
        events: month.events[configIdx],
      })),
    ),
  );
  const next = XLSX.utils.aoa_to_sheet([...headerRows, ...rows]);

  if (sheet['!merges']) next['!merges'] = sheet['!merges'];
  if (sheet['!cols']) next['!cols'] = sheet['!cols'];
  wb.Sheets[sheetName] = next;
}

for (const [sheetName, configs] of Object.entries(SHEET_CONFIGS)) {
  rewriteSheet(sheetName, configs);
}

const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
for (const dest of TARGETS) {
  await writeFile(dest, out);
  console.log(`wrote ${dest}`);
}

const annualSessions = DEMO_MONTHLY_TOTALS.reduce((sum, value) => sum + value, 0);
console.log(`Synthetic monthly totals: ${DEMO_MONTHLY_TOTALS.join(', ')}`);
console.log(`Synthetic annual sessions: ${annualSessions.toLocaleString('en-US')}`);
