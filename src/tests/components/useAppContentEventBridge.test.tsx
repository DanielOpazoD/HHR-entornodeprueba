import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useAppContentEventBridge } from '@/components/layout/app-content/useAppContentEventBridge';
import type { ModuleType } from '@/constants/navigationConfig';

const EventBridgeHarness = ({
  setCurrentModule,
  setSelectedShift,
}: {
  setCurrentModule: (module: ModuleType) => void;
  setSelectedShift: (shift: 'day' | 'night') => void;
}) => {
  useAppContentEventBridge({
    setCurrentModule,
    setSelectedShift,
  });

  return null;
};

describe('useAppContentEventBridge', () => {
  it('forwards navigate-module events', () => {
    const setCurrentModule = vi.fn();
    const setSelectedShift = vi.fn();
    render(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );

    window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }));

    expect(setCurrentModule).toHaveBeenCalledWith('CUDYR');
  });

  it('ignores invalid navigate-module payloads', () => {
    const setCurrentModule = vi.fn();
    const setSelectedShift = vi.fn();
    render(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );

    window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'TRANSFER_MANAGEMENT' }));
    window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'NOT_A_MODULE' }));
    window.dispatchEvent(new CustomEvent('navigate-module'));

    expect(setCurrentModule).not.toHaveBeenCalled();
  });

  it('forwards valid set-shift events and ignores invalid values', () => {
    const setCurrentModule = vi.fn();
    const setSelectedShift = vi.fn();
    render(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );

    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'day' }));
    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'invalid' }));
    window.dispatchEvent(new CustomEvent('set-shift', { detail: null }));

    expect(setSelectedShift).toHaveBeenCalledTimes(2);
    expect(setSelectedShift).toHaveBeenNthCalledWith(1, 'day');
    expect(setSelectedShift).toHaveBeenNthCalledWith(2, 'night');
  });

  it('does not re-register window listeners across rerenders when callbacks stay stable', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const setCurrentModule = vi.fn();
    const setSelectedShift = vi.fn();

    const { rerender } = render(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );
    const bridgeRegistrations = () =>
      addSpy.mock.calls.filter(([name]) => name === 'navigate-module' || name === 'set-shift')
        .length;
    expect(bridgeRegistrations()).toBe(2);

    rerender(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );
    expect(bridgeRegistrations()).toBe(2);
    addSpy.mockRestore();
  });
});
