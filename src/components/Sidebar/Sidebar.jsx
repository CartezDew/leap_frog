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
} from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';
import mainLogo from '../../images/Main_Logo.webp';

const NAV_ITEMS = [
  { to: '/', label: 'Executive Summary', icon: LuLayoutDashboard, requires: 'summary' },
  { to: '/insights', label: 'Actionable Insights', icon: LuLightbulb, requires: 'insights' },
  { to: '/bounce', label: 'Bounce Rate', icon: LuTrendingDown, requires: 'bounce' },
  { to: '/users', label: 'User ID Engagement', icon: LuUsers, requires: 'users' },
  { to: '/sources', label: 'Traffic Sources', icon: LuRadio, requires: 'sources' },
  { to: '/pages', label: 'Page Path Analysis', icon: LuFileText, requires: 'pages' },
  { to: '/unicorns', label: 'Unicorn Pages', icon: LuSparkles, requires: 'unicorns' },
  { to: '/contact', label: 'Contact Form Intel', icon: LuMail, requires: 'contacts' },
  { to: '/bots', label: 'Bot Traffic Intelligence', icon: LuShieldAlert, requires: 'bots' },
];

const COLLAPSED_STORAGE_KEY = 'lf:sidebar-collapsed';

function sectionHasData(analyzed, key) {
  if (!analyzed) return false;
  switch (key) {
    case 'summary':
      return Boolean(analyzed.summary);
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
      return Boolean(analyzed.bots);
    default:
      return true;
  }
}

export function Sidebar() {
  const { analyzed, hasData, filename, fileCount, uploadedAt, clear } = useData();

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
      <div className="sidebar__brand">
        <div className="sidebar__brand-main">
          <div className="sidebar__brand-mark">
            <img
              src={mainLogo}
              alt="Leapfrog"
              className="sidebar__brand-icon"
            />
          </div>
          <div className="sidebar__brand-text">
            <h1 className="sidebar__brand-title">
              Analytics <em>Dashboard</em>
            </h1>
          </div>
        </div>
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
        <p className="sidebar__brand-mini-title" aria-hidden="true">
          Analytics
          <em>Dashboard</em>
        </p>
      </div>

      <nav className="sidebar__nav">
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

        <div className="sidebar__nav-section">Analysis</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const enabled = hasData && sectionHasData(analyzed, item.requires);
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
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar__nav-icon">
                <Icon size={18} />
              </span>
              <span className="sidebar__nav-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        {hasData ? (
          <>
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
          <p>Upload an Excel export to populate the dashboard.</p>
        )}
      </div>
    </aside>
  );
}
