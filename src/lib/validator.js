// Validation report generation (SKILL.md 12.7).
// Translates parser metadata + warnings into a structured report ready
// for the Upload page's ValidationReport component to render.
//
// Also accepts the analyzer's verification result so the user can see, on
// the Upload page, every "calculation cross-check" the dashboard ran on
// their numbers (sessions sum two ways, engaged ≤ sessions, monthly = annual,
// medium vs source consistency, etc.).

import { EXPECTED_SHEETS } from './skillConfig.js';

export function generateValidationReport(metadata, verification = null, accuracy = null) {
  const warnings = Array.isArray(metadata?.warnings) ? [...metadata.warnings] : [];
  const sheetsFound = Array.isArray(metadata?.sheets_found) ? [...metadata.sheets_found] : [];
  const classifications = metadata?.classifications || {};
  const analysisSheets = Array.isArray(metadata?.analysis_sheets_present)
    ? [...metadata.analysis_sheets_present]
    : [];
  const sheetsMissing = EXPECTED_SHEETS.filter((s) => !sheetsFound.includes(s));

  const criticalErrors = warnings.filter((w) => w.includes('REQUIRED'));
  const dataGaps = warnings.filter(
    (w) =>
      w.includes('Optional') ||
      w.includes('Unrecognized') ||
      w.includes('could not be classified'),
  );
  const otherWarnings = warnings.filter(
    (w) => !criticalErrors.includes(w) && !dataGaps.includes(w),
  );

  let status;
  let message;
  if (criticalErrors.length) {
    status = 'error';
    message = `Upload processed with ${criticalErrors.length} critical issue(s). Some dashboard sections may not display correctly.`;
  } else if (dataGaps.length) {
    status = 'partial';
    message = `Upload processed successfully. ${dataGaps.length} optional field(s) were not found and will show as N/A in the dashboard.`;
  } else {
    status = 'success';
    message =
      'All sheets and columns detected successfully. Dashboard is fully populated.';
  }

  // Surface verification findings into the report. Errors override status,
  // warnings demote a "success" to "partial" but never overwrite a real error.
  let verificationSummary = null;
  if (verification && Array.isArray(verification.checks)) {
    const checks = verification.checks;
    const errors = checks.filter((c) => c.status === 'error');
    const warns = checks.filter((c) => c.status === 'warn');
    const oks = checks.filter((c) => c.status === 'ok');
    const infos = checks.filter((c) => c.status === 'info');

    verificationSummary = {
      status: verification.status,
      total: checks.length,
      passed: oks.length,
      warnings: warns.length,
      errors: errors.length,
      info: infos.length,
      checks,
    };

    if (verification.status === 'error' && status !== 'error') {
      status = 'error';
      message = `Calculation cross-check failed (${errors.length} mismatch${
        errors.length === 1 ? '' : 'es'
      }). The dashboard may show drifted totals — see the cross-check details below.`;
    } else if (verification.status === 'warn' && status === 'success') {
      status = 'partial';
      message = `Upload processed. Calculation cross-check raised ${warns.length} warning${
        warns.length === 1 ? '' : 's'
      } you should review.`;
    }
  }

  // Roll up the accuracy matrix into a small summary the upload page can
  // surface alongside the validation report. Status escalates the same way
  // the verifier does.
  let accuracySummary = null;
  if (accuracy && Array.isArray(accuracy.rows)) {
    accuracySummary = {
      status: accuracy.status,
      counts: accuracy.counts,
      provenance: accuracy.provenance,
      available_sheets: accuracy.available_sheets,
      worst: accuracy.worst,
      user_typed_present: !!accuracy.user_typed,
    };
    if (accuracy.status === 'error' && status !== 'error') {
      status = 'error';
      message = `Accuracy check found ${accuracy.counts.error} KPI${
        accuracy.counts.error === 1 ? '' : 's'
      } that disagree across sheets. Review the matrix on the Executive Summary.`;
    } else if (accuracy.status === 'warn' && status === 'success') {
      status = 'partial';
      message = `Upload processed. Accuracy check raised ${accuracy.counts.warn} variance${
        accuracy.counts.warn === 1 ? '' : 's'
      } worth reviewing.`;
    }
  }

  return {
    status,
    message,
    filename: metadata?.filename || '',
    duplicate_files_removed: Array.isArray(metadata?.duplicate_files_removed)
      ? metadata.duplicate_files_removed
      : [],
    sheets_found: sheetsFound,
    sheets_missing: sheetsMissing,
    classifications: Object.entries(classifications).map(([sheet, category]) => ({
      sheet,
      category,
    })),
    analysis_sheets_present: analysisSheets,
    warnings: otherWarnings,
    critical_errors: criticalErrors,
    data_gaps: dataGaps,
    verification: verificationSummary,
    accuracy: accuracySummary,
  };
}
