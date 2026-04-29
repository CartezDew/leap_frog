// Top navigation bar with three primary tabs: About, Overview, Home Page.
//
// - "Overview" routes to the executive summary view, but only once data has
//   been uploaded. Until then, the same tab control reads "Get Started" and
//   sends users to the upload flow.
// - Below 580px the inline tabs collapse into a hamburger-driven dropdown
//   menu, controlled entirely with state + a media-query-aware stylesheet.

import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LuMenu, LuX, LuInfo, LuCompass, LuRocket, LuHouse } from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';
import mainLogo from '../../images/Main_Logo.webp';

export function Topbar() {
  const { hasData } = useData();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const overview = hasData
    ? { to: '/overview', label: 'Overview', icon: LuCompass }
    : { to: '/upload', label: 'Get Started', icon: LuRocket };

  const items = [
    { to: '/', label: 'Home Page', icon: LuHouse, end: true },
    { to: '/about', label: 'About', icon: LuInfo },
    { ...overview, end: false, isOverview: true },
  ];

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
        </nav>
      </div>
    </header>
  );
}
