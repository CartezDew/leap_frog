// Keywords intelligence page.
//
// Built from Semrush "Organic Performance" PDFs the user uploads through
// the standard upload flow. Reads the parsed snapshots via
// `runKeywordAnalysis(analyzed)` (which now consumes
// `analyzed.semrush_keywords` rather than a static module) and renders:
//
//   - Empty state when no Semrush PDFs have been uploaded yet
//   - Story cards: at-a-glance "what is the SEO surface telling us"
//   - Theme heatmap (Talkwalker-style topic clustering, gated to 4+ months)
//   - Top movers / decliners — momentum like a social listening platform
//   - Estimated traffic value bar
//   - Cross-link panel: which GA4 landing pages match each keyword theme
//   - Underperformers panel: pages that rank but bleed visitors

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  LuArrowUpRight,
  LuArrowDownRight,
  LuTarget,
  LuFlame,
  LuShieldCheck,
  LuGoal,
  LuRocket,
  LuRadioTower,
  LuSearch,
  LuSparkles,
  LuFileText,
  LuChevronDown,
  LuChevronUp,
} from 'react-icons/lu';

import { PageHeader } from '../../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../../components/ChartWrapper/ChartWrapper.jsx';
import { VizExportToolbar } from '../../components/VizExportToolbar/VizExportToolbar.jsx';
import { StoryCards } from '../../components/StoryCards/StoryCards.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { KpiCard } from '../../components/KpiCard/KpiCard.jsx';
import { useData } from '../../context/DataContext.jsx';
import { runKeywordAnalysis, rollupByIntent } from '../../lib/keywordAnalyzer.js';
import { formatInteger, formatPercent } from '../../lib/formatters.js';
import { compareValues } from '../../lib/sortValues.js';
import { downloadSheetAsXlsx, downloadTableAsPdf } from '../../lib/tableExport.js';

import './Keywords.css';

const SCOPE_OPTIONS = [
  { id: 'national', label: 'National' },
  { id: 'local', label: 'Local' },
];

function fmtPos(p) {
  if (p == null) return '—';
  return `#${p}`;
}

function fmtDelta(delta) {
  if (delta == null) return null;
  if (delta > 0) return `▲ ${delta}`;
  if (delta < 0) return `▼ ${Math.abs(delta)}`;
  return '— 0';
}

function deltaTone(delta) {
  if (delta == null) return 'flat';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

/** Default sort for the intent keyword drill-down table by bucket type. */
function defaultIntentTableSort(intentKey) {
  switch (intentKey) {
    case 'commercial-investigation':
    case 'service-intent':
      return { key: 'volume', dir: 'desc' };
    case 'planning':
      return { key: 'est_value', dir: 'desc' };
    case 'definitional':
    case 'informational':
    default:
      return { key: 'position', dir: 'asc' };
  }
}

function PositionPill({ position }) {
  if (position == null) {
    return <span className="kw-pos kw-pos--unranked">UNR</span>;
  }
  let cls = 'kw-pos--page2';
  if (position <= 3) cls = 'kw-pos--top3';
  else if (position <= 10) cls = 'kw-pos--page1';
  else if (position <= 20) cls = 'kw-pos--page2';
  else if (position <= 50) cls = 'kw-pos--page3';
  else cls = 'kw-pos--deep';
  return <span className={`kw-pos ${cls}`}>#{position}</span>;
}

function ThemeChip({ theme }) {
  return (
    <span
      className="kw-theme-chip"
      style={{
        background: `${theme.color}1a`,
        color: theme.color,
        borderColor: `${theme.color}44`,
      }}
    >
      {theme.label}
    </span>
  );
}

function rankHeatClass(position) {
  if (position == null) return 'kw-heat__cell--empty';
  if (position <= 3) return 'kw-heat__cell--top3';
  if (position <= 10) return 'kw-heat__cell--page1';
  if (position <= 20) return 'kw-heat__cell--page2';
  if (position <= 50) return 'kw-heat__cell--page3';
  return 'kw-heat__cell--deep';
}

/** e.g. "MAR 2026" → "MAR 26'" for compact heatmap column headers */
function abbreviateKeywordMonthLabel(label) {
  if (!label || typeof label !== 'string') return label;
  return label.replace(/\b(19|20)(\d{2})\b/g, (_, __, yy) => `${yy}'`);
}

function HeatCell({ position, monthLabel }) {
  if (position == null) {
    return <td className="kw-heat__cell kw-heat__cell--empty">—</td>;
  }
  return (
    <td
      className={`kw-heat__cell ${rankHeatClass(position)}`}
      title={`${monthLabel}: position #${position}`}
    >
      {position}
    </td>
  );
}

function heatSortValue(row, sortKey) {
  if (sortKey === 'keyword') return row.keyword;
  if (sortKey === 'volume') return row.volume ?? null;
  if (sortKey === 'cpc') return row.cpc ?? null;
  if (sortKey === 'latest') return row.latest ?? null;
  if (String(sortKey).startsWith('m:')) {
    const mk = String(sortKey).slice(2);
    const c = row.cells.find((x) => x.month === mk);
    return c?.position ?? null;
  }
  return null;
}

function defaultHeatSortDir(sortKey) {
  if (sortKey === 'keyword') return 'asc';
  if (sortKey === 'volume' || sortKey === 'cpc') return 'desc';
  return 'asc';
}

function isSemrushSourceFile(file) {
  const filename = file?.filename || '';
  return file?.kind === 'semrush_pdf' || /\.pdf$/i.test(filename);
}

function buildSourceReminder(sourceFiles, fallbackLabel) {
  const semrushFiles = (sourceFiles || []).filter(isSemrushSourceFile);
  const relevantFiles = semrushFiles.length > 0 ? semrushFiles : sourceFiles || [];
  const names = relevantFiles.map((file) => file.filename).filter(Boolean);

  if (names.length === 0) {
    return {
      label: 'Connected (0)',
      title: fallbackLabel,
    };
  }

  return {
    label: `Connected (${names.length})`,
    title: names.join('\n'),
  };
}

function KeywordsEmptyState() {
  return (
    <>
      <PageHeader
        badge="Semrush · Organic Performance"
        badgeVariant="purple"
        title="Keywords Intelligence"
        subtitle="Upload your monthly Semrush 'Organic Performance' PDFs to unlock SERP momentum, topic clustering, and keyword-to-landing-page matching."
      />
      <section className="card kw-empty" aria-live="polite">
        <span className="kw-empty__icon" aria-hidden="true">
          <LuFileText size={26} />
        </span>
        <h2 className="kw-empty__title">No Semrush data yet</h2>
        <p className="kw-empty__body">
          The Keywords page reads each month's Semrush PDF directly in the
          browser — no backend, no manual extraction. Upload one or more
          monthly exports to populate this view.
        </p>
        <ol className="kw-empty__steps">
          <li>
            Export the Semrush <strong>Organic Performance</strong> report for
            the month you want to analyze.
          </li>
          <li>
            Open the <em>Upload Data</em> page and drop the
            <span className="text-mono"> .pdf</span> file (multiple months are
            fine — they merge into a timeline).
          </li>
          <li>
            Run the analysis. The Keywords tab unlocks automatically once a
            valid PDF is parsed.
          </li>
        </ol>
        <Link to="/upload" className="kw-empty__cta">
          Open Upload Data <LuArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}

export function Keywords() {
  const { analyzed, filenameLabel, sourceFiles } = useData();
  const [scope, setScope] = useState('national');
  const [heatSort, setHeatSort] = useState({ key: 'latest', dir: 'asc' });
  const [selectedIntentKey, setSelectedIntentKey] = useState(null);
  const [intentPanelOpen, setIntentPanelOpen] = useState(false);

  const data = useMemo(() => runKeywordAnalysis(analyzed), [analyzed]);

  // Always recompute month matrix derived state (must run before any early
  // return per the rules of hooks).
  const keywordMatrix = useMemo(() => {
    const months = (data.monthly || []).map((m) => ({
      key: m.month,
      label: abbreviateKeywordMonthLabel(m.label),
    }));
    const matrix = (data.timeline || [])
      .filter((t) => t.scope === scope)
      .map((keyword) => ({
        keyword: keyword.keyword,
        theme: keyword.theme,
        volume: keyword.latest?.volume ?? null,
        cpc: keyword.latest?.cpc ?? null,
        latest: keyword.latest?.position ?? null,
        cells: months.map((mo) => {
          const snap = keyword.history.find((h) => h.month === mo.key);
          return {
            month: mo.key,
            label: mo.label,
            position: snap?.position ?? null,
          };
        }),
      }));
    return { months, matrix };
  }, [data.timeline, data.monthly, scope]);

  const sortedHeatRows = useMemo(() => {
    const { matrix } = keywordMatrix;
    if (!matrix?.length) return [];
    const orderIdx = new Map(matrix.map((r, i) => [r.keyword, i]));
    const copy = [...matrix];
    copy.sort((a, b) => {
      const va = heatSortValue(a, heatSort.key);
      const vb = heatSortValue(b, heatSort.key);
      let cmp = compareValues(va, vb, heatSort.dir);
      if (cmp !== 0) return cmp;
      return (orderIdx.get(a.keyword) ?? 0) - (orderIdx.get(b.keyword) ?? 0);
    });
    return copy;
  }, [keywordMatrix, heatSort]);

  const intents = useMemo(
    () => rollupByIntent(data.timeline || [], scope),
    [data.timeline, scope],
  );

  useEffect(() => {
    setSelectedIntentKey(null);
    setIntentPanelOpen(false);
  }, [scope]);

  const intentKeywordRows = useMemo(() => {
    if (!selectedIntentKey) return [];
    return (data.timeline || [])
      .filter(
        (t) => t.scope === scope && t.intent && t.intent.key === selectedIntentKey,
      )
      .map((t) => ({
        id: `${t.keyword}|${t.scope}`,
        keyword: t.keyword,
        theme: t.theme,
        position: t.latest?.position ?? null,
        prev_position: t.prev_position ?? null,
        volume: t.latest?.volume ?? null,
        cpc: t.latest?.cpc ?? null,
        est_value: t.est_value ?? 0,
        mom_delta: t.mom_delta,
      }));
  }, [data.timeline, scope, selectedIntentKey]);

  // Empty state — no Semrush PDFs uploaded.
  if (data.empty) {
    return <KeywordsEmptyState />;
  }

  // Recompute scope-dependent slices on the fly so the user can flip
  // National ↔ Local without throwing away anything else.
  const trend = data.trend[scope] || [];
  const themes = data.themes[scope] || []; // eslint-disable-line no-unused-vars
  const insights = data.insights;
  const cross = data.cross;
  const sourceReminder = buildSourceReminder(
    sourceFiles,
    filenameLabel || data.source,
  );

  const latestSummary = trend[trend.length - 1];
  const firstSummary = trend[0];

  const avgPositionDelta =
    latestSummary && firstSummary
      ? firstSummary.avg_position - latestSummary.avg_position
      : null;
  const top10Delta =
    latestSummary && firstSummary
      ? latestSummary.top10 - firstSummary.top10
      : null;
  const topMover = insights.movers[0];
  const topDecliner = insights.decliners[0];

  // ---- Story cards ----
  const storyCards = [
    {
      id: 'tracked',
      tone: 'purple',
      icon: LuRadioTower,
      label: 'Keywords tracked',
      value: formatInteger(latestSummary?.tracked || 0),
      headline: `${formatInteger(latestSummary?.ranked || 0)} ranked in top 100`,
      caption: `${formatInteger(latestSummary?.top10 || 0)} on page 1 · ${formatInteger(
        latestSummary?.top3 || 0,
      )} in the top 3`,
      footer:
        top10Delta != null
          ? top10Delta > 0
            ? `+${top10Delta} more on page 1 since ${firstSummary?.label}`
            : top10Delta < 0
              ? `${top10Delta} on page 1 vs ${firstSummary?.label}`
              : 'Page-1 footprint is flat'
          : 'Single-month snapshot.',
    },
    {
      id: 'avg-pos',
      tone:
        latestSummary?.avg_position != null && latestSummary.avg_position <= 20
          ? 'green'
          : 'amber',
      icon: LuTarget,
      label: 'Avg national position',
      value:
        latestSummary?.avg_position != null
          ? latestSummary.avg_position.toFixed(1)
          : '—',
      headline:
        avgPositionDelta != null
          ? avgPositionDelta > 0
            ? `Improved by ${avgPositionDelta.toFixed(1)} positions`
            : avgPositionDelta < 0
              ? `Slipped by ${Math.abs(avgPositionDelta).toFixed(1)} positions`
              : 'Flat vs first snapshot'
          : '—',
      caption: 'Average rank across all tracked keywords this month.',
      footer: `From ${firstSummary?.label} → latest ${latestSummary?.label}`,
    },
    {
      id: 'value',
      tone: 'green',
      icon: LuFlame,
      label: 'Est. monthly traffic value',
      value: latestSummary
        ? `$${formatInteger(latestSummary.est_monthly_value)}`
        : '—',
      headline: latestSummary
        ? `${formatInteger(latestSummary.est_monthly_clicks)} estimated clicks`
        : '—',
      caption:
        'CPC × monthly volume × CTR-by-position. Comparable to what AdWords would charge for the same traffic.',
      footer: `Across ${formatInteger(latestSummary?.tracked || 0)} keywords`,
    },
    {
      id: 'top-mover',
      tone: topMover ? 'green' : 'info',
      icon: LuRocket,
      label: 'Top mover this month',
      value: topMover ? `+${topMover.mom_delta}` : '—',
      headline: topMover
        ? `${topMover.keyword} climbed to #${topMover.latest.position}`
        : 'No improvers MoM',
      caption: topMover
        ? `Theme: ${topMover.theme.label}`
        : 'Need ≥ 2 months of data for momentum.',
      footer: topDecliner
        ? `Worst slide: ${topDecliner.keyword} ${topDecliner.mom_delta} positions`
        : 'No decliners detected.',
    },
  ];

  // ---- Movers/decliners table rows ----
  const moverColumns = [
    {
      key: 'keyword',
      header: 'Keyword',
      className: 'col-strong',
      render: (row) => (
        <div className="kw-cell-keyword">
          <span className="kw-cell-keyword__text">{row.keyword}</span>
          <span className="kw-cell-keyword__theme">
            <ThemeChip theme={row.theme} />
          </span>
        </div>
      ),
      sortValue: (row) => row.keyword,
      exportValue: (row) => `${row.keyword} (${row.theme?.label || ''})`,
    },
    {
      key: 'mom_delta',
      header: 'MoM',
      align: 'right',
      render: (row) => (
        <span className={`kw-delta kw-delta--${deltaTone(row.mom_delta)}`}>
          {fmtDelta(row.mom_delta)}
        </span>
      ),
      sortValue: (row) => -(row.mom_delta || 0),
      exportValue: (row) => row.mom_delta ?? '',
    },
    {
      key: 'latest_position',
      header: 'Now',
      align: 'right',
      render: (row) => <PositionPill position={row.latest.position} />,
      sortValue: (row) => row.latest.position ?? 999,
      exportValue: (row) => row.latest?.position ?? '',
    },
    {
      key: 'prev_position',
      header: 'Prev',
      align: 'right',
      render: (row) => <PositionPill position={row.prev_position} />,
      sortValue: (row) => row.prev_position ?? 999,
      exportValue: (row) => row.prev_position ?? '',
    },
    {
      key: 'volume',
      header: 'Volume',
      align: 'right',
      render: (row) => formatInteger(row.latest.volume) || '—',
      sortValue: (row) => row.latest.volume ?? 0,
      exportValue: (row) => row.latest?.volume ?? '',
    },
    {
      key: 'est_value',
      header: 'Est. value',
      align: 'right',
      render: (row) =>
        row.est_value > 0 ? `$${formatInteger(row.est_value)}` : '—',
      sortValue: (row) => row.est_value || 0,
      exportValue: (row) => row.est_value || 0,
    },
  ];

  const intentKeywordColumns = [
    {
      key: 'keyword',
      header: 'Keyword',
      className: 'col-strong',
      render: (row) => (
        <div className="kw-cell-keyword">
          <span className="kw-cell-keyword__text">{row.keyword}</span>
          <span className="kw-cell-keyword__theme">
            <ThemeChip theme={row.theme} />
          </span>
        </div>
      ),
      sortValue: (row) => row.keyword,
      exportValue: (row) => `${row.keyword} (${row.theme?.label || ''})`,
    },
    {
      key: 'mom_delta',
      header: 'MoM',
      align: 'right',
      render: (row) => (
        <span className={`kw-delta kw-delta--${deltaTone(row.mom_delta)}`}>
          {fmtDelta(row.mom_delta)}
        </span>
      ),
      sortValue: (row) => -(row.mom_delta || 0),
      exportValue: (row) => row.mom_delta ?? '',
    },
    {
      key: 'position',
      header: 'Rank',
      align: 'right',
      render: (row) => <PositionPill position={row.position} />,
      sortValue: (row) => row.position ?? 999,
      exportValue: (row) => row.position ?? '',
    },
    {
      key: 'prev_position',
      header: 'Prev',
      align: 'right',
      render: (row) => <PositionPill position={row.prev_position} />,
      sortValue: (row) => row.prev_position ?? 999,
      exportValue: (row) => row.prev_position ?? '',
    },
    {
      key: 'volume',
      header: 'Volume',
      align: 'right',
      render: (row) => formatInteger(row.volume) || '—',
      sortValue: (row) => row.volume ?? 0,
      exportValue: (row) => row.volume ?? '',
    },
    {
      key: 'cpc',
      header: 'CPC',
      align: 'right',
      render: (row) =>
        row.cpc != null ? `$${Number(row.cpc).toFixed(2)}` : '—',
      sortValue: (row) => row.cpc ?? 0,
      exportValue: (row) => (row.cpc != null ? Number(row.cpc).toFixed(2) : ''),
    },
    {
      key: 'est_value',
      header: 'Est. value',
      align: 'right',
      render: (row) =>
        row.est_value > 0 ? `$${formatInteger(row.est_value)}` : '—',
      sortValue: (row) => row.est_value || 0,
      exportValue: (row) => row.est_value || 0,
    },
  ];

  // ---- Cross-link page-match table ----
  const matchColumns = [
    {
      key: 'keyword',
      header: 'Keyword',
      className: 'col-strong',
      render: (row) => (
        <div className="kw-cell-keyword">
          <span className="kw-cell-keyword__text">{row.keyword}</span>
          <span className="kw-cell-keyword__theme">
            <span
              className="kw-theme-chip"
              style={{
                background: '#522e9114',
                color: '#522e91',
                borderColor: '#522e9133',
              }}
            >
              {row.theme}
            </span>
          </span>
        </div>
      ),
      sortValue: (row) => row.keyword,
      exportValue: (row) => `${row.keyword} (${row.theme})`,
    },
    {
      key: 'latest_position',
      header: 'Rank',
      align: 'right',
      render: (row) => <PositionPill position={row.latest_position} />,
      sortValue: (row) => row.latest_position ?? 999,
      exportValue: (row) => row.latest_position ?? '',
    },
    {
      key: 'top_page',
      header: 'Best matching landing page',
      render: (row) => {
        const top = row.pages[0];
        if (!top) return '—';
        return (
          <code className="kw-page-path" title={top.path}>
            {top.path}
          </code>
        );
      },
      exportValue: (row) => row.pages[0]?.path ?? '',
    },
    {
      key: 'sessions',
      header: 'Page sessions',
      align: 'right',
      render: (row) => formatInteger(row.pages[0]?.sessions || 0),
      sortValue: (row) => row.pages[0]?.sessions ?? 0,
      exportValue: (row) => row.pages[0]?.sessions ?? 0,
    },
    {
      key: 'bounce',
      header: 'Page bounce',
      align: 'right',
      render: (row) => {
        const b = row.pages[0]?.bounce_rate ?? 0;
        const tone = b >= 0.6 ? 'red' : b >= 0.5 ? 'amber' : 'green';
        return (
          <span className={`kw-bounce kw-bounce--${tone}`}>
            {formatPercent(b, 0)}
          </span>
        );
      },
      sortValue: (row) => row.pages[0]?.bounce_rate ?? 0,
      exportValue: (row) =>
        row.pages[0]?.bounce_rate != null ? formatPercent(row.pages[0].bounce_rate, 1) : '',
    },
  ];

  function handleHeatSort(key) {
    setHeatSort((prev) => {
      if (!prev || prev.key !== key) {
        return { key, dir: defaultHeatSortDir(key) };
      }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  function heatHeaderAriaSort(key) {
    if (heatSort.key !== key) return 'none';
    return heatSort.dir === 'asc' ? 'ascending' : 'descending';
  }

  function exportHeatmapRows() {
    const months = keywordMatrix.months;
    const headers = [
      'Keyword',
      'Theme',
      'Volume',
      'CPC',
      ...months.map((m) => m.label),
      'Latest #',
    ];
    const body = sortedHeatRows.map((row) => [
      row.keyword,
      row.theme.label,
      row.volume ?? '',
      row.cpc != null ? Number(row.cpc).toFixed(2) : '',
      ...row.cells.map((c) => (c.position != null ? c.position : '')),
      row.latest ?? '',
    ]);
    return { headers, body };
  }

  function exportHeatmapXlsx() {
    if (sortedHeatRows.length <= 5) return;
    const { headers, body } = exportHeatmapRows();
    downloadSheetAsXlsx(`keywords-heatmap-${scope}`, 'Heatmap', headers, body);
  }

  function exportHeatmapPdf() {
    if (sortedHeatRows.length <= 5) return;
    const { headers, body } = exportHeatmapRows();
    downloadTableAsPdf(`keywords-heatmap-${scope}`, headers, body);
  }

  function exportValueDriversRows() {
    const headers = ['Keyword', 'Theme', 'Est. monthly value'];
    const body = (insights.value_drivers || []).map((kw) => [
      kw.keyword,
      kw.theme?.label || '',
      kw.est_value ?? 0,
    ]);
    return { headers, body };
  }

  // ---- Render ----
  return (
    <>
      <PageHeader
        badge="Semrush · Organic Performance"
        badgeVariant="purple"
        title="Keywords Intelligence"
        subtitle={`Topic clustering, momentum, and SERP movement for ${data.domain} — tied back to the GA4 landing pages those rankings drive traffic to.`}
        meta={
          <div className="kw-header-controls">
            <Link
              to="/upload"
              className="page-meta__stamp kw-source-link"
              title={sourceReminder.title}
              aria-label="Open Upload / Replace Data for these source files"
            >
              Source
              <strong>{sourceReminder.label}</strong>
            </Link>
            <div
              className="kw-scope-toggle"
              role="tablist"
              aria-label="Ranking scope"
            >
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={scope === opt.id}
                  className={`kw-scope-toggle__btn${
                    scope === opt.id ? ' is-active' : ''
                  }`}
                  onClick={() => setScope(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <StoryCards
        eyebrow="Search-listening briefing"
        title={
          <>
            What organic search is <em>telling you</em>
          </>
        }
        cards={storyCards}
        ariaLabel="Keyword intelligence story cards"
      />

      {/* ---- Keyword monthly heatmap --------------------------------------- */}
      {keywordMatrix.months.length > 0 && (
        <>
          <h2 className="section-header">
            Monthly keyword <em>heatmap</em>
            <span className="section-header__hint">
              <LuSparkles size={14} aria-hidden="true" /> rank strength by month
            </span>
          </h2>
          <p className="section-subhead">
            Each row is a tracked keyword and each month column shows its Semrush position.
            Green means strong page-1 visibility; yellow/orange means opportunity; red means
            deeper rankings that need content or authority work.
          </p>
          <div className="kw-heat-legend" aria-label="Keyword heatmap legend">
            <span><i className="kw-heat-legend__swatch kw-heat__cell--top3" /> Top 3</span>
            <span><i className="kw-heat-legend__swatch kw-heat__cell--page1" /> Page 1</span>
            <span><i className="kw-heat-legend__swatch kw-heat__cell--page2" /> Page 2</span>
            <span><i className="kw-heat-legend__swatch kw-heat__cell--page3" /> Pages 3-5</span>
            <span><i className="kw-heat-legend__swatch kw-heat__cell--deep" /> Deep rank</span>
            <span><i className="kw-heat-legend__swatch kw-heat__cell--empty" /> Unranked</span>
          </div>
          <div className="table-wrap kw-heat-card">
            <div className="table-scroll">
              <table className="kw-heat">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="kw-heat__keyword-col is-sortable"
                      aria-sort={heatHeaderAriaSort('keyword')}
                    >
                      <button
                        type="button"
                        className="kw-heat__th-btn"
                        onClick={() => handleHeatSort('keyword')}
                        title="Sort by keyword"
                        aria-label="Sort by keyword"
                      >
                        <span className="kw-heat__th-label">Keyword</span>
                        <span
                          className={`table__sort table__sort--${
                            heatSort.key === 'keyword' ? heatSort.dir : 'none'
                          }`}
                          aria-hidden="true"
                        >
                          <span className="table__sort-up">▲</span>
                          <span className="table__sort-down">▼</span>
                        </span>
                      </button>
                    </th>
                    <th
                      scope="col"
                      className="kw-heat__metric-col is-sortable"
                      aria-sort={heatHeaderAriaSort('volume')}
                    >
                      <button
                        type="button"
                        className="kw-heat__th-btn kw-heat__th-btn--num"
                        onClick={() => handleHeatSort('volume')}
                        title="Sort by volume"
                        aria-label="Sort by volume"
                      >
                        <span className="kw-heat__th-label">Vol.</span>
                        <span
                          className={`table__sort table__sort--${
                            heatSort.key === 'volume' ? heatSort.dir : 'none'
                          }`}
                          aria-hidden="true"
                        >
                          <span className="table__sort-up">▲</span>
                          <span className="table__sort-down">▼</span>
                        </span>
                      </button>
                    </th>
                    <th
                      scope="col"
                      className="kw-heat__metric-col is-sortable"
                      aria-sort={heatHeaderAriaSort('cpc')}
                    >
                      <button
                        type="button"
                        className="kw-heat__th-btn kw-heat__th-btn--num"
                        onClick={() => handleHeatSort('cpc')}
                        title="Sort by CPC"
                        aria-label="Sort by CPC"
                      >
                        <span className="kw-heat__th-label">CPC</span>
                        <span
                          className={`table__sort table__sort--${
                            heatSort.key === 'cpc' ? heatSort.dir : 'none'
                          }`}
                          aria-hidden="true"
                        >
                          <span className="table__sort-up">▲</span>
                          <span className="table__sort-down">▼</span>
                        </span>
                      </button>
                    </th>
                    {keywordMatrix.months.map((m) => {
                      const sk = `m:${m.key}`;
                      return (
                        <th
                          key={m.key}
                          scope="col"
                          className="is-sortable"
                          aria-sort={heatHeaderAriaSort(sk)}
                        >
                          <button
                            type="button"
                            className="kw-heat__th-btn kw-heat__th-btn--month"
                            onClick={() => handleHeatSort(sk)}
                            title={`Sort by ${m.label}`}
                            aria-label={`Sort by ${m.label}`}
                          >
                            <span className="kw-heat__th-label">{m.label}</span>
                            <span
                              className={`table__sort table__sort--${
                                heatSort.key === sk ? heatSort.dir : 'none'
                              }`}
                              aria-hidden="true"
                            >
                              <span className="table__sort-up">▲</span>
                              <span className="table__sort-down">▼</span>
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    <th
                      scope="col"
                      className="is-sortable"
                      aria-sort={heatHeaderAriaSort('latest')}
                    >
                      <button
                        type="button"
                        className="kw-heat__th-btn kw-heat__th-btn--num"
                        onClick={() => handleHeatSort('latest')}
                        title="Sort by latest rank"
                        aria-label="Sort by latest rank"
                      >
                        <span className="kw-heat__th-label">Latest #</span>
                        <span
                          className={`table__sort table__sort--${
                            heatSort.key === 'latest' ? heatSort.dir : 'none'
                          }`}
                          aria-hidden="true"
                        >
                          <span className="table__sort-up">▲</span>
                          <span className="table__sort-down">▼</span>
                        </span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHeatRows.slice(0, 40).map((row) => {
                    return (
                      <tr key={row.keyword}>
                        <th scope="row" className="kw-heat__keyword-col">
                          <span className="kw-heat__theme-cell">
                            <span
                              className="kw-heat__swatch"
                              style={{ background: row.theme.color }}
                              aria-hidden="true"
                            />
                            <span>
                              <span className="kw-heat__keyword">{row.keyword}</span>
                              <span className="kw-heat__theme-label">{row.theme.label}</span>
                            </span>
                          </span>
                        </th>
                        <td className="kw-heat__metric">{formatInteger(row.volume || 0)}</td>
                        <td className="kw-heat__metric">
                          {row.cpc != null ? `$${Number(row.cpc).toFixed(2)}` : '—'}
                        </td>
                        {row.cells.map((cell) => (
                          <HeatCell
                            key={cell.month}
                            position={cell.position}
                            monthLabel={cell.label}
                          />
                        ))}
                        <td className="kw-heat__latest">
                          {row.latest != null ? `#${row.latest}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sortedHeatRows.length > 40 && (
              <p className="kw-heat__note">
                Showing 40 of {sortedHeatRows.length} keywords (current sort). Use column headers to
                re-order.
                {sortedHeatRows.length > 5
                  ? ' Export (below) includes the full sorted list.'
                  : ''}
              </p>
            )}
            {sortedHeatRows.length > 5 && (
              <div className="table-export-dock">
                <span className="table-export-dock__label">Download table</span>
                <VizExportToolbar
                  className="viz-export-toolbar--dock"
                  onXlsx={exportHeatmapXlsx}
                  onPdf={exportHeatmapPdf}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* ---- Intent buckets (Talkwalker-style) ---------------------------- */}
      <h2 className="section-header">
        Searcher <em>intent mix</em>
        <span className="section-header__hint">
          <LuGoal size={14} aria-hidden="true" /> potential customers, not advertisers
        </span>
      </h2>
      <p className="section-subhead">
        Each tracked Semrush keyword is grouped by what the query looks like it is trying to accomplish.
        The number is how many <strong>keywords</strong> (search phrases) sit in that bucket for the{' '}
        <strong>{scope === 'local' ? 'local' : 'national'}</strong> scope — not people, leads, or ad buyers.
        Select a card to target that bucket, then use <strong>Expand keyword table</strong> below to show
        the sortable list (downloads appear in the table footer when enough rows).
      </p>
      <div className="kw-intent-grid" role="radiogroup" aria-label="Searcher intent buckets">
        {intents.map((intent) => (
          <article
            key={intent.key}
            role="button"
            tabIndex={0}
            aria-pressed={selectedIntentKey === intent.key}
            className={`kw-intent kw-intent--${intent.tone}${
              selectedIntentKey === intent.key ? ' kw-intent--selected' : ''
            }`}
            onClick={() => {
              setSelectedIntentKey(intent.key);
              setIntentPanelOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedIntentKey(intent.key);
                setIntentPanelOpen(false);
              }
            }}
          >
            <header className="kw-intent__head">
              <p className="kw-intent__label">{intent.label}</p>
              <div className="kw-intent__scope-rollup">
                <span className="kw-intent__count">{intent.keywords}</span>
                <span className="kw-intent__count-label">
                  keyword{intent.keywords === 1 ? '' : 's'}
                </span>
              </div>
            </header>
            <p className="kw-intent__desc">{intent.description}</p>
            <dl className="kw-intent__stats">
              <div>
                <dt>Avg position</dt>
                <dd>
                  {intent.avg_position != null
                    ? `#${intent.avg_position.toFixed(1)}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{formatInteger(intent.total_volume)}</dd>
              </div>
              <div>
                <dt>Est. value</dt>
                <dd>
                  {intent.est_value > 0
                    ? `$${formatInteger(intent.est_value)}`
                    : '—'}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="kw-intent-table-panel">
        {!selectedIntentKey ? (
          <p className="kw-intent-table-panel__hint muted">
            Select a bucket card above, then expand the keyword table to view and export that bucket's
            keywords.
          </p>
        ) : (
          <>
            <div
              className={`kw-intent-table-panel__bar${
                intentPanelOpen
                  ? ' kw-intent-table-panel__bar--open'
                  : ' kw-intent-table-panel__bar--closed'
              }`}
            >
              <div className="kw-intent-table-panel__summary">
                <span className="kw-intent-table-panel__eyebrow">Bucket keywords</span>
                <strong className="kw-intent-table-panel__title">
                  {intents.find((i) => i.key === selectedIntentKey)?.label || selectedIntentKey}
                </strong>
                <span className="kw-intent-table-panel__count muted">
                  {formatInteger(intentKeywordRows.length)} keyword
                  {intentKeywordRows.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--secondary kw-intent-table-panel__toggle"
                aria-expanded={intentPanelOpen}
                onClick={() => setIntentPanelOpen((open) => !open)}
              >
                {intentPanelOpen ? (
                  <>
                    Collapse table <LuChevronUp size={16} aria-hidden="true" />
                  </>
                ) : (
                  <>
                    Expand keyword table <LuChevronDown size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
            {intentPanelOpen &&
              (intentKeywordRows.length === 0 ? (
                <p className="kw-intent-table-panel__empty kw-intent-table-panel__empty--attached muted">
                  No keywords in this bucket.
                </p>
              ) : (
                <div className="kw-intent-table-panel__table">
                  <DataTable
                    columns={intentKeywordColumns}
                    rows={intentKeywordRows}
                    defaultSort={defaultIntentTableSort(selectedIntentKey)}
                    exportFileStem={`keywords-intent-${scope}-${selectedIntentKey}`}
                    emptyMessage="No keywords in this bucket."
                  />
                </div>
              ))}
          </>
        )}
      </div>

      {/* ---- Movers / decliners side by side ------------------------------ */}
      <div className="kw-momentum-stack">
        <div>
          <h2 className="section-header">
            Top <em>movers</em>
            <span className="section-header__hint">
              <LuArrowUpRight size={14} aria-hidden="true" /> climbing the SERP
            </span>
          </h2>
          <p className="section-subhead">
            Keywords that gained the most position points vs the previous snapshot. These
            are the ones to feature in the next monthly report.
          </p>
          {insights.movers.length === 0 ? (
            <p className="muted">No upward movement detected — need an additional snapshot.</p>
          ) : (
            <DataTable
              columns={moverColumns}
              rows={insights.movers.slice(0, 12)}
              defaultSort={{ key: 'mom_delta', dir: 'asc' }}
              exportFileStem={`keywords-movers-${scope}`}
            />
          )}
        </div>

        <div>
          <h2 className="section-header">
            <em>Decliners</em>
            <span className="section-header__hint">
              <LuArrowDownRight size={14} aria-hidden="true" /> losing ground
            </span>
          </h2>
          <p className="section-subhead">
            Keywords that slipped MoM. Audit on-page content, refresh the publication date,
            and check for new SERP features eating clicks.
          </p>
          {insights.decliners.length === 0 ? (
            <p className="muted">No decliners detected this month — clean run.</p>
          ) : (
            <DataTable
              columns={moverColumns}
              rows={insights.decliners.slice(0, 12)}
              defaultSort={{ key: 'mom_delta', dir: 'asc' }}
              exportFileStem={`keywords-decliners-${scope}`}
            />
          )}
        </div>
      </div>

      {/* ---- Brand fortress + value drivers ------------------------------- */}
      <div className="card-grid card-grid--cols-2">
        <div>
          <h2 className="section-header">
            Brand <em>fortress</em>
            <span className="section-header__hint">
              <LuShieldCheck size={14} aria-hidden="true" /> page-1 always
            </span>
          </h2>
          <p className="section-subhead">
            Keywords that have stayed inside the top 10 across every snapshot. Defend these:
            keep the page fresh, watch for SERP-feature changes, and add internal links.
          </p>
          {insights.fortress.length === 0 ? (
            <p className="muted">Nothing has held page 1 yet — keep tracking.</p>
          ) : (
            <ul className="kw-list">
              {insights.fortress.slice(0, 10).map((row) => (
                <li key={`${row.keyword}-${row.scope}`} className="kw-list__item">
                  <PositionPill position={row.latest.position} />
                  <span className="kw-list__keyword">{row.keyword}</span>
                  <ThemeChip theme={row.theme} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="section-header">
            Value <em>drivers</em>
            <span className="section-header__hint">
              <LuFlame size={14} aria-hidden="true" /> highest CPC × clicks
            </span>
          </h2>
          <p className="section-subhead">
            What this organic traffic would cost you in Google Ads if you had to buy it.
            Higher value = more important to defend.
          </p>
          <ChartWrapper height={320}>
            <BarChart
              data={insights.value_drivers.slice(0, 10).map((kw) => ({
                keyword: kw.keyword.length > 28
                  ? `${kw.keyword.slice(0, 26)}…`
                  : kw.keyword,
                value: kw.est_value,
                color: kw.theme.color,
              }))}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 12, bottom: 8 }}
            >
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                stroke="#6b7280"
                tickFormatter={(v) => `$${formatInteger(v)}`}
              />
              <YAxis
                type="category"
                dataKey="keyword"
                stroke="#6b7280"
                width={150}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value) => [`$${formatInteger(value)}`, 'Est. monthly value']}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {insights.value_drivers.slice(0, 10).map((kw, idx) => (
                  <Cell key={idx} fill={kw.theme.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartWrapper>
        </div>
      </div>

      {/* ---- Connect the dots: cross-link to GA4 pages -------------------- */}
      <h2 className="section-header">
        Connecting the <em>dots</em>
        <span className="section-header__hint">
          <LuSearch size={14} aria-hidden="true" /> keywords ↔ landing pages
        </span>
      </h2>
      <p className="section-subhead">
        Every tracked keyword matched against your GA4 page list. If a keyword ranks well
        but its matching page bleeds visitors, that is a high-leverage SEO fix — search
        is doing the work, but the page wastes the click.
      </p>

      {cross.page_matches.length === 0 ? (
        <div className="card kw-cross-empty">
          <p>
            No GA4 landing pages matched the keyword list. Upload a workbook with a Page Path
            sheet to enable this analysis.
          </p>
          <Link to="/upload" className="kw-link-cta">
            Upload data <LuArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <DataTable
          columns={matchColumns}
          rows={cross.page_matches.slice(0, 25)}
          hint={`${cross.page_matches.length} keyword/page connections`}
          defaultSort={{ key: 'sessions', dir: 'desc' }}
          exportFileStem={`keywords-landing-match-${scope}`}
        />
      )}

      {cross.underperforming.length > 0 && (
        <>
          <h3 className="section-header section-header--inset">
            Pages that <em>rank but bleed</em>
          </h3>
          <p className="section-subhead">
            Landing pages tied to ranked keywords but burning visitors (high bounce or
            low engagement). These are the SEO fixes with the fastest payoff.
          </p>
          <ul className="kw-bleed-list">
            {cross.underperforming.slice(0, 6).map((row, idx) => (
              <li key={`${row.path}-${idx}`} className="kw-bleed-item">
                <div className="kw-bleed-item__head">
                  <code className="kw-page-path">{row.path}</code>
                  <span className="kw-bleed-item__badge">{row.reason}</span>
                </div>
                <p className="kw-bleed-item__meta">
                  <strong>"{row.keyword}"</strong> · ranks {fmtPos(row.latest_position)} ·{' '}
                  {formatInteger(row.sessions)} sessions · theme {row.theme}
                </p>
              </li>
            ))}
          </ul>
          <div className="kw-bleed-cta">
            <Link to="/seo-aeo" className="kw-link-cta">
              Open SEO / AEO Crawl <LuSparkles size={14} aria-hidden="true" />
            </Link>
            <Link to="/pages" className="kw-link-cta">
              Open Page Path Analysis <LuArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <Link to="/bounce" className="kw-link-cta kw-link-cta--ghost">
              Open Bounce Rate <LuArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </>
      )}

      {cross.organic && cross.organic.sources.length > 0 && (
        <>
          <h3 className="section-header section-header--inset">
            Organic <em>traffic check</em>
          </h3>
          <p className="section-subhead">
            What organic search delivered in your GA4 file vs what the rankings suggest you
            should be earning. A wide gap usually means either tracking issues or the rank
            improvements haven't landed yet.
          </p>
          <div className="card-grid card-grid--cols-3">
            <KpiCard
              label="Organic sessions"
              value={formatInteger(cross.organic.sessions)}
              sub={`across ${cross.organic.sources.length} matched source${cross.organic.sources.length === 1 ? '' : 's'}`}
              accent="green"
            />
            <KpiCard
              label="Org. engagement rate"
              value={formatPercent(cross.organic.engagement_rate, 1)}
              sub="engaged ÷ total sessions"
            />
            <KpiCard
              label="Modeled monthly clicks"
              value={formatInteger(latestSummary?.est_monthly_clicks || 0)}
              sub="From CTR × position × volume"
              accent="purple"
            />
          </div>
        </>
      )}
    </>
  );
}
