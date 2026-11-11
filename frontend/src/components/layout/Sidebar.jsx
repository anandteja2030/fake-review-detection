import { NavLink } from 'react-router-dom';
import {
  IconDashboard, IconScan, IconChart, IconBrain, IconShield,
  IconHistory, IconFlask, IconLogo
} from './Icons.jsx';

export const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
      { to: '/analyzer', label: 'Review Analyzer', icon: IconScan }
    ]
  },
  {
    label: 'Interpretation',
    items: [
      { to: '/analytics', label: 'Analytics', icon: IconChart },
      { to: '/explainability', label: 'Explainable AI', icon: IconBrain },
      { to: '/model-performance', label: 'Model Performance', icon: IconShield },
      { to: '/history', label: 'Prediction History', icon: IconHistory }
    ]
  },
  {
    label: 'Project',
    items: [{ to: '/research', label: 'Research / About', icon: IconFlask }]
  }
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function Sidebar({ open, collapsed = false, onClose, modelStatus }) {
  const connected = modelStatus?.connected === true;
  return (
    <>
      {open && <button className="sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />}
      <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true"><IconLogo /></div>
          <div className="brand-text">
            <div className="brand-name">Fake Review Detection</div>
            <div className="brand-sub">Explainable AI Studio</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={onClose}
                >
                  <Icon className="nav-icon" />
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-card" title={modelStatus ? (connected ? 'ML inference service connected' : 'ML inference service not connected') : 'Checking model status'}>
            <span className={`dot${connected ? ' on' : ''}`} />
            <div className="status-card-text">
              <div className="status-card-title">{connected ? 'Model online' : 'Model offline'}</div>
              <div className="status-card-sub">stacking ensemble</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
