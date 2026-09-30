import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusBedDeepLinkFocus } from '@/features/census/hooks/useCensusBedDeepLinkFocus';

const DATE = '2026-09-27';
let root: HTMLDivElement;
const onMissing = vi.fn();
const scroll = vi.fn();
let frame: FrameRequestCallback | undefined;
const paint = () => act(() => frame?.(0));
const navigate = (query: string) => window.history.replaceState(null, '', `/census?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  frame = undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  root = document.createElement('div');
  root.innerHTML = '<table><tbody><tr data-bed-id="R4"><td>Cama vacía</td></tr></tbody></table>';
  document.body.appendChild(root);
  Object.defineProperty(root.querySelector('tr'), 'scrollIntoView', { value: scroll });
});
afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
  window.history.replaceState(null, '', '/');
});

describe('bed deep-link focus', () => {
  it('waits for the selected record then focuses without clicking or repeating on rerenders', () => {
    navigate(`date=${DATE}&focusBed=R4&other=preserved`);
    const click = vi.fn();
    root.addEventListener('click', click);
    const ref = { current: root };
    const { rerender } = renderHook(
      ({ ready }) => useCensusBedDeepLinkFocus(ref, DATE, ready, onMissing),
      {
        initialProps: { ready: false },
      }
    );
    expect(document.activeElement).not.toBe(root.querySelector('tr'));
    expect(window.location.search).toContain('focusBed=R4');
    rerender({ ready: true });
    paint();
    expect(document.activeElement).toBe(root.querySelector('tr'));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      block: 'center',
      inline: 'nearest',
      behavior: 'auto',
    });
    expect(window.location.search).toBe(`?date=${DATE}&other=preserved`);
    expect(click).not.toHaveBeenCalled();
    rerender({ ready: false });
    rerender({ ready: true });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('leaves the target intact if a provisional table unmounts before paint', () => {
    navigate(`date=${DATE}&focusBed=R4`);
    const { unmount } = renderHook(() =>
      useCensusBedDeepLinkFocus({ current: root }, DATE, true, onMissing)
    );
    unmount();
    paint();
    expect(window.location.search).toContain('focusBed=R4');
    expect(scroll).not.toHaveBeenCalled();
    renderHook(() => useCensusBedDeepLinkFocus({ current: root }, DATE, true, onMissing));
    paint();
    expect(root.querySelector('tr')).toHaveFocus();
  });

  it('recovers focus after a deferred provider replaces the table, without replaying user navigation', () => {
    navigate(`date=${DATE}&focusBed=R4`);
    const ref = { current: root };
    const { unmount } = renderHook(() => useCensusBedDeepLinkFocus(ref, DATE, true, onMissing));
    paint();
    const oldRow = root.querySelector('tr')!;
    oldRow.remove();
    unmount();
    expect(window.location.search).toContain('focusBed=R4');
    root.querySelector('tbody')!.appendChild(oldRow);
    const replacement = renderHook(() => useCensusBedDeepLinkFocus(ref, DATE, true, onMissing));
    paint();
    expect(oldRow).toHaveFocus();
    const control = document.createElement('button');
    root.appendChild(control);
    control.focus();
    oldRow.remove();
    replacement.unmount();
    expect(window.location.search).not.toContain('focusBed');
  });

  it('does not consume or focus a target while a different daily record is displayed', () => {
    navigate(`date=${DATE}&focusBed=R4`);
    renderHook(() => useCensusBedDeepLinkFocus({ current: root }, '2026-09-26', true, onMissing));
    expect(scroll).not.toHaveBeenCalled();
    expect(window.location.search).toContain('focusBed=R4');
  });

  it('reports a known bed absent from the visible rows instead of focusing another patient', () => {
    navigate(`date=${DATE}&focusBed=E5`);
    renderHook(() => useCensusBedDeepLinkFocus({ current: root }, DATE, true, onMissing));
    paint();
    expect(onMissing).toHaveBeenCalledExactlyOnceWith('E5');
    expect(scroll).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain('focusBed');
  });

  it('ignores invalid bed targets without a selector injection or clinical action', () => {
    navigate(`date=${DATE}&focusBed=${encodeURIComponent('R4"] td')}`);
    expect(() =>
      renderHook(() => useCensusBedDeepLinkFocus({ current: root }, DATE, true, onMissing))
    ).not.toThrow();
    paint();
    expect(scroll).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
  });
});
