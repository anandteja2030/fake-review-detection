import { IconInfo, IconWarn, IconError, IconCheck } from '../layout/Icons.jsx';

const ICONS = { info: IconInfo, warn: IconWarn, error: IconError, ok: IconCheck };

export default function StateBlock({ kind = 'info', title, children, action }) {
  const Icon = ICONS[kind] || IconInfo;
  return (
    <div className="state-block">
      <div className={`state-icon ${kind}`}><Icon width="24" height="24" /></div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
