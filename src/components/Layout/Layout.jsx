import { Outlet } from 'react-router-dom';

import { AIChat } from '../AIChat/AIChat.jsx';
import { Sidebar } from '../Sidebar/Sidebar.jsx';

function AmbientOrbs() {
  return (
    <div className="ambient-orbs" aria-hidden="true">
      <div className="ambient-orb ambient-orb--purple" />
      <div className="ambient-orb ambient-orb--green" />
      <div className="ambient-orb ambient-orb--violet" />
    </div>
  );
}

export function Layout() {
  return (
    <>
      <AmbientOrbs />
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
      <AIChat />
    </>
  );
}
