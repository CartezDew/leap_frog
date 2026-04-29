import { useState } from 'react';
import {
  LuFolderOpen,
  LuRefreshCcw,
  LuFileSpreadsheet,
  LuFileText,
  LuPlus,
  LuCheck,
} from 'react-icons/lu';

function isPdfName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

import { useData } from '../../context/DataContext.jsx';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatModified(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function UploadDataLibrary() {
  const {
    manifest,
    manifestLoading,
    refreshManifest,
    stageFromUploadData,
    staged,
    analyzeStatus,
    sourceFiles,
  } = useData();

  const [pendingName, setPendingName] = useState(null);
  const [error, setError] = useState(null);

  const busy = analyzeStatus === 'analyzing';
  const stagedNames = new Set(
    staged
      .filter((it) => it.source === 'upload_data')
      .map((it) => it.name),
  );
  const loadedNames = new Set(
    (sourceFiles || [])
      .filter((s) => s.source === 'upload_data')
      .map((s) => s.filename),
  );

  const handleAdd = async (entry) => {
    setError(null);
    setPendingName(entry.name);
    try {
      await stageFromUploadData(entry);
    } catch (err) {
      setError(err.message || 'Failed to stage file.');
    } finally {
      setPendingName(null);
    }
  };

  return (
    <section className="upload-library">
      <div className="upload-library__head">
        <div>
          <h2 className="section-header upload-library__title">
            <LuFolderOpen size={18} /> Files in <span className="text-mono">Upload DATA/</span>
          </h2>
          <p className="section-subhead">
            Drop GA4 <span className="text-mono">.xlsx</span> /{' '}
            <span className="text-mono">.xls</span> exports or Semrush{' '}
            <span className="text-mono">.pdf</span> reports into the project's{' '}
            <span className="text-mono">Upload DATA/</span> folder, then add as
            many as you'd like to the analysis batch below.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => refreshManifest()}
          disabled={manifestLoading}
        >
          <LuRefreshCcw size={14} />
          {manifestLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="upload-library__error">{error}</div>}

      {manifest.length === 0 ? (
        <div className="upload-library__empty">
          <LuFileSpreadsheet size={20} />
          <div>
            <strong>No files detected.</strong>
            <p>
              Place an <span className="text-mono">.xlsx</span> or{' '}
              <span className="text-mono">.xls</span> file in{' '}
              <span className="text-mono">Upload DATA/</span> and click{' '}
              <em>Refresh</em>.
            </p>
          </div>
        </div>
      ) : (
        <ul className="upload-library__list">
          {manifest.map((entry) => {
            const inBatch = stagedNames.has(entry.name);
            const inDataset = loadedNames.has(entry.name);
            const isPending = pendingName === entry.name;
            return (
              <li
                key={entry.name}
                className={`upload-library__item${
                  inDataset ? ' upload-library__item--active' : ''
                }`}
              >
                <div className="upload-library__meta">
                  <span className="upload-library__icon">
                    {isPdfName(entry.name) ? (
                      <LuFileText size={18} />
                    ) : (
                      <LuFileSpreadsheet size={18} />
                    )}
                  </span>
                  <div>
                    <p className="upload-library__name">{entry.name}</p>
                    <p className="upload-library__sub">
                      {formatBytes(entry.size)} · modified{' '}
                      {formatModified(entry.modified_iso)}
                    </p>
                  </div>
                </div>
                <div className="upload-library__actions">
                  {inDataset && <span className="pill pill--green">In dataset</span>}
                  {inBatch ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled
                    >
                      <LuCheck size={14} />
                      In batch
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => handleAdd(entry)}
                      disabled={busy || isPending}
                    >
                      <LuPlus size={14} />
                      {isPending ? 'Adding…' : 'Add to batch'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
