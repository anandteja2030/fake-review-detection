import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Sidebar, { NAV_ITEMS } from './components/layout/Sidebar.jsx';
import Topbar from './components/layout/Topbar.jsx';
import { useTheme, useModelStatus } from './hooks/useModels.js';
import Dashboard from './pages/Dashboard.jsx';
import Analyzer from './pages/Analyzer.jsx';
import Analytics from './pages/Analytics.jsx';
import ExplainableAI from './pages/ExplainableAI.jsx';
import ModelPerformance from './pages/ModelPerformance.jsx';
import History from './pages/History.jsx';
import Research from './pages/Research.jsx';

export default function App() {
  const { theme, toggle } = useTheme();
  const { status } = useModelStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const current = NAV_ITEMS.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));

  return (
    <div className="app-shell">
      <div className="atmosphere-grid" aria-hidden="true" />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} modelStatus={status} />
      <div className="main-area">
        <Topbar title={current?.label || 'Explainable Fake Review Detection'} onMenu={() => setMenuOpen(true)} theme={theme} onToggleTheme={toggle} />
        {/* keyed by path so each route plays the entrance transition once */}
        <div className="route-stage" key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<Dashboard modelStatus={status} />} />
            <Route path="/analyzer" element={<Analyzer modelStatus={status} />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/explainability" element={<ExplainableAI />} />
            <Route path="/model-performance" element={<ModelPerformance />} />
            <Route path="/history" element={<History />} />
            <Route path="/research" element={<Research />} />
            <Route path="*" element={<Dashboard modelStatus={status} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
