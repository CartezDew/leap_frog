// Top-10 dynamic insights table for the Overview page.
//
// Renders the output of `buildTopInsights(analyzed)` as a numbered,
// priority-tagged table (matching the layout the client mocked up).
// Categories: Critical / Fix / Scale / Filter / Investigate / Understand /
// Leverage / Watch — each maps to a colour-coded pill via CATEGORY_META.
//
// Rows whose insight ships with a `playbook` (currently the Critical and Fix
// signals) get a chevron toggle that reveals a detail row with:
//   - "What this means" — plain-English explanation
//   - "How to fix it" — ordered, concrete steps
//   - Optional "Where to look" — link to the relevant dashboard tab

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuChevronDown, LuArrowRight, LuArrowUp, LuArrowDown } from 'react-icons/lu';

import { CATEGORY_META } from '../../lib/insightEngine.js';
import { downloadSheetAsXlsx, downloadTableAsPdf } from '../../lib/tableExport.js';
import { VizExportToolbar } from '../VizExportToolbar/VizExportToolbar.jsx';

function categoryFor(insight) {
  const cat = String(insight.category || '').toLowerCase();
  if (CATEGORY_META[cat]) return { key: cat, ...CATEGORY_META[cat] };
  // Fallback for legacy `priority`-only insights from older payloads.
  if (insight.priority === 'high') return { key: 'critical', ...CATEGORY_META.critical };
  if (insight.priority === 'medium') return { key: 'investigate', ...CATEGORY_META.investigate };
  return { key: 'understand', ...CATEGORY_META.understand };
}

/** Lower = sort first when ascending (urgency / action). */
const PRIORITY_SORT_ORDER = {
  critical: 0,
  fix: 1,
  scale: 2,
  investigate: 3,
  filter: 4,
  understand: 5,
  leverage: 6,
  watch: 7,
};

function prioritySortRank(insight) {
  const { key } = categoryFor(insight);
  return key in PRIORITY_SORT_ORDER ? PRIORITY_SORT_ORDER[key] : 99;
}

/** Largest numeric token in evidence (handles "10,327 sessions", "63.7%"). */
function evidenceNumericHint(text) {
  const matches = String(text).match(/[\d,]+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  let best = -Infinity;
  for (const m of matches) {
    const n = Number(m.replace(/,/g, ''));
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best === -Infinity ? null : best;
}

function compareEvidence(a, b) {
  const na = evidenceNumericHint(a.insight.evidence);
  const nb = evidenceNumericHint(b.insight.evidence);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;
  return a.insight.evidence.localeCompare(b.insight.evidence, undefined, {
    sensitivity: 'base',
  });
}

function sortRows(decorated, sortKey, sortDir) {
  if (!sortKey) return decorated;
  const dir = sortDir === 'asc' ? 1 : -1;
  const copy = [...decorated];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'rank':
        cmp = a.originalRank - b.originalRank;
        break;
      case 'finding':
        cmp = a.insight.title.localeCompare(b.insight.title, undefined, {
          sensitivity: 'base',
        });
        break;
      case 'evidence':
        cmp = compareEvidence(a, b);
        break;
      case 'priority':
        cmp = prioritySortRank(a.insight) - prioritySortRank(b.insight);
        break;
      default:
        return 0;
    }
    cmp *= dir;
    if (cmp !== 0) return cmp;
    return a.originalRank - b.originalRank;
  });
  return copy;
}

function PlaybookDetail({ playbook }) {
  if (!playbook) return null;
  const { meaning, actions = [], where_to_look: where } = playbook;
  return (
    <div className="insight-playbook">
      {meaning && (
        <div className="insight-playbook__block">
          <h4 className="insight-playbook__heading">What this means</h4>
          <p className="insight-playbook__text">{meaning}</p>
        </div>
      )}
      {actions.length > 0 && (
        <div className="insight-playbook__block">
          <h4 className="insight-playbook__heading">How to fix it</h4>
          <ol className="insight-playbook__steps">
            {actions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {where?.route && where?.label && (
        <Link className="insight-playbook__link" to={where.route}>
          Open {where.label} <LuArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

const SORT_COLUMNS = ['rank', 'finding', 'evidence', 'priority'];

export function TopInsightsTable({ insights }) {
  const rows = Array.isArray(insights) ? insights : [];
  const [expanded, setExpanded] = useState(() => new Set());
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const decoratedRows = useMemo(
    () => rows.map((insight, i) => ({ insight, originalRank: i + 1 })),
    [rows],
  );

  const sortedRows = useMemo(
    () => sortRows(decoratedRows, sortKey, sortDir),
    [decoratedRows, sortKey, sortDir],
  );

  const exportInsightMatrix = useMemo(() => {
    const headers = ['#', 'Insight finding', 'Evidence / data', 'Priority'];
    const body = sortedRows.map(({ insight: ins, originalRank }) => {
      const cat = categoryFor(ins);
      return [originalRank, ins.title, ins.evidence, cat.label];
    });
    return { headers, body };
  }, [sortedRows]);

  function onHeaderSort(column) {
    if (!SORT_COLUMNS.includes(column)) return;
    if (sortKey === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column);
      setSortDir('asc');
    }
  }

  function headerAriaSort(column) {
    if (sortKey !== column) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  if (rows.length === 0) {
    return (
      <p className="muted">
        Not enough data in the current upload to generate insights yet.
      </p>
    );
  }

  function toggle(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="card top-insights-card">
      <div className="table-scroll">
        <table className="top-insights">
          <thead>
            <tr>
              <th scope="col" className="top-insights__rank" aria-sort={headerAriaSort('rank')}>
                <button
                  type="button"
                  className="top-insights__th-sort"
                  aria-label="Sort by engine rank"
                  onClick={() => onHeaderSort('rank')}
                >
                  <span>#</span>
                  {sortKey === 'rank' ? (
                    sortDir === 'asc' ? (
                      <LuArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <LuArrowDown size={14} aria-hidden="true" />
                    )
                  ) : (
                    <span className="top-insights__th-sort-placeholder" aria-hidden="true" />
                  )}
                </button>
              </th>
              <th scope="col" className="top-insights__finding" aria-sort={headerAriaSort('finding')}>
                <button
                  type="button"
                  className="top-insights__th-sort"
                  aria-label="Sort by insight finding"
                  onClick={() => onHeaderSort('finding')}
                >
                  <span>Insight finding</span>
                  {sortKey === 'finding' ? (
                    sortDir === 'asc' ? (
                      <LuArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <LuArrowDown size={14} aria-hidden="true" />
                    )
                  ) : (
                    <span className="top-insights__th-sort-placeholder" aria-hidden="true" />
                  )}
                </button>
              </th>
              <th scope="col" className="top-insights__evidence" aria-sort={headerAriaSort('evidence')}>
                <button
                  type="button"
                  className="top-insights__th-sort"
                  aria-label="Sort by evidence"
                  onClick={() => onHeaderSort('evidence')}
                >
                  <span>Evidence / data</span>
                  {sortKey === 'evidence' ? (
                    sortDir === 'asc' ? (
                      <LuArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <LuArrowDown size={14} aria-hidden="true" />
                    )
                  ) : (
                    <span className="top-insights__th-sort-placeholder" aria-hidden="true" />
                  )}
                </button>
              </th>
              <th scope="col" className="top-insights__priority" aria-sort={headerAriaSort('priority')}>
                <button
                  type="button"
                  className="top-insights__th-sort top-insights__th-sort--center"
                  aria-label="Sort by priority"
                  onClick={() => onHeaderSort('priority')}
                >
                  <span>Priority</span>
                  {sortKey === 'priority' ? (
                    sortDir === 'asc' ? (
                      <LuArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <LuArrowDown size={14} aria-hidden="true" />
                    )
                  ) : (
                    <span className="top-insights__th-sort-placeholder" aria-hidden="true" />
                  )}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.flatMap(({ insight: ins, originalRank }) => {
              const cat = categoryFor(ins);
              const key = ins.id || `idx-${originalRank - 1}`;
              const hasPlaybook = Boolean(ins.playbook);
              const isOpen = expanded.has(key);
              const rowClass = [
                hasPlaybook ? 'top-insights__row--has-playbook' : '',
                isOpen ? 'is-open' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const elements = [
                <tr
                  key={key}
                  className={rowClass}
                  onClick={hasPlaybook ? () => toggle(key) : undefined}
                >
                  <td className="top-insights__rank">{originalRank}</td>
                  <td className="top-insights__finding">
                    <span className="top-insights__title-text">{ins.title}</span>
                    {hasPlaybook && (
                      <button
                        type="button"
                        className={`top-insights__expand${isOpen ? ' is-open' : ''}`}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        aria-expanded={isOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(key);
                        }}
                      >
                        <LuChevronDown size={16} />
                        <span className="top-insights__expand-label">
                          {isOpen ? 'Hide details' : 'How to fix'}
                        </span>
                      </button>
                    )}
                  </td>
                  <td className="top-insights__evidence">{ins.evidence}</td>
                  <td className="top-insights__priority">
                    <span
                      className={`top-insights__pill top-insights__pill--${cat.tone}`}
                      title={`Action: ${cat.label}`}
                    >
                      <span className="top-insights__dot" aria-hidden="true" />
                      {cat.label}
                    </span>
                  </td>
                </tr>,
              ];
              if (hasPlaybook && isOpen) {
                elements.push(
                  <tr key={`${key}-detail`} className="top-insights__detail-row">
                    <td />
                    <td colSpan={3}>
                      <PlaybookDetail playbook={ins.playbook} />
                    </td>
                  </tr>,
                );
              }
              return elements;
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 5 && (
        <div className="table-export-dock">
          <span className="table-export-dock__label">Download table</span>
          <VizExportToolbar
            className="viz-export-toolbar--dock"
            onXlsx={() => {
              if (rows.length <= 5) return;
              const { headers, body } = exportInsightMatrix;
              downloadSheetAsXlsx('overview-top-insights', 'Insights', headers, body);
            }}
            onPdf={() => {
              if (rows.length <= 5) return;
              const { headers, body } = exportInsightMatrix;
              downloadTableAsPdf('overview-top-insights', headers, body);
            }}
          />
        </div>
      )}
    </div>
  );
}
