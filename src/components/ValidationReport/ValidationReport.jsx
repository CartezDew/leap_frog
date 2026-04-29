import { useState } from 'react';
import {
  LuCircleCheck,
  LuTriangleAlert,
  LuOctagonAlert,
  LuInfo,
  LuChevronDown,
  LuChevronUp,
} from 'react-icons/lu';

const ICON_BY_STATUS = {
  success: LuCircleCheck,
  partial: LuTriangleAlert,
  error: LuOctagonAlert,
};

const TITLE_BY_STATUS = {
  success: 'Workbook validated',
  partial: 'Workbook loaded with notes',
  error: 'Workbook loaded with critical issues',
};

const CHECK_ICON = {
  ok: LuCircleCheck,
  warn: LuTriangleAlert,
  error: LuOctagonAlert,
  info: LuInfo,
};

function VerificationSection({ verification }) {
  const [expandPassed, setExpandPassed] = useState(false);
  if (!verification || !Array.isArray(verification.checks) || verification.checks.length === 0) {
    return null;
  }
  const errors = verification.checks.filter((c) => c.status === 'error');
  const warns = verification.checks.filter((c) => c.status === 'warn');
  const infos = verification.checks.filter((c) => c.status === 'info');
  const passed = verification.checks.filter((c) => c.status === 'ok');

  const sectionStatus =
    errors.length > 0 ? 'error' : warns.length > 0 ? 'warn' : 'ok';

  const renderRow = (c) => {
    const Icon = CHECK_ICON[c.status] || LuInfo;
    return (
      <li key={c.id} className={`verify__row verify__row--${c.status}`}>
        <span className="verify__row-icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <div className="verify__row-body">
          <p className="verify__row-label">{c.label}</p>
          <p className="verify__row-numbers">
            <span className="verify__num-label">expected</span>
            <span className="verify__num-value">{c.expected_label}</span>
            <span className="verify__num-sep">vs</span>
            <span className="verify__num-label">actual</span>
            <span className="verify__num-value">{c.actual_label}</span>
            {c.delta_pct > 0.001 && c.status !== 'ok' && c.status !== 'info' && (
              <span className="verify__num-delta">
                Δ {(c.delta_pct * 100).toFixed(2)}%
              </span>
            )}
          </p>
          {c.note && <p className="verify__row-note">{c.note}</p>}
        </div>
      </li>
    );
  };

  return (
    <div className={`verify verify--${sectionStatus}`}>
      <div className="verify__head">
        <h4 className="verify__title">
          <LuCircleCheck size={16} /> Calculation cross-checks
        </h4>
        <div className="verify__counts">
          <span className="verify__pill verify__pill--ok">
            {passed.length} passed
          </span>
          {warns.length > 0 && (
            <span className="verify__pill verify__pill--warn">
              {warns.length} warning{warns.length === 1 ? '' : 's'}
            </span>
          )}
          {errors.length > 0 && (
            <span className="verify__pill verify__pill--error">
              {errors.length} mismatch{errors.length === 1 ? '' : 'es'}
            </span>
          )}
          {infos.length > 0 && (
            <span className="verify__pill verify__pill--info">
              {infos.length} note{infos.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <p className="verify__intro">
        Every key total is computed two independent ways (column-walked raw cells
        vs aggregated long-format) and compared. This is the dashboard's
        check-and-balance — discrepancies here mean a calculation drifted.
      </p>

      {(errors.length > 0 || warns.length > 0) && (
        <ul className="verify__list">
          {errors.map(renderRow)}
          {warns.map(renderRow)}
        </ul>
      )}

      {infos.length > 0 && (
        <ul className="verify__list verify__list--quiet">
          {infos.map(renderRow)}
        </ul>
      )}

      {passed.length > 0 && (
        <details
          className="verify__passed"
          open={expandPassed}
          onToggle={(e) => setExpandPassed(e.currentTarget.open)}
        >
          <summary>
            {expandPassed ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
            Show all {passed.length} passing check{passed.length === 1 ? '' : 's'}
          </summary>
          <ul className="verify__list verify__list--quiet">
            {passed.map(renderRow)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ValidationReport({ report }) {
  if (!report) return null;
  const Icon = ICON_BY_STATUS[report.status] || LuCircleCheck;
  const dupRemoved = report.duplicate_files_removed || [];
  return (
    <div className={`validation validation--${report.status}`}>
      <h3 className="validation__title">
        <Icon size={18} /> {TITLE_BY_STATUS[report.status] || 'Workbook loaded'}
      </h3>
      <p className="validation__message">{report.message}</p>

      {dupRemoved.length > 0 && (
        <div className="validation__duplicate-callout" role="status">
          <strong>Duplicate files detected</strong>
          <p>
            {dupRemoved.length === 1
              ? 'One file in your batch was byte-identical to another and was excluded from calculations. Only the first copy was merged into the dataset.'
              : `${dupRemoved.length} files in your batch were byte-identical to an earlier file and were excluded from calculations. Only one copy of each unique file was merged.`}
          </p>
          <ul>
            {dupRemoved.map((d, i) => (
              <li key={i}>
                <span className="text-mono">{d.filename}</span>
                {' → matches '}
                <span className="text-mono">{d.duplicateOf}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <VerificationSection verification={report.verification} />

      <div className="validation__columns">
        <div>
          <p className="validation__col-title">Sheets detected</p>
          <ul className="validation__list">
            {(report.classifications || []).map(({ sheet, category }) => (
              <li key={sheet}>
                <span>{sheet}</span>
                <span className="muted">{category}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="validation__col-title">Coverage</p>
          <ul className="validation__list">
            <li>
              <span>Sheets found</span>
              <span>{(report.sheets_found || []).join(', ') || '—'}</span>
            </li>
            <li>
              <span>Missing optional</span>
              <span>{(report.sheets_missing || []).join(', ') || 'none'}</span>
            </li>
            <li>
              <span>Pre-built analysis sheets</span>
              <span>
                {(report.analysis_sheets_present || []).length
                  ? report.analysis_sheets_present.join(', ')
                  : 'none'}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {(report.critical_errors?.length || 0) > 0 && (
        <div className="validation__warnings">
          <strong>Critical issues</strong>
          <ul>
            {report.critical_errors.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {(report.warnings?.length || 0) > 0 && (
        <div className="validation__warnings">
          <strong>Other warnings</strong>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
