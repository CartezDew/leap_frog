// Top navigation bar: Overview (or Get Started), Help.
//
// - "Overview" routes to the executive summary view, but only once data has
//   been uploaded. Until then, the same tab control reads "Get Started" and
//   sends users to the upload flow.
// - Below 680px the inline tabs collapse into a hamburger-driven dropdown
//   menu, controlled entirely with state + a media-query-aware stylesheet.
// - Page-level "Growth Lever" insights (warm prospects, channel quality,
//   AI search visibility, refresh candidates, bot impact) are woven into the
//   relevant analysis pages on the sidebar — no separate page needed.

import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LuChevronDown,
  LuMenu,
  LuX,
  LuInfo,
  LuCompass,
  LuRocket,
  LuTriangleAlert,
  LuBookOpen,
} from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';
import mainLogo from '../../images/Main_Logo.webp';

export function Topbar() {
  const { hasData, isSyntheticData } = useData();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
    setHelpOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open && !helpOpen) return undefined;
    function onClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpen(false);
        setHelpOpen(false);
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        setHelpOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, helpOpen]);

  const overview = hasData
    ? { to: '/overview', label: 'Overview', icon: LuCompass }
    : { to: '/upload', label: 'Get Started', icon: LuRocket };

  const items = [
    { ...overview, end: false, isOverview: true },
  ];
  const helpItems = [
    { to: '/about', label: 'About', icon: LuInfo },
    { to: '/how-to-use', label: 'How to Use', icon: LuBookOpen },
  ];
  const helpActive = helpItems.some((item) => item.to === location.pathname);

  return (
    <header className="topbar" aria-label="Primary site navigation">
      <div className="topbar__inner">
        <NavLink
          to="/"
          className="topbar__brand"
          aria-label="Analytics Dashboard home"
        >
          <img src={mainLogo} alt="" className="topbar__logo" />
          <span className="topbar__brand-text">
            Analytics <em>Dashboard</em>
          </span>
        </NavLink>

        {isSyntheticData && (
          <div className="topbar__synthetic-badge" aria-label="Synthetic test data active">
            <LuTriangleAlert size={14} />
            Synthetic test data
          </div>
        )}

        <button
          type="button"
          className="topbar__hamburger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <LuX size={20} /> : <LuMenu size={20} />}
        </button>

        <nav
          ref={navRef}
          id={menuId}
          className={`topbar__nav${open ? ' topbar__nav--open' : ''}`}
          aria-label="Primary"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const isCta = Boolean(item.isOverview && !hasData);
            return (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'topbar__link',
                    isActive ? 'is-active' : '',
                    isCta ? 'topbar__link--cta' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
              >
                <span className="topbar__link-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="topbar__link-label">{item.label}</span>
              </NavLink>
            );
          })}
          <div className={`topbar__dropdown${helpActive ? ' is-active' : ''}${helpOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="topbar__link topbar__dropdown-trigger"
              aria-haspopup="true"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((value) => !value)}
            >
              <span className="topbar__link-icon" aria-hidden="true">
                <LuInfo size={16} />
              </span>
              <span className="topbar__link-label">Help</span>
              <LuChevronDown className="topbar__dropdown-caret" size={14} aria-hidden="true" />
            </button>
            <div className="topbar__dropdown-menu">
              {helpItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    className={({ isActive }) =>
                      [
                        'topbar__dropdown-link',
                        isActive ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                  >
                    <span className="topbar__link-icon" aria-hidden="true">
                      <Icon size={15} />
                    </span>
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
