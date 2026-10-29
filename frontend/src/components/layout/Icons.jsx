const I = ({ children, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="18" height="18" {...p}>{children}</svg>
);
export const IconDashboard = (p) => <I {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></I>;
export const IconScan = (p) => <I {...p}><path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M17 4h2a1 1 0 0 1 1 1v2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 12h10"/></I>;
export const IconChart = (p) => <I {...p}><path d="M3 21h18"/><path d="M7 21V10"/><path d="M12 21V4"/><path d="M17 21v-8"/></I>;
export const IconBrain = (p) => <I {...p}><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5.2A3 3 0 0 0 6 17v1a3 3 0 0 0 3 3h1V3H9z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5.2A3 3 0 0 1 18 17v1a3 3 0 0 1-3 3h-1V3h1z"/></I>;
export const IconShield = (p) => <I {...p}><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></I>;
export const IconHistory = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></I>;
export const IconFlask = (p) => <I {...p}><path d="M10 3v6L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 9V3"/><path d="M8 3h8"/><path d="M7.5 14h9"/></I>;
export const IconSun = (p) => <I {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></I>;
export const IconMoon = (p) => <I {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></I>;
export const IconMenu = (p) => <I {...p}><path d="M4 6h16M4 12h16M4 18h16"/></I>;
export const IconWarn = (p) => <I {...p}><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17.5v.5"/></I>;
export const IconInfo = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></I>;
export const IconCheck = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/></I>;
export const IconError = (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></I>;
export const IconSpark = (p) => <I {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></I>;
export const IconSearch = (p) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></I>;
export const IconRefresh = (p) => <I {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></I>;
export const IconClose = (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18"/></I>;
export const IconPlus = (p) => <I {...p}><path d="M12 5v14M5 12h14"/></I>;
export const IconTrash = (p) => <I {...p}><path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></I>;
export const IconEdit = (p) => <I {...p}><path d="M4 20h4L19 9a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/></I>;
export const IconArrowRight = (p) => <I {...p}><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></I>;
