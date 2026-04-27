// Calculation cross-check / "check & balance" layer.
//
// The user reported that totals from their manual Excel review didn't match
// the dashboard. Rather than trust a single calculation path, we now compute
// every key total TWO ways and compare:
//
//   Path A — column-walked raw totals (computed in parser.reshapeWideToLong
//            by summing every metric cell in the wide grid directly,
//            excluding any "Grand Total" row).
//   Path B — long-format aggregation (analyzer.aggregateWide → sum across
//            the resulting per-dimension rows).
//
// Path A and Path B are independent: a bug in the long-format reshape OR the
// aggregator can only ever lower one side, so any drift between them surfaces
// here as a warning. We also perform sanity checks the GA4 export should
// satisfy on its own (engaged ≤ sessions, monthly sum = annual sum, etc.).
//
// Returns:
//   { status: 'ok' | 'warn' | 'error',
//     checks: [{ id, label, severity, status, expected, actual,
//                expected_label, actual_label, delta, delta_pct, note }] }
//
// Every check is rendered to the user in ValidationReport so they can see
// exactly which calculations were verified.

const NUMERIC_TOL = 0.01;        // 1% drift allowed before flagging warn
const ABS_TOL_FOR_SMALL = 1.0;   // ignore drift smaller than 1 unit (rounding)

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a, b) {
  const d = num(b);
  return d === 0 ? 0 : num(a) / d;
}

function pctDelta(expected, actual) {
  const e = Math.abs(num(expected));
  const a = Math.abs(num(actual));
  if (e === 0 && a === 0) return 0;
  if (e === 0) return 1;
  return Math.abs(a - e) / e;
}

function fmtInt(v) {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : String(v);
}

function fmtPct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : String(v);
}

function makeCheck({
  id,
  label,
  expected,
  actual,
  format = 'int',
  severity = 'warn',
  tolerance = NUMERIC_TOL,
  absTolerance = ABS_TOL_FOR_SMALL,
  note,
}) {
  const exp = num(expected);
  const act = num(actual);
  const diff = act - exp;
  const delta = pctDelta(exp, act);
  const fmt = format === 'pct' ? fmtPct : fmtInt;

  let status = 'ok';
  if (Math.abs(diff) > absTolerance && delta > tolerance) {
    status = severity;
  }

  return {
    id,
    label,
    severity,
    status,
    expected: exp,
    actual: act,
    expected_label: fmt(exp),
    actual_label: fmt(act),
    delta: diff,
    delta_pct: delta,
    note: note || null,
  };
}

function aggregateSums(rows, keys) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    for (const k of keys) out[k] += num(r[k]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export function runVerifier({
  parsed,
  rawTotals,
  summary,
  monthly,
  mediumAgg,
  sourceAgg,
  deviceAgg,
  pageAgg,
}) {
  const checks = [];
  parsed = parsed || {};
  rawTotals = rawTotals || {};
  monthly = monthly || [];

  // -------------------------------------------------------------------------
  // 1. Reshape integrity per wide sheet:
  //    raw column-walked sum  ===  sum after long-format reshape
  // -------------------------------------------------------------------------
  const reshapeChecks = [
    { category: 'medium', label: 'Medium' },
    { category: 'source', label: 'Source' },
    { category: 'device', label: 'Device' },
    { category: 'city', label: 'City' },
    { category: 'page_path', label: 'Page Path' },
  ];

  for (const { category, label } of reshapeChecks) {
    const raw = rawTotals[category];
    const records = parsed[category];
    if (!raw || !Array.isArray(records) || records.length === 0) continue;
    const longSums = aggregateSums(records, [
      'sessions',
      'engaged_sessions',
      'total_users',
      'new_users',
      'event_count',
    ]);
    checks.push(
      makeCheck({
        id: `reshape.${category}.sessions`,
        label: `${label} sessions — raw cells vs long-format reshape`,
        expected: raw.sessions,
        actual: longSums.sessions,
        format: 'int',
        severity: 'error',
        note:
          'Sum of every Sessions cell in the original sheet should equal the sum of sessions across the parsed long-format rows. Any drift means the reshape lost or duplicated rows.',
      }),
    );
    checks.push(
      makeCheck({
        id: `reshape.${category}.engaged`,
        label: `${label} engaged sessions — raw cells vs long-format reshape`,
        expected: raw.engaged_sessions,
        actual: longSums.engaged_sessions,
        format: 'int',
        severity: 'error',
      }),
    );
    if (raw.skipped_total_rows > 0) {
      checks.push({
        id: `reshape.${category}.totals_skipped`,
        label: `${label} sheet — "Grand Total" rows excluded from totals`,
        severity: 'info',
        status: 'info',
        expected: raw.skipped_total_rows,
        actual: raw.skipped_total_rows,
        expected_label: `${raw.skipped_total_rows} row(s)`,
        actual_label: `${raw.skipped_total_rows} row(s)`,
        delta: 0,
        delta_pct: 0,
        note:
          'These roll-up rows in your Excel file were skipped. If your manual total is HIGHER than the dashboard you may have included them by mistake.',
      });
    }
    if (raw.rows_with_engaged_gt_sessions > 0) {
      checks.push({
        id: `sanity.${category}.engaged_gt_sessions`,
        label: `${label} — rows where engaged > sessions`,
        severity: 'warn',
        status: 'warn',
        expected: 0,
        actual: raw.rows_with_engaged_gt_sessions,
        expected_label: '0',
        actual_label: `${raw.rows_with_engaged_gt_sessions}`,
        delta: raw.rows_with_engaged_gt_sessions,
        delta_pct: 1,
        note: 'GA4 should never report more engaged sessions than total sessions. Check for header/column misalignment.',
      });
    }
    if (raw.rows_with_new_gt_total_users > 0) {
      checks.push({
        id: `sanity.${category}.new_gt_total`,
        label: `${label} — rows where new users > total users`,
        severity: 'warn',
        status: 'warn',
        expected: 0,
        actual: raw.rows_with_new_gt_total_users,
        expected_label: '0',
        actual_label: `${raw.rows_with_new_gt_total_users}`,
        delta: raw.rows_with_new_gt_total_users,
        delta_pct: 1,
        note: 'New users should never exceed total users in the same period.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Cross-sheet consistency. Sessions are not user-deduped, so the medium
  //    sheet, the source sheet, and the device sheet should all report the
  //    same total for the period.
  // -------------------------------------------------------------------------
  const mediumRaw = rawTotals.medium;
  const sourceRaw = rawTotals.source;
  const deviceRaw = rawTotals.device;

  const crossSheetMetrics = [
    { key: 'sessions', label: 'Sessions', format: 'int' },
    { key: 'engaged_sessions', label: 'Engaged sessions', format: 'int' },
    { key: 'total_users', label: 'Total users', format: 'int' },
    { key: 'new_users', label: 'New users', format: 'int' },
    { key: 'event_count', label: 'Event count', format: 'int' },
  ];
  const crossPairs = [
    { a: 'medium', b: 'source', aLabel: 'Medium sheet', bLabel: 'Source sheet' },
    { a: 'medium', b: 'device', aLabel: 'Medium sheet', bLabel: 'Device sheet' },
    { a: 'source', b: 'device', aLabel: 'Source sheet', bLabel: 'Device sheet' },
  ];
  const rawByCat = { medium: mediumRaw, source: sourceRaw, device: deviceRaw };

  for (const { a, b, aLabel, bLabel } of crossPairs) {
    const ra = rawByCat[a];
    const rb = rawByCat[b];
    if (!ra || !rb) continue;
    for (const { key, label, format } of crossSheetMetrics) {
      checks.push(
        makeCheck({
          id: `cross.${key}.${a}_vs_${b}`,
          label: `${label} — ${aLabel} vs ${bLabel}`,
          expected: ra[key],
          actual: rb[key],
          format,
          severity: 'warn',
          note:
            'Different breakdowns of the same period should report identical totals. Drift indicates a missing/extra row or a row labelled differently between sheets.',
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. Monthly trend should sum back to the annual total used on the cards.
  // -------------------------------------------------------------------------
  if (Array.isArray(monthly) && monthly.length > 0 && summary) {
    const monthlyMetrics = [
      { key: 'sessions', summaryKey: 'total_sessions', label: 'Sessions' },
      {
        key: 'engaged_sessions',
        summaryKey: 'engaged_sessions',
        label: 'Engaged sessions',
      },
      { key: 'total_users', summaryKey: 'total_users', label: 'Total users' },
      { key: 'new_users', summaryKey: 'new_users', label: 'New users' },
      { key: 'event_count', summaryKey: 'event_count', label: 'Event count' },
    ];
    for (const { key, summaryKey, label } of monthlyMetrics) {
      if (summary[summaryKey] === null || summary[summaryKey] === undefined) continue;
      const monthlySum = monthly.reduce((acc, m) => acc + num(m[key]), 0);
      // event_count isn't always carried into summary; skip if zero on both
      // sides to avoid noisy "0 vs 0" rows.
      if (monthlySum === 0 && num(summary[summaryKey]) === 0) continue;
      checks.push(
        makeCheck({
          id: `consistency.monthly_sum.${key}`,
          label: `Annual total = sum of monthly totals (${label})`,
          expected: summary[summaryKey],
          actual: monthlySum,
          format: 'int',
          severity: 'error',
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. Bounce rate computed two ways. These should be IDENTICAL.
  // -------------------------------------------------------------------------
  if (mediumRaw && mediumRaw.sessions > 0 && summary) {
    const overallBounce = 1 - safeDiv(mediumRaw.engaged_sessions, mediumRaw.sessions);
    checks.push(
      makeCheck({
        id: 'consistency.bounce_overall',
        label: 'Site bounce rate = 1 − engaged/sessions',
        expected: overallBounce,
        actual: summary.site_bounce_rate,
        format: 'pct',
        severity: 'error',
        absTolerance: 0.001,
      }),
    );

    // Weighted average of GA4's own raw "Bounce rate" column.
    if (mediumRaw.sessions > 0) {
      const weightedRaw = safeDiv(mediumRaw.sum_bounce_weighted, mediumRaw.sessions);
      checks.push(
        makeCheck({
          id: 'consistency.bounce_raw_weighted',
          label: 'Site bounce vs GA4 "Bounce rate" column (sessions-weighted)',
          expected: weightedRaw,
          actual: summary.site_bounce_rate,
          format: 'pct',
          severity: 'warn',
          tolerance: 0.02,
          absTolerance: 0.005,
          note:
            'GA4 sometimes reports a "Bounce rate" column directly. The session-weighted average of that column should match our 1 − engaged/sessions calculation.',
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. New / Total user caveats. We surface this even when nothing's wrong
  //    so the user understands why the dashboard "Total Users" can exceed
  //    GA4's annual unique count.
  // -------------------------------------------------------------------------
  if (mediumRaw) {
    checks.push({
      id: 'note.user_dedupe',
      label: 'Total Users = sum of monthly uniques',
      severity: 'info',
      status: 'info',
      expected: mediumRaw.total_users,
      actual: mediumRaw.total_users,
      expected_label: fmtInt(mediumRaw.total_users),
      actual_label: fmtInt(mediumRaw.total_users),
      delta: 0,
      delta_pct: 0,
      note:
        'GA4 deduplicates "Total Users" within a period. The dashboard sums monthly uniques, so a user active in Jan and Feb is counted twice. GA4\'s annual unique count will usually be SMALLER than this number. Compare like-for-like (monthly vs monthly).',
    });
  }

  // -------------------------------------------------------------------------
  // 6. Top-line status.
  // -------------------------------------------------------------------------
  let status = 'ok';
  for (const c of checks) {
    if (c.status === 'error') {
      status = 'error';
      break;
    }
    if (c.status === 'warn' && status !== 'error') status = 'warn';
  }

  return { status, checks };
}
