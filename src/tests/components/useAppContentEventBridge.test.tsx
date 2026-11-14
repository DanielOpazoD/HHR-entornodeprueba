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

    window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'NOT_A_MODULE' }));

    expect(setCurrentModule).not.toHaveBeenCalled();
  });

  it('forwards valid set-shift events and ignores invalid values', () => {
    const setCurrentModule = vi.fn();
    const setSelectedShift = vi.fn();
    render(
      <EventBridgeHarness setCurrentModule={setCurrentModule} setSelectedShift={setSelectedShift} />
    );

    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
    window.dispatchEvent(new CustomEvent('set-shift', { detail: 'invalid' }));

    expect(setSelectedShift).toHaveBeenCalledTimes(1);
    expect(setSelectedShift).toHaveBeenCalledWith('night');
  });
});
