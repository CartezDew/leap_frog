// Global app state.
//
// Holds two related but distinct things:
//  1. `dataset`        — the analyzed dashboard payload, persisted to
//                        localStorage so the dashboard survives a refresh.
//  2. `staged`         — the in-flight list of parsed workbooks the user has
//                        added to the upload batch (max 50 MB combined).
//                        Not persisted; only lives during this session.
//
// Components stage workbooks via stageFile() / stageFromUploadData(),
// then run analysis on the whole batch via runBatch().

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  parseFile,
  parseFromUploadData,
  analyzeBatch,
} from '../lib/sheetReader.js';
import { crawlLeapfrogSite } from '../lib/siteCrawler.js';
import { fetchUploadDataManifest } from '../lib/uploadDataLibrary.js';
import { MAX_UPLOAD_BYTES, STORAGE_KEY } from '../lib/skillConfig.js';

const DataContext = createContext(null);
const SYNTHETIC_DATA_RX = /(?:^|[-_\s])(synthetic|sample|demo|test)(?:[-_\s.]|$)/i;

function isSyntheticSource(value) {
  return SYNTHETIC_DATA_RX.test(String(value || ''));
}

function readFromStorage() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to read leapfrog_data from localStorage', err);
    return null;
  }
}

function writeToStorage(payload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to persist leapfrog_data to localStorage', err);
  }
}

function clearStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear leapfrog_data', err);
  }
}

let stagedIdCounter = 0;
function nextStagedId() {
  stagedIdCounter += 1;
  return `staged-${Date.now().toString(36)}-${stagedIdCounter}`;
}

export function DataProvider({ children }) {
  const [dataset, setDataset] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState('idle'); // idle | analyzing | ready | error
  const [siteCrawlStatus, setSiteCrawlStatus] = useState('idle'); // idle | crawling | ready | error
  const [siteCrawlError, setSiteCrawlError] = useState(null);
  const [error, setError] = useState(null);
  /** Non-blocking notice (e.g. duplicate file content skipped at staging). */
  const [uploadNotice, setUploadNotice] = useState(null);
  const [manifest, setManifest] = useState([]);
  const [manifestLoading, setManifestLoading] = useState(false);

  // staged is the in-flight upload batch.
  // Each item: { id, name, size, source, status, progress, parsed?, analysisSheets?, metadata?, sourceUrl?, error? }
  const [staged, setStaged] = useState([]);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => {
    const cached = readFromStorage();
    if (cached) {
      setDataset(cached);
      setAnalyzeStatus('ready');
    }
    setHydrated(true);
  }, []);

  const refreshManifest = useCallback(async () => {
    setManifestLoading(true);
    try {
      const list = await fetchUploadDataManifest();
      setManifest(list);
      return list;
    } finally {
      setManifestLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshManifest();
  }, [refreshManifest]);

  // -----------------------------------------------------------------------
  // Staging API
  // -----------------------------------------------------------------------

  const updateStagedItem = useCallback((id, patch) => {
    setStaged((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const findStagedByName = (list, name, source) =>
    list.find(
      (item) => item.name === name && (source ? item.source === source : true),
    );

  const validateBudget = useCallback(
    (incomingSize) => {
      const current = stagedRef.current.reduce(
        (sum, item) => sum + (item.size || 0),
        0,
      );
      if (current + incomingSize > MAX_UPLOAD_BYTES) {
        const mb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
        throw new Error(
          `Adding this file would exceed the ${mb} MB combined upload budget.`,
        );
      }
    },
    [],
  );

  const dismissUploadNotice = useCallback(() => {
    setUploadNotice(null);
  }, []);

  const stageFile = useCallback(
    async (file) => {
      if (!file) throw new Error('No file provided.');
      setError(null);
      setUploadNotice(null);

      // Skip duplicates by name.
      if (findStagedByName(stagedRef.current, file.name, 'file')) {
        throw new Error(`"${file.name}" is already in the batch.`);
      }
      validateBudget(file.size || 0);

      const id = nextStagedId();
      const placeholder = {
        id,
        name: file.name,
        size: file.size || 0,
        source: 'file',
        status: 'parsing',
        progress: 0,
        addedAt: Date.now(),
      };
      setStaged((prev) => [...prev, placeholder]);

      try {
        const parsed = await parseFile(file, (pct) =>
          updateStagedItem(id, { progress: pct }),
        );
        const kind = parsed.kind || 'workbook';
        const dup = stagedRef.current.find(
          (x) =>
            x.id !== id &&
            x.status === 'ready' &&
            parsed.contentHash &&
            x.contentHash === parsed.contentHash &&
            (x.kind || 'workbook') === kind,
        );
        if (dup) {
          updateStagedItem(id, {
            status: 'duplicate',
            progress: 100,
            kind,
            contentHash: parsed.contentHash,
            duplicateOfName: dup.name,
          });
          setUploadNotice(
            `Duplicate file detected: "${file.name}" is byte-identical to "${dup.name}". It was not added to the analysis batch — only the first copy is used when you run analysis.`,
          );
          return id;
        }
        updateStagedItem(id, {
          status: 'ready',
          progress: 100,
          kind,
          parsed: parsed.parsed,
          analysisSheets: parsed.analysisSheets,
          metadata: parsed.metadata,
          rawTotals: parsed.rawTotals || {},
          semrushSnapshot: parsed.semrushSnapshot || null,
          size: parsed.size || file.size || 0,
          contentHash: parsed.contentHash,
        });
        return id;
      } catch (err) {
        console.error('Failed to parse', file.name, err);
        updateStagedItem(id, {
          status: 'error',
          error: err.message || 'Parse failed.',
        });
        throw err;
      }
    },
    [updateStagedItem, validateBudget],
  );

  const stageFromUploadData = useCallback(
    async (entry) => {
      if (!entry || !entry.url) throw new Error('No file selected.');
      setError(null);
      setUploadNotice(null);

      if (findStagedByName(stagedRef.current, entry.name, 'upload_data')) {
        throw new Error(`"${entry.name}" is already in the batch.`);
      }
      validateBudget(entry.size || 0);

      const id = nextStagedId();
      const placeholder = {
        id,
        name: entry.name,
        size: entry.size || 0,
        source: 'upload_data',
        sourceUrl: entry.url,
        status: 'parsing',
        progress: 0,
        addedAt: Date.now(),
      };
      setStaged((prev) => [...prev, placeholder]);

      try {
        const parsed = await parseFromUploadData(entry, (pct) =>
          updateStagedItem(id, { progress: pct }),
        );
        const kind = parsed.kind || 'workbook';
        const dup = stagedRef.current.find(
          (x) =>
            x.id !== id &&
            x.status === 'ready' &&
            parsed.contentHash &&
            x.contentHash === parsed.contentHash &&
            (x.kind || 'workbook') === kind,
        );
        if (dup) {
          updateStagedItem(id, {
            status: 'duplicate',
            progress: 100,
            kind,
            contentHash: parsed.contentHash,
            duplicateOfName: dup.name,
          });
          setUploadNotice(
            `Duplicate file detected: "${entry.name}" is byte-identical to "${dup.name}". It was not added to the analysis batch — only the first copy is used when you run analysis.`,
          );
          return id;
        }
        updateStagedItem(id, {
          status: 'ready',
          progress: 100,
          kind,
          parsed: parsed.parsed,
          analysisSheets: parsed.analysisSheets,
          metadata: parsed.metadata,
          rawTotals: parsed.rawTotals || {},
          semrushSnapshot: parsed.semrushSnapshot || null,
          size: parsed.size || entry.size || 0,
          contentHash: parsed.contentHash,
        });
        return id;
      } catch (err) {
        console.error('Failed to parse', entry.name, err);
        updateStagedItem(id, {
          status: 'error',
          error: err.message || 'Parse failed.',
        });
        throw err;
      }
    },
    [updateStagedItem, validateBudget],
  );

  const removeFromStage = useCallback((id) => {
    setStaged((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearStage = useCallback(() => {
    setStaged([]);
    setUploadNotice(null);
  }, []);

  const runBatch = useCallback(async () => {
    setError(null);
    setUploadNotice(null);
    const items = stagedRef.current.filter((it) => it.status === 'ready');
    if (items.length === 0) {
      throw new Error('No parsed files staged. Add a file first.');
    }
    setAnalyzeStatus('analyzing');
    try {
      // Yield a tick so the spinner can render before heavy analysis work.
      await new Promise((r) => setTimeout(r, 0));
      const result = analyzeBatch(items);
      setDataset(result);
      writeToStorage(result);
      setAnalyzeStatus('ready');
      return result;
    } catch (err) {
      console.error('Failed to run batch analysis', err);
      setError(err.message || 'Analysis failed.');
      setAnalyzeStatus('error');
      throw err;
    }
  }, []);

  const runSiteCrawl = useCallback(async (options = {}) => {
    setSiteCrawlError(null);
    setSiteCrawlStatus('crawling');
    try {
      const result = await crawlLeapfrogSite(options);
      setDataset((prev) => {
        const next = {
          ...(prev || {}),
          siteCrawl: result,
          siteCrawlUpdatedAt: new Date().toISOString(),
        };
        writeToStorage(next);
        return next;
      });
      setSiteCrawlStatus('ready');
      return result;
    } catch (err) {
      console.error('Failed to crawl Leapfrog site', err);
      setSiteCrawlError(err.message || 'Site crawl failed.');
      setSiteCrawlStatus('error');
      throw err;
    }
  }, []);

  const clear = useCallback(() => {
    clearStorage();
    setDataset(null);
    setStaged([]);
    setAnalyzeStatus('idle');
    setSiteCrawlStatus('idle');
    setSiteCrawlError(null);
    setError(null);
    setUploadNotice(null);
  }, []);

  // Derived helpers
  const stagedTotalBytes = staged.reduce((sum, it) => sum + (it.size || 0), 0);
  const stagedReadyCount = staged.filter((it) => it.status === 'ready').length;
  const stagedParsing = staged.some((it) => it.status === 'parsing');
  const sourceFiles = dataset?.sourceFiles || [];
  const isSyntheticData = Boolean(
    dataset &&
      [
        dataset.filename,
        dataset.filenameLabel,
        ...sourceFiles.map((source) => source.filename),
        ...sourceFiles.map((source) => source.sourceUrl),
      ].some(isSyntheticSource),
  );

  // Derive which report types contributed to the current dataset. Older
  // payloads (persisted before we tracked `kinds`) fall back to inspecting
  // sourceFiles / parsed shape so the gating still behaves correctly after
  // a hot-reload.
  const kinds = useMemo(() => {
    if (dataset?.kinds) return dataset.kinds;
    const files = dataset?.sourceFiles || [];
    const semrushFiles = files.filter(
      (f) => f.kind === 'semrush_pdf' || /\.pdf$/i.test(f.filename || ''),
    );
    const workbookFiles = files.filter((f) => !semrushFiles.includes(f));
    const semrushSnapshots = Array.isArray(dataset?.analyzed?.semrush_keywords)
      ? dataset.analyzed.semrush_keywords
      : [];
    return {
      workbook_count: workbookFiles.length,
      semrush_pdf_count: semrushFiles.length,
      has_ga4: workbookFiles.length > 0,
      has_semrush: semrushFiles.length > 0 || semrushSnapshots.length > 0,
    };
  }, [dataset]);

  const value = useMemo(
    () => ({
      // dataset
      dataset,
      analyzed: dataset?.analyzed || null,
      analysisSheets: dataset?.analysisSheets || {},
      report: dataset?.report || null,
      metadata: dataset?.metadata || null,
      siteCrawl: dataset?.siteCrawl || null,
      siteCrawlUpdatedAt: dataset?.siteCrawlUpdatedAt || null,
      filename: dataset?.filename || '',
      filenameLabel: dataset?.filenameLabel || dataset?.filename || '',
      sourceFiles,
      fileCount: dataset?.fileCount || (dataset ? 1 : 0),
      uploadedAt: dataset?.uploadedAt || null,
      isSyntheticData,
      hasData: Boolean(dataset?.analyzed),
      hasGA4: Boolean(kinds?.has_ga4),
      hasSemrush: Boolean(kinds?.has_semrush),
      kinds,
      hydrated,
      analyzeStatus,
      siteCrawlStatus,
      siteCrawlError,
      error,
      uploadNotice,
      dismissUploadNotice,
      // staging
      staged,
      stagedTotalBytes,
      stagedReadyCount,
      stagedParsing,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      stageFile,
      stageFromUploadData,
      removeFromStage,
      clearStage,
      runBatch,
      runSiteCrawl,
      // dataset actions
      clear,
      // upload data folder manifest
      manifest,
      manifestLoading,
      refreshManifest,
    }),
    [
      dataset,
      sourceFiles,
      isSyntheticData,
      kinds,
      hydrated,
      analyzeStatus,
      siteCrawlStatus,
      siteCrawlError,
      error,
      uploadNotice,
      dismissUploadNotice,
      staged,
      stagedTotalBytes,
      stagedReadyCount,
      stagedParsing,
      stageFile,
      stageFromUploadData,
      removeFromStage,
      clearStage,
      runBatch,
      runSiteCrawl,
      clear,
      manifest,
      manifestLoading,
      refreshManifest,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used inside a <DataProvider>.');
  }
  return ctx;
}
