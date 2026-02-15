import { describe, expect, it, vi } from 'vitest';
import {
  executeResetLayout,
  persistSavedLayout,
  resolveSavedLayoutState,
  type HospitalFloorMapRuntime,
  type SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';

describe('hospitalFloorMapRuntimeController', () => {
  const defaultLayout: SavedLayout = {
    beds: {},
    config: {
      bedWidth: 1.5,
      bedLength: 2.2,
      colorOccupied: '#10b981',
      colorFree: '#94a3b8',
    },
  };

  it('resolves default layout for invalid persisted payload', () => {
    expect(resolveSavedLayoutState(null, defaultLayout)).toEqual(defaultLayout);
    expect(resolveSavedLayoutState('invalid-json', defaultLayout)).toEqual(defaultLayout);
  });

  it('merges persisted config while preserving defaults', () => {
    const persisted = JSON.stringify({
      beds: { R1: { x: 1, z: 2, rotation: 0 } },
      config: { colorFree: '#000000' },
    });

    expect(resolveSavedLayoutState(persisted, defaultLayout)).toEqual({
      beds: { R1: { x: 1, z: 2, rotation: 0 } },
      config: {
        bedWidth: 1.5,
        bedLength: 2.2,
        colorOccupied: '#10b981',
        colorFree: '#000000',
      },
    });
  });

  it('persists layout and performs confirmed reset flow', () => {
    const runtime: HospitalFloorMapRuntime = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      confirm: vi.fn().mockReturnValue(true),
    };

    persistSavedLayout(runtime, 'storage-key', defaultLayout);
    expect(runtime.setItem).toHaveBeenCalledWith('storage-key', JSON.stringify(defaultLayout));

    const resetResult = executeResetLayout({
      runtime,
      storageKey: 'storage-key',
      confirmMessage: 'confirm?',
    });

    expect(resetResult).toBe(true);
    expect(runtime.removeItem).toHaveBeenCalledWith('storage-key');
  });

  it('does not reset when confirmation is rejected', () => {
    const runtime: HospitalFloorMapRuntime = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      confirm: vi.fn().mockReturnValue(false),
    };

    const resetResult = executeResetLayout({
      runtime,
      storageKey: 'storage-key',
      confirmMessage: 'confirm?',
    });

    expect(resetResult).toBe(false);
    expect(runtime.removeItem).not.toHaveBeenCalled();
  });
});
