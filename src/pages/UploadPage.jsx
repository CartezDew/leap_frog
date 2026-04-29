import { useNavigate } from 'react-router-dom';
import { LuTrash2, LuArrowRight } from 'react-icons/lu';

import { PageHeader } from '../components/PageHeader/PageHeader.jsx';
import { UploadDataLibrary } from '../components/UploadDataLibrary/UploadDataLibrary.jsx';
import { UploadStager } from '../components/UploadStager/UploadStager.jsx';
import { UploadZone } from '../components/UploadZone/UploadZone.jsx';
import { ValidationReport } from '../components/ValidationReport/ValidationReport.jsx';
import { useData } from '../context/DataContext.jsx';

export function UploadPage() {
  const navigate = useNavigate();
  const {
    hasData,
    report,
    clear,
    error,
    filenameLabel,
    sourceFiles,
    fileCount,
    uploadedAt,
    staged,
  } = useData();

  return (
    <>
      <PageHeader
        badge="Browser-side parsing"
        title="Upload Data"
        subtitle="Add as many GA4 exports as you'd like — drag-drop or pick from the Upload DATA/ folder — then run the analysis on the whole batch."
      />

      {error && <div className="error-banner">{error}</div>}

      <UploadStager />

      {staged.length === 0 && (
        <>
          <UploadZone />
          <h2 className="section-header upload-page__library-title">
            Files in <em>Upload DATA/</em>
          </h2>
          <UploadDataLibrary />
        </>
      )}

      {staged.length > 0 && (
        <>
          <h2 className="section-header upload-page__library-title">
            Add <em>more</em> from Upload DATA/
          </h2>
          <UploadDataLibrary />
          <h2 className="section-header">Or drop an <em>ad-hoc</em> file</h2>
          <UploadZone />
        </>
      )}

      {hasData && (
        <>
          <hr className="divider" />
          <div className="row-spread">
            <div>
              <h2 className="section-header">Current <em>dataset</em></h2>
              <p className="section-subhead">
                Loaded{' '}
                <strong>
                  {fileCount > 1
                    ? `${fileCount} workbooks`
                    : filenameLabel || 'workbook'}
                </strong>
                {uploadedAt
                  ? ` on ${new Date(uploadedAt).toLocaleString()}`
                  : ''}
                . Stored in browser localStorage so it survives a refresh.
              </p>
              {fileCount > 1 && Array.isArray(sourceFiles) && (
                <ul className="source-files">
                  {sourceFiles.map((f) => (
                    <li key={f.filename}>
                      <span className="text-mono">{f.filename}</span>
                      {f.source === 'upload_data' && (
                        <span className="pill pill--ghost">Upload DATA/</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="page-meta">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={clear}
              >
                <LuTrash2 size={14} /> Clear &amp; Re-upload
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate('/overview')}
              >
                Open Dashboard <LuArrowRight size={14} />
              </button>
            </div>
          </div>

          {report && <ValidationReport report={report} />}
        </>
      )}
    </>
  );
}
