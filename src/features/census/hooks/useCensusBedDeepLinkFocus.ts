import { useEffect, type RefObject } from 'react';
import { BEDS } from '@/constants/beds';

/** Consume the bed target only after the requested daily record and its table are committed. */
export const useCensusBedDeepLinkFocus = (
  tableRef: RefObject<HTMLDivElement | null>,
  censusDate: string,
  ready: boolean,
  onMissingBed: (bedId: string) => void
): void => {
  useEffect(() => {
    if (!ready || !tableRef.current) return;
    const url = new URL(window.location.href);
    const bedId = url.searchParams.get('focusBed');
    if (!bedId || url.searchParams.get('date') !== censusDate) return;
    let focusedRow: HTMLTableRowElement | null = null;
    // A bootstrap/Suspense commit can be replaced before its first paint. Keep the
    // target until that paint; cleanup cancels focus when the provisional table unmounts.
    const frame = window.requestAnimationFrame(() => {
      if (!tableRef.current) return;
      const currentUrl = new URL(window.location.href);
      if (
        currentUrl.searchParams.get('date') !== censusDate ||
        currentUrl.searchParams.get('focusBed') !== bedId
      )
        return;
      currentUrl.searchParams.delete('focusBed');
      window.history.replaceState(window.history.state, '', currentUrl);
      if (!BEDS.some(bed => bed.id === bedId)) return;
      const row = Array.from(
        tableRef.current.querySelectorAll<HTMLTableRowElement>('tbody tr[data-bed-id]')
      ).find(element => element.dataset.bedId === bedId);
      if (!row) {
        onMissingBed(bedId);
        return;
      }
      focusedRow = row;
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      // Deferred shell providers can remount the entire table after its first paint.
      // Restore the request only when that removes the focused row, never after the
      // user has moved focus to another control or navigated to a different day/module.
      if (!focusedRow || focusedRow.isConnected || document.activeElement !== document.body) return;
      const currentUrl = new URL(window.location.href);
      if (
        currentUrl.pathname !== url.pathname ||
        currentUrl.searchParams.get('date') !== censusDate ||
        currentUrl.searchParams.has('focusBed')
      )
        return;
      currentUrl.searchParams.set('focusBed', bedId);
      window.history.replaceState(window.history.state, '', currentUrl);
    };
  }, [tableRef, censusDate, ready, onMissingBed]);
};
