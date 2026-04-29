// Keywords intelligence page.
//
// Built from Semrush "Organic Performance" PDFs the user uploads through
// the standard upload flow. Reads the parsed snapshots via
// `runKeywordAnalysis(analyzed)` (which now consumes
// `analyzed.semrush_keywords` rather than a static module) and renders:
//
//   - Empty state when no Semrush PDFs have been uploaded yet
//   - Story cards: at-a-glance "what is the SEO surface telling us"
//   - SERP page mix donut + monthly average position trend
//   - Theme heatmap (Talkwalker-style topic clustering, gated to 4+ months)
//   - Top movers / decliners — momentum like a social listening platform
//   - Quick-wins matrix (volume × current rank)
//   - Estimated traffic value bar
//   - Cross-link panel: which GA4 landing pages match each keyword theme
//   - Underperformers panel: pages that rank but bleed visitors

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
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
} from 'react-icons/lu';

import { PageHeader } from '../../components/PageHeader/PageHeader.jsx';
import { ChartWrapper } from '../../components/ChartWrapper/ChartWrapper.jsx';
import { StoryCards } from '../../components/StoryCards/StoryCards.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { KpiCard } from '../../components/KpiCard/KpiCard.jsx';
import { useData } from '../../context/DataContext.jsx';
import { runKeywordAnalysis } from '../../lib/keywordAnalyzer.js';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

import './Keywords.css';

const SCOPE_OPTIONS = [
  { id: 'national', label: 'National' },
  { id: 'local', label: 'Local' },
];

const SERP_BUCKET_COLORS = {
  'Top 3': '#16a34a',
  'Page 1': '#9aca3c',
  'Page 2': '#d97706',
  'Pages 3–5': '#dc2626',
  'Pages 6+': '#7c2d12',
  'Unranked': '#9ca3af',
};

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

function HeatCell({ avgPosition }) {
  if (avgPosition == null) {
    return <td className="kw-heat__cell kw-heat__cell--empty">—</td>;
  }
  let bg = 'rgba(22, 163, 74, 0.85)'; // green
  if (avgPosition > 50) bg = 'rgba(124, 45, 18, 0.85)';
  else if (avgPosition > 20) bg = 'rgba(220, 38, 38, 0.8)';
  else if (avgPosition > 10) bg = 'rgba(217, 119, 6, 0.8)';
  else if (avgPosition > 3) bg = 'rgba(154, 202, 60, 0.85)';
  return (
    <td
      className="kw-heat__cell"
      style={{ background: bg, color: 'white' }}
      title={`Avg position ${avgPosition.toFixed(1)}`}
    >
      {avgPosition.toFixed(0)}
    </td>
  );
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
  const { analyzed } = useData();
  const [scope, setScope] = useState('national');

  const data = useMemo(() => runKeywordAnalysis(analyzed), [analyzed]);

  // Always recompute month matrix derived state (must run before any early
  // return per the rules of hooks).
  const themeMatrix = useMemo(() => {
    const themesList = Array.from(
      new Map(
        (data.timeline || [])
          .filter((t) => t.scope === scope)
          .map((t) => [t.theme.key, t.theme]),
      ).values(),
    );
    const months = (data.monthly || []).map((m) => ({
      key: m.month,
      label: m.label,
    }));
    const matrix = themesList.map((theme) => {
      const row = months.map((mo) => {
        const positions = data.timeline
          .filter(
            (t) =>
              t.scope === scope && t.theme.key === theme.key,
          )
          .map((t) => {
            const snap = t.history.find((h) => h.month === mo.key);
            return snap?.position ?? null;
          })
          .filter((p) => p != null);
        const avg =
          positions.length > 0
            ? positions.reduce((a, p) => a + p, 0) / positions.length
            : null;
        return { month: mo.key, label: mo.label, avg };
      });
      return { theme, cells: row };
    });
    matrix.sort((a, b) => {
      const pa = a.cells[a.cells.length - 1]?.avg ?? 999;
      const pb = b.cells[b.cells.length - 1]?.avg ?? 999;
      return pa - pb;
    });
    return { months, matrix };
  }, [data.timeline, data.monthly, scope]);

  // Empty state — no Semrush PDFs uploaded.
  if (data.empty) {
    return <KeywordsEmptyState />;
  }

  // Recompute scope-dependent slices on the fly so the user can flip
  // National ↔ Local without throwing away anything else.
  const trend = data.trend[scope] || [];
  const themes = data.themes[scope] || []; // eslint-disable-line no-unused-vars
  const insights = data.insights;
  const serpMix = data.serp_mix;
  const intents = data.intents;
  const cross = data.cross;

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

  // ---- Quick-wins scatter data ----
  const scatterData = insights.quick_wins.slice(0, 25).map((kw) => ({
    x: kw.latest.position,
    y: kw.latest.volume || 0,
    z: 12,
    keyword: kw.keyword,
    theme: kw.theme.label,
    color: kw.theme.color,
  }));

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
    },
    {
      key: 'latest_position',
      header: 'Now',
      align: 'right',
      render: (row) => <PositionPill position={row.latest.position} />,
      sortValue: (row) => row.latest.position ?? 999,
    },
    {
      key: 'prev_position',
      header: 'Prev',
      align: 'right',
      render: (row) => <PositionPill position={row.prev_position} />,
      sortValue: (row) => row.prev_position ?? 999,
    },
    {
      key: 'volume',
      header: 'Volume',
      align: 'right',
      render: (row) => formatInteger(row.latest.volume) || '—',
      sortValue: (row) => row.latest.volume ?? 0,
    },
    {
      key: 'est_value',
      header: 'Est. value',
      align: 'right',
      render: (row) =>
        row.est_value > 0 ? `$${formatInteger(row.est_value)}` : '—',
      sortValue: (row) => row.est_value || 0,
    },
  ];

  // ---- Quick wins table rows ----
  const quickWinsColumns = [
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
    },
    {
      key: 'now',
      header: 'Current',
      align: 'right',
      render: (row) => <PositionPill position={row.latest.position} />,
      sortValue: (row) => row.latest.position ?? 999,
    },
    {
      key: 'volume',
      header: 'Monthly volume',
      align: 'right',
      render: (row) => formatInteger(row.latest.volume) || '—',
      sortValue: (row) => row.latest.volume ?? 0,
    },
    {
      key: 'cpc',
      header: 'CPC',
      align: 'right',
      render: (row) =>
        row.latest.cpc ? `$${row.latest.cpc.toFixed(2)}` : '—',
      sortValue: (row) => row.latest.cpc ?? 0,
    },
    {
      key: 'win_score',
      header: 'Win score',
      align: 'right',
      render: (row) => formatInteger(Math.round(row.win_score)),
      sortValue: (row) => row.win_score || 0,
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
    },
    {
      key: 'latest_position',
      header: 'Rank',
      align: 'right',
      render: (row) => <PositionPill position={row.latest_position} />,
      sortValue: (row) => row.latest_position ?? 999,
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
    },
    {
      key: 'sessions',
      header: 'Page sessions',
      align: 'right',
      render: (row) => formatInteger(row.pages[0]?.sessions || 0),
      sortValue: (row) => row.pages[0]?.sessions ?? 0,
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
    },
  ];

  // ---- Render ----
  return (
    <>
      <PageHeader
        badge="Semrush · Organic Performance"
        badgeVariant="purple"
        title="Keywords Intelligence"
        subtitle={`Topic clustering, momentum, and SERP movement for ${data.domain} — tied back to the GA4 landing pages those rankings drive traffic to.`}
        meta={
          <div className="page-meta__stamp">
            Source
            <strong>{data.source}</strong>
          </div>
        }
        actions={
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

      {/* ---- SERP mix donut + monthly trend ------------------------------- */}
      <div className="card-grid card-grid--cols-2 kw-grid-stretch">
        <div className="kw-cell">
          <h2 className="section-header">SERP <em>page mix</em></h2>
          <p className="section-subhead">
            Where each tracked keyword sits this month. Page 1 = clicks; Page 2+ = invisible
            in practice. Aim to push Page-2 keywords into the green ring.
          </p>
          <ChartWrapper height={300}>
            <PieChart>
              <Pie
                data={serpMix}
                dataKey="count"
                nameKey="bucket"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={2}
              >
                {serpMix.map((entry) => (
                  <Cell
                    key={entry.bucket}
                    fill={SERP_BUCKET_COLORS[entry.bucket] || '#9ca3af'}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name, ctx) => [
                  `${value} keywords (${formatPercent(ctx.payload.share, 0)})`,
                  name,
                ]}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
                formatter={(value, entry) => {
                  const pct = entry?.payload?.share ?? 0;
                  return `${value} · ${formatPercent(pct, 0)}`;
                }}
              />
            </PieChart>
          </ChartWrapper>
        </div>

        <div className="kw-cell">
          <h2 className="section-header">Average position <em>over time</em></h2>
          <p className="section-subhead">
            Lower = better. A flat or rising line means SEO investment is converting
            into rank lift; a downward line means competitors are moving faster.
          </p>
          <ChartWrapper height={300}>
            <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#6b7280" />
              <YAxis
                yAxisId="pos"
                stroke="#522e91"
                reversed
                domain={[1, 'auto']}
                allowDecimals
                tickFormatter={(v) => `#${Math.round(v)}`}
              />
              <YAxis
                yAxisId="page1"
                orientation="right"
                stroke="#16a34a"
                allowDecimals={false}
                tickFormatter={(v) => formatInteger(v)}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === 'Avg position'
                    ? [`#${(value || 0).toFixed(1)}`, name]
                    : [formatInteger(value), name]
                }
              />
              <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
              <Line
                yAxisId="pos"
                type="monotone"
                dataKey="avg_position"
                name="Avg position"
                stroke="#522e91"
                strokeWidth={3}
                dot={{ r: 5, fill: '#522e91' }}
                activeDot={{ r: 7 }}
              />
              <Line
                yAxisId="page1"
                type="monotone"
                dataKey="top10"
                name="Page-1 keywords"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ChartWrapper>
        </div>
      </div>

      {/* ---- Theme heatmap (only meaningful with 4+ snapshots) ------------ */}
      {themeMatrix.months.length > 3 && (
        <>
          <h2 className="section-header">
            Theme <em>heatmap</em>
            <span className="section-header__hint">
              <LuSparkles size={14} aria-hidden="true" /> Talkwalker-style topic clustering
            </span>
          </h2>
          <p className="section-subhead">
            Each row is a topic cluster (computed from keyword text); each cell is the
            average rank for that cluster in that month. Greener = closer to #1.
            Showing {themeMatrix.months.length} months of Semrush snapshots.
          </p>
          <div className="card kw-heat-card">
            <div className="table-scroll">
              <table className="kw-heat">
                <thead>
                  <tr>
                    <th scope="col" className="kw-heat__theme-col">Theme</th>
                    {themeMatrix.months.map((m) => (
                      <th key={m.key} scope="col">{m.label}</th>
                    ))}
                    <th scope="col">Latest #</th>
                  </tr>
                </thead>
                <tbody>
                  {themeMatrix.matrix.map((row) => {
                    const latest = row.cells[row.cells.length - 1]?.avg ?? null;
                    return (
                      <tr key={row.theme.key}>
                        <th scope="row" className="kw-heat__theme-col">
                          <span className="kw-heat__theme-cell">
                            <span
                              className="kw-heat__swatch"
                              style={{ background: row.theme.color }}
                              aria-hidden="true"
                            />
                            {row.theme.label}
                          </span>
                        </th>
                        {row.cells.map((cell) => (
                          <HeatCell key={cell.month} avgPosition={cell.avg} />
                        ))}
                        <td className="kw-heat__latest">
                          {latest != null ? `#${latest.toFixed(0)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---- Intent buckets (Talkwalker-style) ---------------------------- */}
      <h2 className="section-header">
        Buyer <em>intent mix</em>
        <span className="section-header__hint">
          <LuGoal size={14} aria-hidden="true" /> what searchers actually want
        </span>
      </h2>
      <p className="section-subhead">
        Each tracked keyword bucketed by funnel intent. Investment should follow demand —
        if "Service Intent" dominates volume, the homepage and city service pages should be
        the highest-priority SEO assets.
      </p>
      <div className="kw-intent-grid">
        {intents.map((intent) => (
          <article key={intent.key} className={`kw-intent kw-intent--${intent.tone}`}>
            <header className="kw-intent__head">
              <p className="kw-intent__label">{intent.label}</p>
              <span className="kw-intent__count">{intent.keywords}</span>
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

      {/* ---- Movers / decliners side by side ------------------------------ */}
      <div className="card-grid card-grid--cols-2">
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
            />
          )}
        </div>
      </div>

      {/* ---- Quick wins matrix + scatter ---------------------------------- */}
      <h2 className="section-header">
        Quick-win <em>matrix</em>
        <span className="section-header__hint">
          <LuRocket size={14} aria-hidden="true" /> page 2 → page 1 candidates
        </span>
      </h2>
      <p className="section-subhead">
        Keywords currently ranking #11–20. They already exist in Google's eyes — small
        on-page improvements (better title, internal links, refreshed copy) usually push
        them onto page 1 within a single sprint. Bigger circles = bigger volume.
      </p>
      <div className="card-grid card-grid--cols-2 kw-grid-stretch">
        <div className="kw-cell">
          <ChartWrapper height={320}>
            <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name="Position"
                domain={[10, 22]}
                tickFormatter={(v) => `#${v}`}
                stroke="#6b7280"
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Volume"
                stroke="#6b7280"
                tickFormatter={(v) => formatInteger(v)}
              />
              <ZAxis type="number" dataKey="z" range={[80, 320]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="kw-tooltip">
                      <strong>{p.keyword}</strong>
                      <div className="kw-tooltip__row">
                        <span>Theme</span>
                        <em>{p.theme}</em>
                      </div>
                      <div className="kw-tooltip__row">
                        <span>Position</span>
                        <em>#{p.x}</em>
                      </div>
                      <div className="kw-tooltip__row">
                        <span>Volume</span>
                        <em>{formatInteger(p.y)}</em>
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((d, idx) => (
                  <Cell key={idx} fill={d.color} />
                ))}
              </Scatter>
            </ScatterChart>
          </ChartWrapper>
        </div>
        <div className="kw-cell">
          {insights.quick_wins.length === 0 ? (
            <p className="muted">No keywords in the page-2 sweet spot — try a wider Semrush list.</p>
          ) : (
            <DataTable
              columns={quickWinsColumns}
              rows={insights.quick_wins.slice(0, 10)}
              defaultSort={{ key: 'win_score', dir: 'desc' }}
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
