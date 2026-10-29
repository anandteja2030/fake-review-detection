import { IconMenu, IconSun, IconMoon } from './Icons.jsx';

export default function Topbar({ title, onMenu, theme, onToggleTheme }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><IconMenu /></button>
        <span className="topbar-title">{title}</span>
      </div>
      <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme">
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
    </header>
  );
}
