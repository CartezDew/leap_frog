import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

import { Layout } from './components/Layout/Layout.jsx';
import { useData } from './context/DataContext.jsx';
import { About } from './pages/About.jsx';
import { ActionableInsights } from './pages/ActionableInsights.jsx';
import { BotTraffic } from './pages/BotTraffic.jsx';
import { BounceRate } from './pages/BounceRate.jsx';
import { ContactFormIntel } from './pages/ContactFormIntel.jsx';
import { ExecutiveSummary } from './pages/ExecutiveSummary.jsx';
import { Home } from './pages/Home.jsx';
import { Keywords } from './pages/Keywords/Keywords.jsx';
import { PagePathAnalysis } from './pages/PagePathAnalysis.jsx';
import { TrafficSources } from './pages/TrafficSources.jsx';
import { UnicornPages } from './pages/UnicornPages.jsx';
import { UploadPage } from './pages/UploadPage.jsx';
import { UserEngagement } from './pages/UserEngagement.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function StartRedirect() {
  const { hydrated } = useData();
  if (!hydrated) return null;
  return <Navigate to="/" replace />;
}

function HomeOrUpload() {
  const { hydrated, hasData } = useData();
  if (!hydrated) return null;
  if (!hasData) return <Navigate to="/upload" replace />;
  return <Home />;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeOrUpload />} />
          <Route path="/about" element={<About />} />
          <Route path="/overview" element={<ExecutiveSummary />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/insights" element={<ActionableInsights />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/bounce" element={<BounceRate />} />
          <Route path="/users" element={<UserEngagement />} />
          <Route path="/sources" element={<TrafficSources />} />
          <Route path="/pages" element={<PagePathAnalysis />} />
          <Route path="/unicorns" element={<UnicornPages />} />
          <Route path="/contact" element={<ContactFormIntel />} />
          <Route path="/bots" element={<BotTraffic />} />
          <Route path="*" element={<StartRedirect />} />
        </Route>
      </Routes>
    </>
  );
}
