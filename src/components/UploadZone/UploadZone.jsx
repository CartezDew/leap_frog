import { useCallback, useRef, useState } from 'react';
import { LuCloudUpload, LuFileSpreadsheet, LuFileText } from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';

export function UploadZone() {
  const { stageFile, analyzeStatus } = useData();
  const inputRef = useRef(null);
  const [isDrag, setIsDrag] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [adding, setAdding] = useState(false);

  const handleFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;
      setLocalError(null);
      setAdding(true);
      try {
        for (const file of files) {
          try {
            await stageFile(file);
          } catch (err) {
            setLocalError(err.message || 'Failed to add file.');
          }
        }
      } finally {
        setAdding(false);
      }
    },
    [stageFile],
  );

  const onChange = (e) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDrag(false);
    const files = Array.from(e.dataTransfer.files || []);
    handleFiles(files);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDrag(true);
  };

  const onDragLeave = () => setIsDrag(false);

  const click = () => inputRef.current?.click();
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      click();
    }
  };

  const busy = adding || analyzeStatus === 'analyzing';
  const wrapperClass = [
    'upload-zone',
    isDrag ? 'is-drag' : '',
    localError ? 'is-error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={wrapperClass}
      role="button"
      tabIndex={0}
      onClick={click}
      onKeyDown={onKey}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      aria-busy={busy}
    >
      <div className="upload-zone__icon">
        {busy ? <span className="spinner" /> : <LuCloudUpload size={28} />}
      </div>
      <h2 className="upload-zone__title">
        {adding
          ? 'Adding to batch…'
          : analyzeStatus === 'analyzing'
            ? 'Analyzing batch…'
            : 'Drop GA4 Excel files & Semrush PDFs here'}
      </h2>
      <p className="upload-zone__sub">
        <LuFileSpreadsheet size={14} /> .xlsx / .xls — GA4 exports.&nbsp;
        <LuFileText size={14} /> .pdf — Semrush "Organic Performance" reports.
        Drop one or many; the analyzer runs once on the merged batch
        (50 MB combined max).
      </p>
      {!busy && (
        <button
          type="button"
          className="btn btn--primary"
          onClick={(e) => {
            e.stopPropagation();
            click();
          }}
        >
          Choose files
        </button>
      )}
      <p className="upload-zone__hint">
        Tip: the synthetic dataset in <span className="text-mono">/sample-data/</span> is
        a great smoke test.
      </p>

      {localError && <div className="upload-zone__error">{localError}</div>}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.pdf"
        className="upload-input"
        multiple
        onChange={onChange}
      />
    </div>
  );
}
