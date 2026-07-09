import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RAYEN_IMPORT_MODE,
  getRayenImportMode,
  setRayenImportMode,
  subscribeRayenImportMode,
  isRayenCensusSnapshot,
  type RayenCensusSnapshot,
} from '@/features/rayen-import';

describe('rayen import mode setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to preview', () => {
    expect(DEFAULT_RAYEN_IMPORT_MODE).toBe('preview');
    expect(getRayenImportMode()).toBe('preview');
  });

  it('persists and reads the auto mode', () => {
    setRayenImportMode('auto');
    expect(getRayenImportMode()).toBe('auto');
    expect(localStorage.getItem('hhr_rayen_import_mode')).toBe('auto');
    setRayenImportMode('preview');
    expect(getRayenImportMode()).toBe('preview');
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRayenImportMode(listener);
    setRayenImportMode('auto');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setRayenImportMode('preview');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('isRayenCensusSnapshot', () => {
  const validSnapshot: RayenCensusSnapshot = {
    capturedAt: '2026-07-08T20:00:00-06:00',
    facilityId: 1342,
    encounters: [
      { encounterId: 'E1', run: '144700554', firstGivenName: 'Ana', firstFamilyName: 'Perez' },
    ],
  };

  it('accepts a well-formed snapshot', () => {
    expect(isRayenCensusSnapshot(validSnapshot)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isRayenCensusSnapshot(null)).toBe(false);
    expect(isRayenCensusSnapshot({ facilityId: 1342 })).toBe(false);
    expect(isRayenCensusSnapshot({ ...validSnapshot, encounters: [{ run: '1' }] })).toBe(false);
  });
});
