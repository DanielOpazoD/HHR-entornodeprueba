import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';

interface Position {
  top: number;
  left: number;
}

const createFixtureElements = () => {
  const anchor = document.createElement('button');
  const popover = document.createElement('div');
  document.body.appendChild(anchor);
  document.body.appendChild(popover);
  return { anchor, popover };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('usePortalPopoverRuntime', () => {
  it('updates position on open and window resize', () => {
    const { anchor, popover } = createFixtureElements();
    const resolvePosition = vi.fn<() => Position | null>(() => ({ top: 12, left: 24 }));

    renderHook(() => {
      const anchorRef = useRef<HTMLElement | null>(anchor);
      const popoverRef = useRef<HTMLElement | null>(popover);
      return usePortalPopoverRuntime({
        isOpen: true,
        anchorRef,
        popoverRef,
        initialPosition: { top: 0, left: 0 },
        resolvePosition,
        onClose: vi.fn(),
      });
    });

    const initialCalls = resolvePosition.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(resolvePosition.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('closes on outside click but not when clicking anchor or popover', () => {
    const { anchor, popover } = createFixtureElements();
    const onClose = vi.fn();
    const resolvePosition = vi.fn<() => Position | null>(() => ({ top: 1, left: 1 }));

    renderHook(() => {
      const anchorRef = useRef<HTMLElement | null>(anchor);
      const popoverRef = useRef<HTMLElement | null>(popover);
      return usePortalPopoverRuntime({
        isOpen: true,
        anchorRef,
        popoverRef,
        initialPosition: { top: 0, left: 0 },
        resolvePosition,
        onClose,
      });
    });

    fireEvent.mouseDown(anchor);
    fireEvent.mouseDown(popover);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores scroll events inside popover and closes on outside scroll', () => {
    const { anchor, popover } = createFixtureElements();
    const onClose = vi.fn();
    const resolvePosition = vi.fn<() => Position | null>(() => ({ top: 1, left: 1 }));

    renderHook(() => {
      const anchorRef = useRef<HTMLElement | null>(anchor);
      const popoverRef = useRef<HTMLElement | null>(popover);
      return usePortalPopoverRuntime({
        isOpen: true,
        anchorRef,
        popoverRef,
        initialPosition: { top: 0, left: 0 },
        resolvePosition,
        onClose,
      });
    });

    act(() => {
      popover.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    const { anchor, popover } = createFixtureElements();
    const onClose = vi.fn();
    const resolvePosition = vi.fn<() => Position | null>(() => ({ top: 1, left: 1 }));

    renderHook(() => {
      const anchorRef = useRef<HTMLElement | null>(anchor);
      const popoverRef = useRef<HTMLElement | null>(popover);
      return usePortalPopoverRuntime({
        isOpen: true,
        anchorRef,
        popoverRef,
        initialPosition: { top: 0, left: 0 },
        resolvePosition,
        onClose,
      });
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
