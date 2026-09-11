import { beginCensusTableObservation, recordCensusTableMilestone } from './censusStartupPerf';

/** Double rAF is a foreground paint opportunity, NOT proof of pixels presented by the GPU. */
export function observeCensusTable(key: string, element: HTMLElement | null): () => void {
  const id = beginCensusTableObservation(key);
  if (!id || !element) return () => {};
  const table = element.querySelector<HTMLTableElement>('[data-testid="census-table"]');
  const isTableCommitted = () =>
    element.isConnected && Boolean(table?.isConnected && table.querySelector('tbody tr'));
  if (!isTableCommitted()) return () => {};
  recordCensusTableMilestone(id, 'table_commit');
  let disposed = false;
  let completed = false;
  const deadline = performance.now() + 30_000;
  let first = 0;
  let second = 0;
  const isVisible = () =>
    isTableCommitted() &&
    document.visibilityState === 'visible' &&
    Boolean(table && table.getBoundingClientRect().height > 0) &&
    Boolean(
      table &&
      getComputedStyle(table).display !== 'none' &&
      getComputedStyle(table).visibility !== 'hidden' &&
      getComputedStyle(table).opacity !== '0' &&
      (typeof table.checkVisibility !== 'function' ||
        table.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    );
  const schedule = () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
    if (
      disposed ||
      completed ||
      document.visibilityState !== 'visible' ||
      performance.now() > deadline
    )
      return;
    if (!isVisible()) {
      first = requestAnimationFrame(schedule);
      return;
    }
    first = requestAnimationFrame(() => {
      if (disposed || !isVisible()) return;
      second = requestAnimationFrame(() => {
        if (!disposed && isVisible()) {
          recordCensusTableMilestone(id, 'table_paint_opportunity');
          completed = true;
          document.removeEventListener('visibilitychange', schedule);
        }
      });
    });
  };
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
    document.removeEventListener('visibilitychange', schedule);
  };
}
