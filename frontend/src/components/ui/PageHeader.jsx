/**
 * Shared page header: eyebrow, title, description, a large deck index and a
 * compact metadata strip. Used by all seven sections so hierarchy stays
 * identical across the application.
 */
export default function PageHeader({ index, eyebrow, title, description, actions, meta, children }) {
  return (
    <header className="page-head enter">
      {index && <span className="page-head-index" aria-hidden="true">{index}</span>}
      <div className="page-head-main">
        {eyebrow && <div className="eyebrow page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
        {children}
      </div>
      {(meta?.length > 0 || actions) && (
        <div className="page-head-side">
          {meta?.length > 0 && (
            <div className="page-meta">
              {meta.map((m) => (
                <div className="meta-item" key={m.k}>
                  <div className="meta-k">{m.k}</div>
                  <div className={`meta-v${m.tone ? ` ${m.tone}` : ''}`}>{m.v}</div>
                </div>
              ))}
            </div>
          )}
          {actions && <div className="page-actions">{actions}</div>}
        </div>
      )}
    </header>
  );
}
