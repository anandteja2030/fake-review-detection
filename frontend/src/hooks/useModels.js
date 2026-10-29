import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('afrd-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('afrd-theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export function useModelStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    api.modelStatus()
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, []);
  return { status, error };
}

export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick]);

  return { data, loading, error, reload };
}
