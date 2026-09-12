export const isPerfAuditEnabled = (): boolean => {
  if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return false;
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem('hhr_perf_audit') === '1';
  } catch {
    return false;
  }
};
