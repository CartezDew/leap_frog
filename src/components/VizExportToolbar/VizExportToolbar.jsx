import { LuDownload } from 'react-icons/lu';

import './VizExportToolbar.css';

/** Compact export actions with explicit file-type labels. */
export function VizExportToolbar({ onXlsx, onPdf, className = '' }) {
  return (
    <div className={`viz-export-toolbar ${className}`.trim()} role="group" aria-label="Export">
      <button
        type="button"
        className="viz-export-toolbar__btn viz-export-toolbar__btn--sheet"
        onClick={onXlsx}
        title="Download as spreadsheet"
        aria-label="Download as spreadsheet"
      >
        <LuDownload size={14} aria-hidden="true" />
        <span>Excel</span>
      </button>
      <button
        type="button"
        className="viz-export-toolbar__btn viz-export-toolbar__btn--pdf"
        onClick={onPdf}
        title="Download as PDF"
        aria-label="Download as PDF document"
      >
        <LuDownload size={14} aria-hidden="true" />
        <span>PDF</span>
      </button>
    </div>
  );
}
