import { useEffect, useState } from 'react';
import { fetchMoaCatalog, readCachedMoaCatalog, type MoaCatalog } from './moaCatalog';

/** Called only inside the explicitly enabled, lazy-loaded companion. */
export function useMoaCatalog() {
  const [catalog, setCatalog] = useState<MoaCatalog | null>(readCachedMoaCatalog);
  useEffect(() => {
    let disposed = false;
    let lastAttempt = 0;
    let request: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.hidden || Date.now() - lastAttempt < 15 * 60_000) return;
      lastAttempt = Date.now();
      request = new AbortController();
      timeout = setTimeout(() => request?.abort(), 6000);
      void fetchMoaCatalog(request.signal)
        .then(value => {
          if (!disposed) setCatalog(value);
        })
        .catch(() => {
          /* Last validated catalog or the 18 local scenes remain usable. */
        })
        .finally(() => clearTimeout(timeout));
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return catalog;
}
