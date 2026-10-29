import { NavLink } from 'react-router-dom';
import { IconDashboard, IconScan, IconChart, IconBrain, IconShield, IconHistory, IconFlask } from './Icons.jsx';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/analyzer', label: 'Review Analyzer', icon: IconScan },
  { to: '/analytics', label: 'Analytics', icon: IconChart },
  { to: '/explainability', label: 'Explainable AI', icon: IconBrain },
  { to: '/model-performance', label: 'Model Performance', icon: IconShield },
  { to: '/history', label: 'Prediction History', icon: IconHistory },
  { to: '/research', label: 'Research / About', icon: IconFlask }
];

export default function Sidebar({ open, onClose, modelStatus }) {
  const connected = modelStatus?.connected;
  return (
    <>
      {open && <button className="sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">FB</div>
          <div>
            <div className="brand-name">Freebuff — Fake Review Detection</div>
            <div className="brand-sub">Quantum AI Research</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={onClose}>
              <Icon className="nav-icon" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={`model-badge${connected ? ' connected' : ''}`}>
            <span className="dot" />
            {connected ? 'ML Model Connected' : 'ML Model: Not Connected'}
          </span>
        </div>
      </aside>
    </>
  );
}
