import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LuChevronLeft,
  LuChevronRight,
  LuLayoutDashboard,
  LuLightbulb,
  LuTrendingDown,
  LuUsers,
  LuRadio,
  LuFileText,
  LuSparkles,
  LuMail,
  LuShieldAlert,
  LuUpload,
  LuSearch,
  LuBot,
} from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';

// Each nav item declares which report family powers it:
//   needs: 'ga4'    → only enabled when a GA4 Excel workbook is uploaded
//   needs: 'semrush'→ only enabled when a Semrush PDF is uploaded
//   needs: 'either' → enabled when either report type is uploaded
const NAV_ITEMS = [
  { to: '/overview',  label: 'Overview',                 icon: LuLayoutDashboard, requires: 'summary',  needs: 'either'  },
  { to: '/insights',  label: 'Actionable Insights',      icon: LuLightbulb,       requires: 'insights', needs: 'ga4'     },
  { to: '/keywords',  label: 'Keywords (Semrush)',       icon: LuSearch,          requires: 'keywords', needs: 'semrush' },
  { to: '/seo-aeo',   label: 'SEO / AEO Crawl',          icon: LuBot,             requires: 'seoAeo',   needs: 'semrush' },
  { to: '/bounce',    label: 'Bounce Rate',              icon: LuTrendingDown,    requires: 'bounce',   needs: 'ga4'     },
  { to: '/users',     label: 'User ID Engagement',       icon: LuUsers,           requires: 'users',    needs: 'ga4'     },
  { to: '/sources',   label: 'Traffic Sources',          icon: LuRadio,           requires: 'sources',  needs: 'ga4'     },
  { to: '/pages',     label: 'Page Path Analysis',       icon: LuFileText,        requires: 'pages',    needs: 'ga4'     },
  { to: '/unicorns',  label: 'Unicorn Pages',            icon: LuSparkles,        requires: 'unicorns', needs: 'ga4'     },
  { to: '/contact',   label: 'Contact Form Intel',       icon: LuMail,            requires: 'contacts', needs: 'ga4'     },
  { to: '/bots',      label: 'Bot Traffic Intelligence', icon: LuShieldAlert,     requires: 'bots',     needs: 'ga4'     },
];

const COLLAPSED_STORAGE_KEY = 'lf:sidebar-collapsed';

// Has the right *kind* of report been uploaded for this nav item?
function meetsTypePrereq(needs, hasGA4, hasSemrush) {
  if (needs === 'ga4') return hasGA4;
  if (needs === 'semrush') return hasSemrush;
  if (needs === 'either') return hasGA4 || hasSemrush;
  return false;
}

// Even when the right file type is uploaded, we still require the analyzer
// to have produced the section's data before lighting up the link.
// `summary` and `keywords` are special: their type prereq is the only gate
// that matters — uploading the right file is enough to unlock the page.
function sectionHasData(analyzed, key) {
  if (!analyzed) return false;
  switch (key) {
    case 'summary':
      return true;
    case 'insights':
      return Array.isArray(analyzed.insights) && analyzed.insights.length > 0;
    case 'bounce':
      return Boolean(analyzed.bounce);
    case 'users':
      return Array.isArray(analyzed.users) && analyzed.users.length > 0;
    case 'sources':
      return Array.isArray(analyzed.sources) && analyzed.sources.length > 0;
    case 'pages':
      return Boolean(analyzed.pages?.top_pages?.length);
    case 'unicorns':
      return Array.isArray(analyzed.unicorns);
    case 'contacts':
      return Array.isArray(analyzed.contacts);
    case 'bots':
      return Boolean(
        analyzed.bots?.cities?.length || analyzed.bots?.sources?.length,
      );
    case 'keywords':
      return true;
    case 'seoAeo':
      return true;
    default:
      return true;
  }
}

export function Sidebar() {
  const {
    analyzed,
    hasData,
    hasGA4,
    hasSemrush,
    filename,
    fileCount,
    uploadedAt,
    isSyntheticData,
    clear,
  } = useData();

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Sync the collapsed state to a root data attribute so global CSS (e.g. the
  // main content margin) can react via the --sidebar-width custom property.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.sidebarCollapsed = collapsed ? 'true' : 'false';
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // ignore storage failures
    }
  }, [collapsed]);

  const uploadLabel = hasData ? 'Upload / Replace Data' : 'Upload Data';

  return (
    <aside
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}
      aria-label="Primary navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="sidebar__top">
        <div className="sidebar__brand">
          <div className="sidebar__brand-meta">
            <p className="sidebar__brand-eyebrow">Insight Engine Reports</p>
            <div
              className="sidebar__brand-sources"
              aria-label="Report file types: GA4 and Semrush"
            >
              <span className="sidebar__brand-pill sidebar__brand-pill--ga4">
                GA4 Report
              </span>
              <span className="sidebar__brand-pill sidebar__brand-pill--semrush">
                Semrush Report
              </span>
            </div>
          </div>
        </div>

        <div className="sidebar__divider" aria-hidden="true" />

        <nav className="sidebar__nav">
          <div className="sidebar__nav-static">
            <div className="sidebar__nav-header">
              <div className="sidebar__nav-section">Upload</div>
              <button
                type="button"
                className="sidebar__toggle"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? (
                  <LuChevronRight size={14} />
                ) : (
                  <LuChevronLeft size={14} />
                )}
              </button>
            </div>
            <NavLink
              to="/upload"
              className={({ isActive }) =>
                `sidebar__nav-link${isActive ? ' is-active' : ''}`
              }
              title={collapsed ? uploadLabel : undefined}
              aria-label={uploadLabel}
            >
              <span className="sidebar__nav-icon">
                <LuUpload size={18} />
              </span>
              <span className="sidebar__nav-label">{uploadLabel}</span>
            </NavLink>
          </div>

          <div
            className="sidebar__nav-scroll"
            role="region"
            aria-label="Analysis reports"
          >
            <div className="sidebar__nav-section">Analysis</div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const typeOk = meetsTypePrereq(item.needs, hasGA4, hasSemrush);
              const enabled =
                hasData && typeOk && sectionHasData(analyzed, item.requires);

              // Tooltip explains *why* an item is greyed out so users know
              // which report to upload to unlock it.
              let tooltip;
              if (enabled) {
                tooltip = collapsed ? item.label : undefined;
              } else if (!typeOk && item.needs === 'ga4') {
                tooltip = `${item.label} — upload a GA4 Excel report to enable.`;
              } else if (!typeOk && item.needs === 'semrush') {
                tooltip = `${item.label} — upload a Semrush PDF to enable.`;
              } else if (!typeOk) {
                tooltip = `${item.label} — upload a GA4 Excel or Semrush PDF to enable.`;
              } else {
                tooltip = `${item.label} — uploaded data didn't include the required section.`;
              }

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `sidebar__nav-link${isActive ? ' is-active' : ''}${
                      enabled ? '' : ' is-disabled'
                    }`
                  }
                  aria-disabled={!enabled}
                  aria-label={item.label}
                  tabIndex={enabled ? 0 : -1}
                  title={tooltip}
                >
                  <span className="sidebar__nav-icon">
                    <Icon size={18} />
                  </span>
                  <span className="sidebar__nav-label">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="sidebar__footer">
        {hasData ? (
          <>
            {isSyntheticData && (
              <div className="sidebar__synthetic-flag">
                <span>Test mode</span>
                Synthetic workbook active
              </div>
            )}
            <p className="sidebar__file" title={uploadedAt || ''}>
              {fileCount > 1
                ? `${fileCount} workbooks merged`
                : filename || 'Workbook loaded'}
            </p>
            <button type="button" className="sidebar__clear-btn" onClick={clear}>
              Clear Data &amp; Re-upload
            </button>
          </>
        ) : (
          <p>Upload a GA4 Excel export and/or a Semrush PDF to populate the dashboard.</p>
        )}
      </div>
    </aside>
  );
}
