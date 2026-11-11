import { IconMenu, IconSun, IconMoon, IconSidebar } from './Icons.jsx';

export default function Topbar({ title, onMenu, theme, onToggleTheme, modelStatus, onToggleRail, collapsed }) {
  const connected = modelStatus?.connected === true;
  const known = Boolean(modelStatus);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><IconMenu /></button>
        <button
          className="icon-btn rail-btn"
          onClick={onToggleRail}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <IconSidebar />
        </button>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="crumb-root">FakeReviewDetection</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">{title}</span>
        </nav>
      </div>
      <div className="topbar-right">
        <span className={`topbar-status${connected ? ' live' : ''}`} title={known ? (connected ? 'Express API reports a live ML inference connection' : 'Express API reports no ML connection') : 'Model status unavailable'}>
          <span className={`dot${connected ? ' on' : ''}`} />
          {known ? (connected ? 'ML live' : 'ML offline') : 'Checking'}
        </span>
        <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle colour theme" title="Toggle colour theme">
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </header>
  );
}
