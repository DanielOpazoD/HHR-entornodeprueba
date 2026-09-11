import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ begin: vi.fn(() => 'visit-1'), mark: vi.fn() }));
vi.mock('@/shared/runtime/censusStartupPerf', () => ({
  beginCensusTableObservation: mocks.begin,
  recordCensusTableMilestone: mocks.mark,
}));
import { observeCensusTable } from '@/shared/runtime/observeCensusTable';
let callbacks: Map<number, FrameRequestCallback>;
let next: number;
const frame = () => {
  const work = [...callbacks.values()];
  callbacks.clear();
  work.forEach(fn => fn(1));
};
function table() {
  const el = document.createElement('div');
  el.innerHTML =
    '<table data-testid="census-table"><tbody><tr><td>synthetic</td></tr></tbody></table>';
  document.body.append(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height: 10 } as DOMRect);
  vi.spyOn(el.querySelector('table')!, 'getBoundingClientRect').mockReturnValue({
    height: 10,
  } as DOMRect);
  return el;
}
beforeEach(() => {
  vi.clearAllMocks();
  callbacks = new Map();
  next = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn: FrameRequestCallback) => {
      callbacks.set(++next, fn);
      return next;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => callbacks.delete(id))
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('table commit versus foreground paint opportunity', () => {
  it('does not mark a loader or detached table', () => {
    const a = document.createElement('div');
    const cleanup = observeCensusTable('a', a);
    frame();
    frame();
    expect(mocks.mark).not.toHaveBeenCalled();
    cleanup();
  });
  it('records the real commit then waits two animation frames', () => {
    const cleanup = observeCensusTable('a', table());
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith('visit-1', 'table_commit');
    frame();
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    frame();
    expect(mocks.mark).toHaveBeenLastCalledWith('visit-1', 'table_paint_opportunity');
    cleanup();
  });
  it('cancels stale frames on cleanup and strict-mode remount', () => {
    const el = table();
    const first = observeCensusTable('a', el);
    first();
    frame();
    frame();
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    const second = observeCensusTable('a', el);
    frame();
    frame();
    expect(mocks.mark.mock.calls.filter(c => c[1] === 'table_paint_opportunity')).toHaveLength(1);
    second();
  });
  it('does not claim a paint while the document is hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const cleanup = observeCensusTable('a', table());
    frame();
    frame();
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    frame();
    expect(mocks.mark).toHaveBeenLastCalledWith('visit-1', 'table_paint_opportunity');
    cleanup();
  });
  it('does not claim paint if the table disappears between frames', () => {
    const el = table();
    const cleanup = observeCensusTable('a', el);
    frame();
    el.remove();
    frame();
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it('never paints a hidden descendant table inside a visible wrapper', () => {
    const el = table();
    el.querySelector('table')!.style.display = 'none';
    const cleanup = observeCensusTable('a', el);
    frame();
    frame();
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith('visit-1', 'table_commit');
    cleanup();
  });
  it('waits for CSS visibility before taking the two paint frames', () => {
    const el = table();
    const child = el.querySelector('table')!;
    child.style.opacity = '0';
    const cleanup = observeCensusTable('a', el);
    frame();
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    child.style.opacity = '1';
    frame();
    frame();
    frame();
    expect(mocks.mark).toHaveBeenLastCalledWith('visit-1', 'table_paint_opportunity');
    cleanup();
  });
});
