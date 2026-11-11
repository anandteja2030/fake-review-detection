import { useEffect, useState } from 'react';
import { loadSelection, SELECTION_EVENT } from '../lib/evidenceStore.js';

/**
 * The one current-analysis record shared by Explainable AI and Analytics.
 *
 * Reads the validated selection snapshot and re-reads it whenever another page
 * (Analyzer, History) selects a record or another tab writes to storage — so a
 * freshly analyzed review reaches every section instead of a cached record.
 */
export function useSelection() {
  const [selection, setSelection] = useState(() => loadSelection());

  useEffect(() => {
    const sync = () => setSelection(loadSelection());
    const onStorage = (e) => {
      if (!e.key || e.key.startsWith('afrd.xai.')) sync();
    };
    window.addEventListener(SELECTION_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SELECTION_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return selection;
}
