// Browser-side workbook reader.
//
// Two-phase ingest:
//   1. parseFile / parseFromUploadData – parse + validate one workbook,
//      no analysis yet. Cheap to keep in memory while staging more files.
//   2. analyzeBatch – merge any number of parsed workbooks, run the analyzer
//      once on the union, and produce the dashboard dataset.

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from './skillConfig.js';
import { parseWorkbookBuffer } from './parser.js';
import { runAllAnalysis } from './analyzer.js';
import { generateValidationReport } from './validator.js';
import { fetchUploadDataFile } from './uploadDataLibrary.js';
import {
  parseSemrushPdf,
  consolidateSnapshots,
} from './semrushPdfParser.js';

function fileExtension(file) {
  const parts = String(file?.name || '').split('.');
  return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
}

function isPdf(filename) {
  return fileExtension({ name: filename }) === '.pdf';
}

function readFileAsArrayBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    if (typeof onProgress === 'function') {
      reader.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };
    }
    reader.readAsArrayBuffer(file);
  });
}

function defer() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** SHA-256 of raw file bytes so two uploads with different names but identical
 *  content are detected. Falls back to a fast FNV-style fingerprint when
 *  `crypto.subtle` is unavailable (non-secure contexts). */
export async function hashFileBuffer(buffer) {
  if (!buffer || buffer.byteLength === 0) return 'empty';
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const view = new Uint8Array(buffer);
  let h = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(view.length / 50000));
  for (let i = 0; i < view.length; i += step) {
    h ^= view[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= view.length >>> 0;
  return `fnv1a-${h.toString(16)}`;
}

function dedupeStagedItemsByContentHash(items) {
  const firstNameByHash = new Map();
  const unique = [];
  const duplicates = [];
  for (const it of items) {
    const h = it.contentHash;
    const fname = it.filename || it.name || '';
    if (!h) {
      unique.push(it);
      continue;
    }
    if (firstNameByHash.has(h)) {
      duplicates.push({
        filename: fname,
        duplicateOf: firstNameByHash.get(h),
      });
      continue;
    }
    firstNameByHash.set(h, fname);
    unique.push(it);
  }
  return { unique, duplicates };
}

function checkExtension(filename) {
  const ext = fileExtension({ name: filename });
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported file type "${ext}". Use .xlsx, .xls, or .pdf (Semrush exports).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — parse a single workbook (no analysis)
// ---------------------------------------------------------------------------

export async function parseFile(file, onProgress) {
  if (!file) throw new Error('No file provided.');
  checkExtension(file.name);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Single file is larger than 50 MB.');
  }

  if (typeof onProgress === 'function') onProgress(0);
  const buffer = await readFileAsArrayBuffer(file, onProgress);
  await defer();
  const contentHash = await hashFileBuffer(buffer);

  if (isPdf(file.name)) {
    const snapshot = await parseSemrushPdf(buffer, file.name);
    if (typeof onProgress === 'function') onProgress(100);
    return {
      kind: 'semrush_pdf',
      semrushSnapshot: snapshot,
      metadata: {
        sheets_found: ['Semrush keyword PDF'],
        warnings: [],
      },
      filename: file.name,
      size: file.size,
      source: 'file',
      contentHash,
    };
  }

  const result = parseWorkbookBuffer(buffer, file.name);
  if (typeof onProgress === 'function') onProgress(100);

  return {
    kind: 'workbook',
    parsed: result.parsed,
    analysisSheets: result.analysisSheets,
    metadata: result.metadata,
    rawTotals: result.rawTotals || {},
    filename: file.name,
    size: file.size,
    source: 'file',
    contentHash,
  };
}

export async function parseFromUploadData(entry, onProgress) {
  if (!entry || !entry.url) throw new Error('No Upload DATA file selected.');
  checkExtension(entry.name);
  if (entry.size && entry.size > MAX_UPLOAD_BYTES) {
    throw new Error('Single file is larger than 50 MB.');
  }

  if (typeof onProgress === 'function') onProgress(0);
  const buffer = await fetchUploadDataFile(entry.url);
  await defer();
  const contentHash = await hashFileBuffer(buffer);

  if (isPdf(entry.name)) {
    const snapshot = await parseSemrushPdf(buffer, entry.name);
    if (typeof onProgress === 'function') onProgress(100);
    return {
      kind: 'semrush_pdf',
      semrushSnapshot: snapshot,
      metadata: {
        sheets_found: ['Semrush keyword PDF'],
        warnings: [],
      },
      filename: entry.name,
      size: entry.size || (buffer && buffer.byteLength) || 0,
      source: 'upload_data',
      sourceUrl: entry.url,
      contentHash,
    };
  }

  const result = parseWorkbookBuffer(buffer, entry.name);
  if (typeof onProgress === 'function') onProgress(100);

  return {
    kind: 'workbook',
    parsed: result.parsed,
    analysisSheets: result.analysisSheets,
    metadata: result.metadata,
    rawTotals: result.rawTotals || {},
    filename: entry.name,
    size: entry.size || (buffer && buffer.byteLength) || 0,
    source: 'upload_data',
    sourceUrl: entry.url,
    contentHash,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — merge parsed workbooks and run the analyzer
// ---------------------------------------------------------------------------

function mergeParsed(items) {
  const out = {};
  for (const item of items) {
    const parsed = item?.parsed;
    if (!parsed) continue;
    for (const [key, rows] of Object.entries(parsed)) {
      if (!Array.isArray(rows)) continue;
      out[key] = (out[key] || []).concat(rows);
    }
  }
  return out;
}

function mergeAnalysisSheets(items) {
  const out = {};
  for (const item of items) {
    const a = item?.analysisSheets;
    if (!a) continue;
    for (const [key, rows] of Object.entries(a)) {
      if (!Array.isArray(rows)) continue;
      out[key] = (out[key] || []).concat(rows);
    }
  }
  return out;
}

function mergeMetadata(items) {
  const sheetsFound = new Set();
  const classifications = {};
  const analysisSheetsPresent = new Set();
  const warnings = new Set();
  const filenames = [];

  for (const item of items) {
    const m = item?.metadata || {};
    const name = item?.filename || item?.name;
    if (name) filenames.push(name);
    if (Array.isArray(m.sheets_found)) {
      for (const s of m.sheets_found) sheetsFound.add(s);
    }
    if (m.classifications && typeof m.classifications === 'object') {
      for (const [k, v] of Object.entries(m.classifications)) {
        if (!(k in classifications)) classifications[k] = v;
      }
    }
    if (Array.isArray(m.analysis_sheets_present)) {
      for (const s of m.analysis_sheets_present) analysisSheetsPresent.add(s);
    }
    if (Array.isArray(m.warnings)) {
      for (const w of m.warnings) warnings.add(w);
    }
  }

  return {
    filename: filenames.length === 1 ? filenames[0] : filenames.join(', '),
    filenames,
    file_count: filenames.length,
    primary_filename: filenames[0] || '',
    sheets_found: Array.from(sheetsFound).sort(),
    classifications,
    analysis_sheets_present: Array.from(analysisSheetsPresent),
    warnings: Array.from(warnings),
  };
}

// Combine the column-walked raw totals from each parsed workbook so the
// verifier sees totals for the union, not just one file in the batch.
function mergeRawTotals(items) {
  const NUMERIC_KEYS = [
    'sessions',
    'engaged_sessions',
    'total_users',
    'new_users',
    'active_users',
    'event_count',
    'sum_bounce_weighted',
    'sum_engagement_seconds',
    'row_count',
    'skipped_total_rows',
    'skipped_total_columns',
    'rows_with_engaged_gt_sessions',
    'rows_with_new_gt_total_users',
  ];
  const out = {};
  for (const item of items) {
    const r = item?.rawTotals;
    if (!r) continue;
    for (const [cat, totals] of Object.entries(r)) {
      if (!totals) continue;
      const acc =
        out[cat] ||
        (out[cat] = {
          sheet_names: [],
          rows_used: [],
          rows_skipped: [],
          rejected_column_headers: [],
        });
      for (const k of NUMERIC_KEYS) {
        acc[k] = (acc[k] || 0) + Number(totals[k] || 0);
      }
      if (totals.months_detected != null) {
        acc.months_detected = Math.max(
          acc.months_detected || 0,
          Number(totals.months_detected) || 0,
        );
      }
      if (totals.metrics_per_month != null) {
        acc.metrics_per_month = Math.max(
          acc.metrics_per_month || 0,
          Number(totals.metrics_per_month) || 0,
        );
      }
      if (totals.sheet_name) acc.sheet_names.push(totals.sheet_name);
      // Preserve provenance arrays so the accuracy panel can show the user
      // which rows were summed and which were skipped.
      if (Array.isArray(totals.rows_used)) {
        acc.rows_used.push(...totals.rows_used);
      }
      if (Array.isArray(totals.rows_skipped)) {
        acc.rows_skipped.push(...totals.rows_skipped);
      }
      if (Array.isArray(totals.rejected_column_headers)) {
        acc.rejected_column_headers.push(...totals.rejected_column_headers);
      }
    }
  }
  // Pick a single representative sheet_name for the merged record so the UI
  // has a stable label even when multiple workbooks are batched.
  for (const acc of Object.values(out)) {
    if (acc.sheet_names && acc.sheet_names.length > 0) {
      acc.sheet_name = acc.sheet_names[0];
    }
  }
  return out;
}

export function analyzeBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No files staged for analysis.');
  }
  const ready = items.filter(
    (it) =>
      it &&
      it.status !== 'duplicate' &&
      it.status !== 'error' &&
      it.status !== 'parsing' &&
      (!it.status || it.status === 'ready'),
  );
  if (ready.length === 0) throw new Error('No parsed files to analyze.');

  // Split workbook (.xlsx/.xls) inputs from Semrush PDF inputs. PDFs feed a
  // separate keyword pipeline and don't contribute to the GA4 analyzer.
  const workbookItems = ready.filter((it) => it.kind !== 'semrush_pdf');
  const pdfItems = ready.filter((it) => it.kind === 'semrush_pdf');

  const wbDedupe = dedupeStagedItemsByContentHash(workbookItems);
  const pdfDedupe = dedupeStagedItemsByContentHash(pdfItems);
  const workbookItemsUnique = wbDedupe.unique;
  const pdfItemsUnique = pdfDedupe.unique;
  const duplicateRollup = [...wbDedupe.duplicates, ...pdfDedupe.duplicates];

  const parsed = mergeParsed(workbookItemsUnique);
  const analysisSheets = mergeAnalysisSheets(workbookItemsUnique);
  const analyzedInputs = [...workbookItemsUnique, ...pdfItemsUnique];
  const metadata = mergeMetadata(analyzedInputs);
  const rawTotals = mergeRawTotals(workbookItemsUnique);
  metadata.raw_totals = rawTotals;

  if (duplicateRollup.length > 0) {
    metadata.duplicate_files_removed = duplicateRollup;
  }

  // Run GA4 analysis if we have workbook data; otherwise produce a minimal
  // payload so PDF-only uploads still yield a usable Keywords page.
  let analyzed;
  if (workbookItemsUnique.length > 0) {
    analyzed = runAllAnalysis(parsed, { rawTotals, analysisSheets });
  } else {
    analyzed = {
      summary: { report_period: '', total_sessions: 0 },
      monthly: [],
      sources: [],
      pages: { top_pages: [], all_pages_count: 0, contact_monthly: [] },
      bots: { summary: {}, cities: [], sources: [] },
      insights: [],
      unique: {},
    };
  }

  // Bolt the consolidated Semrush snapshots onto the analyzed payload so
  // the Keywords page can read them via the same `analyzed` object every
  // other page consumes.
  if (pdfItemsUnique.length > 0) {
    analyzed.semrush_keywords = consolidateSnapshots(
      pdfItemsUnique.map((it) => it.semrushSnapshot),
    );
  } else {
    analyzed.semrush_keywords = [];
  }

  const report = generateValidationReport(
    metadata,
    analyzed.verification,
    analyzed.accuracy,
  );

  const summary = analyzedInputs.map((item) => ({
    filename: item.filename || item.name || '',
    size: item.size,
    source: item.source,
    sourceUrl: item.sourceUrl || null,
    kind: item.kind || 'workbook',
    contentHash: item.contentHash || null,
  }));

  const filenameLabel =
    summary.length === 1
      ? summary[0].filename
      : `${summary.length} files (${summary
          .map((s) => s.filename)
          .join(', ')})`;

  // Roll up which kinds of reports made it into this batch so the UI can
  // gate sidebar items / pages without re-inspecting `sourceFiles`.
  const kinds = {
    workbook_count: workbookItemsUnique.length,
    semrush_pdf_count: pdfItemsUnique.length,
    has_ga4: workbookItemsUnique.length > 0,
    has_semrush: pdfItemsUnique.length > 0,
  };

  return {
    parsed,
    analysisSheets,
    analyzed,
    metadata,
    report,
    uploadedAt: new Date().toISOString(),
    filename: summary[0]?.filename || '',
    filenameLabel,
    sourceFiles: summary,
    fileCount: summary.length,
    kinds,
  };
}
