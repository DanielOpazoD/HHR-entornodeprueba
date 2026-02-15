import { describe, expect, it } from 'vitest';
import { BedType, type BedDefinition } from '@/types';
import {
  createDefaultSavedLayout,
  DEFAULT_HOSPITAL_FLOOR_LAYOUT,
  HOSPITAL_FLOOR_STORAGE_KEY,
  resolveHospitalFloorBedItems,
  resolveZoomValueFromDistance,
} from '@/features/census/controllers/hospitalFloorMapViewController';

describe('hospitalFloorMapViewController', () => {
  const testBeds: BedDefinition[] = [
    { id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false },
    { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false },
    { id: 'X1', name: 'X1', type: BedType.MEDIA, isCuna: false },
  ];

  it('exports stable storage key and default layout', () => {
    expect(HOSPITAL_FLOOR_STORAGE_KEY).toBe('hhr_3d_layout_v2');
    expect(DEFAULT_HOSPITAL_FLOOR_LAYOUT.R1).toEqual({ x: -2.5, z: -6, rotation: 0 });
  });

  it('builds default saved layout config', () => {
    expect(createDefaultSavedLayout()).toEqual({
      beds: {},
      config: {
        bedWidth: 1.5,
        bedLength: 2.2,
        colorOccupied: '#10b981',
        colorFree: '#94a3b8',
      },
    });
  });

  it('resolves bed items preferring saved transforms then hardcoded defaults then grid fallback', () => {
    const result = resolveHospitalFloorBedItems({
      beds: testBeds,
      savedBeds: {
        R2: { x: 10, z: 20, rotation: 1.57 },
      },
    });

    expect(result[0]).toEqual({
      bed: testBeds[0],
      transform: DEFAULT_HOSPITAL_FLOOR_LAYOUT.R1,
    });
    expect(result[1]).toEqual({
      bed: testBeds[1],
      transform: { x: 10, z: 20, rotation: 1.57 },
    });
    expect(result[2].bed).toEqual(testBeds[2]);
    expect(result[2].transform.rotation).toBe(0);
  });

  it('normalizes zoom value from distance with clamping', () => {
    expect(resolveZoomValueFromDistance(12)).toBe(100);
    expect(resolveZoomValueFromDistance(1200)).toBe(10);
    expect(resolveZoomValueFromDistance(0.5)).toBe(500);
    expect(resolveZoomValueFromDistance(Number.NaN)).toBe(10);
  });
});
