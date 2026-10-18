import { Enums } from '@cornerstonejs/tools';

/** Cornerstone defers mouse down for double-click recognition. An old click must
 * not start a new annotation after undo, clear, or a tool change. */
export const createDicomInputBoundary = (elements: HTMLDivElement[]) => {
  let invalidBefore = -Infinity;
  const rejectStale = (event: Event) => {
    const original = (event as CustomEvent<{ event?: Event }>).detail?.event;
    if (!original || !Number.isFinite(original.timeStamp)) return;
    const timestamp =
      original.timeStamp > performance.timeOrigin
        ? original.timeStamp - performance.timeOrigin
        : original.timeStamp;
    if (timestamp > invalidBefore) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const names = [Enums.Events.MOUSE_DOWN, Enums.Events.MOUSE_DOWN_ACTIVATE];
  elements.forEach(element =>
    names.forEach(name => element.addEventListener(name, rejectStale, true))
  );
  return {
    invalidate: () => {
      invalidBefore = performance.now();
    },
    dispose: () =>
      elements.forEach(element =>
        names.forEach(name => element.removeEventListener(name, rejectStale, true))
      ),
  };
};
