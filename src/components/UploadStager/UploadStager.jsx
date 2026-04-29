import { useEffect, useRef, useState } from 'react';
import {
  LuPlus,
  LuFileSpreadsheet,
  LuFileText,
  LuX,
  LuPlay,
  LuPause,
  LuTriangleAlert,
  LuCircleCheck,
  LuCopy,
} from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';

const AUTORUN_SECONDS = 10;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StagedRow({ item, onRemove, busy }) {
  return (
    <li
      className={`stager__row stager__row--${item.status}`}
      aria-live="polite"
    >
      <span className="stager__row-icon">
        {item.status === 'error' ? (
          <LuTriangleAlert size={18} />
        ) : item.status === 'duplicate' ? (
          <LuCopy size={18} />
        ) : item.status === 'ready' ? (
          <LuCircleCheck size={18} />
        ) : item.kind === 'semrush_pdf' ? (
          <LuFileText size={18} />
        ) : (
          <LuFileSpreadsheet size={18} />
        )}
      </span>
      <div className="stager__row-meta">
        <p className="stager__row-name">{item.name}</p>
        <p className="stager__row-sub">
          {formatBytes(item.size)}
          {item.source === 'upload_data' && (
            <>
              {' '}
              · <span className="text-mono">Upload DATA/</span>
            </>
          )}
          {item.status === 'parsing' && <> · Parsing… {item.progress || 0}%</>}
          {item.status === 'ready' && <> · Ready</>}
          {item.status === 'duplicate' && (
            <>
              {' '}
              · <span className="stager__row-duplicate">Duplicate of “{item.duplicateOfName}” — excluded from analysis</span>
            </>
          )}
          {item.status === 'error' && (
            <span className="stager__row-error"> · {item.error}</span>
          )}
        </p>
        {item.status === 'parsing' && (
          <progress
            className="stager__row-progress"
            value={item.progress || 0}
            max={100}
          />
        )}
      </div>
      <button
        type="button"
        className="stager__row-remove"
        onClick={() => onRemove(item.id)}
        disabled={busy}
        aria-label={`Remove ${item.name}`}
        title="Remove from batch"
      >
        <LuX size={16} />
      </button>
    </li>
  );
}

function CountdownButton({ runId, secondsLeft, autoActive, onRun, onPause, busy, ready }) {
  return (
    <button
      type="button"
      className={`stager__run${autoActive ? ' stager__run--auto' : ''}${busy ? ' stager__run--busy' : ''}`}
      onClick={onRun}
      disabled={busy || !ready}
    >
      {/* `key` forces the fill element to remount when a new countdown starts,
          which restarts the CSS animation cleanly. */}
      <span key={runId} className="stager__run-fill" aria-hidden="true" />
      <span className="stager__run-content">
        <span className="stager__run-icon">
          <LuPlay size={16} />
        </span>
        <span className="stager__run-label">
          {busy
            ? 'Analyzing…'
            : autoActive
              ? `Run analysis · auto in ${secondsLeft}s`
              : 'Run analysis'}
        </span>
      </span>
      {autoActive && (
        <span
          className="stager__run-cancel"
          role="button"
          tabIndex={0}
          aria-label="Pause auto-run"
          title="Pause auto-run"
          onClick={(e) => {
            e.stopPropagation();
            onPause();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onPause();
            }
          }}
        >
          <LuPause size={14} />
        </span>
      )}
    </button>
  );
}

export function UploadStager() {
  const {
    staged,
    stagedTotalBytes,
    stagedReadyCount,
    stagedParsing,
    maxUploadBytes,
    stageFile,
    removeFromStage,
    runBatch,
    analyzeStatus,
    hasData,
    error,
    uploadNotice,
    dismissUploadNotice,
  } = useData();

  const fileInputRef = useRef(null);
  const [autoActive, setAutoActive] = useState(false);
  const [autoCancelled, setAutoCancelled] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTORUN_SECONDS);
  const [localError, setLocalError] = useState(null);
  const [runId, setRunId] = useState(0);
  // Last batch signature that we analyzed — used to skip auto-firing the
  // countdown again on the same set of staged files.
  const [lastAnalyzedKey, setLastAnalyzedKey] = useState(null);
  const tickRef = useRef(null);

  const busy = analyzeStatus === 'analyzing';
  const canRun = stagedReadyCount > 0 && !stagedParsing && !busy;
  const stageKey = staged
    .map((it) => `${it.id}:${it.status}`)
    .join('|');
  const alreadyAnalyzed = lastAnalyzedKey === stageKey;

  const cancelAuto = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setAutoActive(false);
    setSecondsLeft(AUTORUN_SECONDS);
  };

  // Start (or restart) the auto-run countdown whenever the batch reaches a
  // "ready" state with no parsing in flight, has changed since the last
  // analysis, and the user hasn't paused auto-run. Cancel on any change.
  useEffect(() => {
    cancelAuto();
    if (!canRun || autoCancelled || alreadyAnalyzed) return undefined;

    setAutoActive(true);
    setSecondsLeft(AUTORUN_SECONDS);
    setRunId((id) => id + 1);

    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
          setAutoActive(false);
          setLastAnalyzedKey(stageKey);
          // Fire on the next tick so React state above settles first.
          setTimeout(() => {
            runBatch().catch(() => {});
          }, 0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, canRun, autoCancelled, alreadyAnalyzed]);

  const handleAddClick = () => {
    setAutoCancelled(false);
    fileInputRef.current?.click();
  };

  const handleFileInput = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setLocalError(null);
    setAutoCancelled(false);
    for (const file of files) {
      try {
        await stageFile(file);
      } catch (err) {
        setLocalError(err.message || 'Failed to add file.');
        // continue with the rest
      }
    }
  };

  const handleRemove = (id) => {
    setLocalError(null);
    setAutoCancelled(false);
    removeFromStage(id);
  };

  const handleRunNow = async () => {
    cancelAuto();
    setLocalError(null);
    setLastAnalyzedKey(stageKey);
    try {
      await runBatch();
    } catch (err) {
      setLocalError(err.message || 'Analysis failed.');
    }
  };

  const handlePauseAuto = () => {
    setAutoCancelled(true);
    cancelAuto();
  };

  if (staged.length === 0) {
    return null;
  }

  const used = stagedTotalBytes;
  const usedPct = Math.min(100, Math.round((used / maxUploadBytes) * 100));
  const remaining = Math.max(0, maxUploadBytes - used);
  const remainingPct = Math.max(0, 100 - usedPct);

  return (
    <section className="stager">
      <header className="stager__head">
        <div>
          <h2 className="section-header stager__title">
            Files in this <em>batch</em>
          </h2>
          <p className="section-subhead">
            {staged.length} file{staged.length === 1 ? '' : 's'} staged ·{' '}
            <strong>{formatBytes(used)}</strong> of {formatBytes(maxUploadBytes)} used
            ({remainingPct}% / {formatBytes(remaining)} remaining). The analyzer
            runs once on the merged data.
          </p>
        </div>
      </header>

      <div className="stager__budget">
        <progress
          className="stager__budget-bar"
          value={usedPct}
          max={100}
          aria-label="Combined upload size"
        />
        <span className="stager__budget-label">
          {usedPct}% of 50 MB
        </span>
      </div>

      {uploadNotice && (
        <div className="stager__notice" role="status">
          <p className="stager__notice-text">{uploadNotice}</p>
          <button
            type="button"
            className="stager__notice-dismiss"
            onClick={dismissUploadNotice}
          >
            Dismiss
          </button>
        </div>
      )}

      <ul className="stager__list">
        {staged.map((item) => (
          <StagedRow
            key={item.id}
            item={item}
            onRemove={handleRemove}
            busy={busy}
          />
        ))}
        <li className="stager__add-row">
          <button
            type="button"
            className="stager__add"
            onClick={handleAddClick}
            disabled={busy || used >= maxUploadBytes}
            aria-label="Add another workbook"
          >
            <span className="stager__add-icon">
              <LuPlus size={18} />
            </span>
            <span className="stager__add-text">
              Add another file
              <small>
                {used >= maxUploadBytes
                  ? '50 MB budget used — remove a file to add more'
                  : `Up to ${formatBytes(remaining)} remaining`}
              </small>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.pdf"
            className="upload-input"
            onChange={handleFileInput}
          />
        </li>
      </ul>

      {(localError || error) && (
        <div className="stager__error">
          <LuTriangleAlert size={14} /> {localError || error}
        </div>
      )}

      <div className="stager__actions">
        <CountdownButton
          runId={runId}
          secondsLeft={secondsLeft}
          autoActive={autoActive && canRun}
          onRun={handleRunNow}
          onPause={handlePauseAuto}
          busy={busy}
          ready={canRun}
        />
        {autoCancelled && canRun && (
          <button
            type="button"
            className="btn btn--ghost stager__resume"
            onClick={() => setAutoCancelled(false)}
          >
            Resume auto-run
          </button>
        )}
        {hasData && (
          <p className="stager__hint">
            {stagedReadyCount === 1
              ? 'Re-running will replace the current dashboard dataset.'
              : `Will merge ${stagedReadyCount} workbooks into one dataset.`}
          </p>
        )}
      </div>
    </section>
  );
}
