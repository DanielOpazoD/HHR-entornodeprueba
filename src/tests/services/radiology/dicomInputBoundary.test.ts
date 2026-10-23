import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@cornerstonejs/tools', () => ({
  Enums: { Events: { MOUSE_DOWN: 'down', MOUSE_DOWN_ACTIVATE: 'activate' } },
}));
import { createDicomInputBoundary } from '@/services/radiology/dicomInputBoundary';
afterEach(() => vi.restoreAllMocks());
it('blocks a queued click from before undo/tool change but allows the next real interaction', () => {
  const element = document.createElement('div');
  const otherViewer = document.createElement('div');
  const boundary = createDicomInputBoundary([element]);
  const listener = vi.fn();
  element.addEventListener('down', listener);
  element.addEventListener('activate', listener);
  otherViewer.addEventListener('down', listener);
  const send = (target: HTMLDivElement, timestamp: number, type = 'down') => {
    const event = new CustomEvent(type, {
      cancelable: true,
      detail: { event: { timeStamp: timestamp } },
    });
    target.dispatchEvent(event);
    return event;
  };
  vi.spyOn(performance, 'now').mockReturnValue(100);
  boundary.invalidate();
  expect(send(element, 50).defaultPrevented).toBe(true);
  expect(send(element, 100, 'activate').defaultPrevented).toBe(true);
  expect(listener).not.toHaveBeenCalled();
  expect(send(element, 101).defaultPrevented).toBe(false);
  expect(send(otherViewer, 50).defaultPrevented).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
  boundary.dispose();
  expect(send(element, 50).defaultPrevented).toBe(false);
});
it('normalizes epoch event timestamps without suppressing fresh input', () => {
  const element = document.createElement('div'),
    boundary = createDicomInputBoundary([element]);
  vi.spyOn(performance, 'now').mockReturnValue(100);
  boundary.invalidate();
  const old = new CustomEvent('down', {
    cancelable: true,
    detail: { event: { timeStamp: performance.timeOrigin + 50 } },
  });
  element.dispatchEvent(old);
  expect(old.defaultPrevented).toBe(true);
  const fresh = new CustomEvent('down', {
    cancelable: true,
    detail: { event: { timeStamp: performance.timeOrigin + 200 } },
  });
  element.dispatchEvent(fresh);
  expect(fresh.defaultPrevented).toBe(false);
  boundary.dispose();
});
