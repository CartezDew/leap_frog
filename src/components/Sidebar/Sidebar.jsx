import { NavLink } from 'react-router-dom';
import {
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

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__brand">
        <img
          src={mainLogo}
          alt="Leapfrog Services"
          className="sidebar__brand-icon"
        />
        <div className="sidebar__brand-text">
          <div className="sidebar__brand-mark">Leapfrog Services</div>
          <h1 className="sidebar__brand-title">
            Analytics <em>Dashboard</em>
          </h1>
          <p className="sidebar__brand-subtitle">GA4 insight engine</p>
        </div>
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__nav-section">Upload</div>
        <NavLink
          to="/upload"
          className={({ isActive }) =>
            `sidebar__nav-link${isActive ? ' is-active' : ''}`
          }
        >
          <span className="sidebar__nav-icon">
            <LuUpload size={18} />
          </span>
          {hasData ? 'Upload / Replace Data' : 'Upload Data'}
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
              tabIndex={enabled ? 0 : -1}
            >
              <span className="sidebar__nav-icon">
                <Icon size={18} />
              </span>
              {item.label}
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
