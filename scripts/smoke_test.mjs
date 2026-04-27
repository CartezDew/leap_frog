// Sanity-check the browser parser + analyzer by running them in Node
// against sample-data/synthetic_ga4.xlsx. This script is dev-only.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseWorkbookBuffer } from '../src/lib/parser.js';
import { runAllAnalysis } from '../src/lib/analyzer.js';
import { generateValidationReport } from '../src/lib/validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePath = path.resolve(__dirname, '../sample-data/synthetic_ga4.xlsx');

const buf = await readFile(samplePath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const { parsed, analysisSheets, metadata, rawTotals } = parseWorkbookBuffer(
  ab,
  'synthetic_ga4.xlsx',
);
const analyzed = runAllAnalysis(parsed, { rawTotals, analysisSheets });
const report = generateValidationReport(metadata, analyzed.verification);

const summary = {
  filename: metadata.filename,
  sheets_found: metadata.sheets_found,
  classifications: metadata.classifications,
  warnings_count: metadata.warnings.length,
  warnings_sample: metadata.warnings.slice(0, 5),
  analysis_sheets_present: metadata.analysis_sheets_present,
  parsed_counts: Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v.length : null]),
  ),
  totals: analyzed.summary,
  monthly_count: analyzed.monthly.length,
  insights_count: analyzed.insights.length,
  bots_summary: analyzed.bots.summary,
  unicorns_count: analyzed.unicorns.length,
  opportunities_count: analyzed.opportunities.length,
  validation_status: report.status,
  validation_message: report.message,
  raw_totals_summary: Object.fromEntries(
    Object.entries(rawTotals).map(([k, v]) => [
      k,
      {
        sessions: v.sessions,
        engaged: v.engaged_sessions,
        rows: v.row_count,
        skipped_total_rows: v.skipped_total_rows,
        months: v.months_detected,
      },
    ]),
  ),
  verification: {
    status: analyzed.verification.status,
    counts: {
      total: analyzed.verification.checks.length,
      ok: analyzed.verification.checks.filter((c) => c.status === 'ok').length,
      warn: analyzed.verification.checks.filter((c) => c.status === 'warn').length,
      error: analyzed.verification.checks.filter((c) => c.status === 'error').length,
      info: analyzed.verification.checks.filter((c) => c.status === 'info').length,
    },
    failures: analyzed.verification.checks
      .filter((c) => c.status === 'warn' || c.status === 'error')
      .map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        expected: c.expected_label,
        actual: c.actual_label,
        delta_pct: c.delta_pct,
      })),
  },
  accuracy: {
    status: analyzed.accuracy?.status,
    counts: analyzed.accuracy?.counts,
    provenance: analyzed.accuracy?.provenance,
    available_sheets: analyzed.accuracy?.available_sheets,
    user_typed_present: !!analyzed.accuracy?.user_typed,
    grand_total_defenses: analyzed.accuracy?.grand_total_defenses,
    provenance_per_sheet: Object.fromEntries(
      Object.entries(analyzed.accuracy?.provenance_per_sheet || {}).map(
        ([k, v]) => [
          k,
          {
            sheet_name: v.sheet_name,
            rows_used: v.rows_used,
            rows_skipped: v.rows_skipped,
            skipped_total_rows: v.skipped_total_rows,
            skipped_total_columns: v.skipped_total_columns,
            rejected_column_headers: v.rejected_column_headers,
            months_detected: v.months_detected,
            sessions: v.sessions,
          },
        ],
      ),
    ),
    rows: analyzed.accuracy?.rows?.map((r) => ({
      kpi: r.kpi,
      label: r.label,
      status: r.status,
      cells: r.cells.map((c) => ({
        label: c.label,
        value: c.label_value,
        status: c.status,
        delta_pct: c.delta_pct,
      })),
    })),
    worst: analyzed.accuracy?.worst,
  },
  benchmark_sample: {
    site: analyzed.bounce?.benchmark?.site,
    industry_median: analyzed.bounce?.benchmark?.industry_median,
    distribution: analyzed.bounce?.benchmark?.distribution?.map((d) => ({
      label: d.label,
      share: d.share,
      sessions: d.sessions,
      channel_count: d.channel_count,
    })),
    recommendations: analyzed.bounce?.benchmark?.recommendations?.map((r) => ({
      id: r.id,
      severity: r.severity,
      title: r.title,
    })),
  },
  unique_sample: {
    trust: analyzed.unique?.trust,
    source_quadrant_counts: analyzed.unique?.source_quadrant?.counts,
    source_quadrant_cutoffs: analyzed.unique?.source_quadrant?.cutoffs,
    concentration_pages: analyzed.unique?.concentration?.pages,
    concentration_sources: analyzed.unique?.concentration?.sources,
    content_mix: analyzed.unique?.content_mix,
    anomalies_count: analyzed.unique?.anomalies?.anomalies?.length,
    anomalies_top3: analyzed.unique?.anomalies?.anomalies?.slice(0, 3),
    researcher_lead_bridge: analyzed.unique?.researcher_lead_bridge,
    persona_distribution: analyzed.unique?.persona_distribution,
  },
};

console.log(JSON.stringify(summary, null, 2));
