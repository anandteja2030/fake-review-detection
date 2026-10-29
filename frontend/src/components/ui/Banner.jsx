import { IconWarn, IconInfo } from '../layout/Icons.jsx';

export default function Banner({ kind = 'info', children, ...rest }) {
  const Icon = kind === 'warn' ? IconWarn : IconInfo;
  return (
    <div className={`banner banner-${kind === 'warn' ? 'warn' : 'info'}`} {...rest}>
      <Icon width="17" height="17" style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
