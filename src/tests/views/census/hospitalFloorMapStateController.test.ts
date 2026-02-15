import { describe, expect, it } from 'vitest';
import {
  applyHospitalFloorBedTransform,
  patchHospitalFloorLayoutConfig,
} from '@/features/census/controllers/hospitalFloorMapStateController';
import type { SavedLayout } from '@/features/census/controllers/hospitalFloorMapRuntimeController';

const baseLayout: SavedLayout = {
  beds: {
    R1: { x: 0, z: 0, rotation: 0 },
  },
  config: {
    bedWidth: 1.5,
    bedLength: 2.2,
    colorOccupied: '#10b981',
    colorFree: '#94a3b8',
  },
};

describe('hospitalFloorMapStateController', () => {
  it('applies bed transform immutably', () => {
    const next = applyHospitalFloorBedTransform(baseLayout, 'R2', { x: 1, z: 2, rotation: 0.5 });

    expect(next).not.toBe(baseLayout);
    expect(next.beds).not.toBe(baseLayout.beds);
    expect(next.beds.R1).toEqual(baseLayout.beds.R1);
    expect(next.beds.R2).toEqual({ x: 1, z: 2, rotation: 0.5 });
  });

  it('patches config immutably preserving untouched values', () => {
    const next = patchHospitalFloorLayoutConfig(baseLayout, {
      bedWidth: 1.8,
      colorFree: '#ffffff',
    });

    expect(next).not.toBe(baseLayout);
    expect(next.config).not.toBe(baseLayout.config);
    expect(next.config).toEqual({
      bedWidth: 1.8,
      bedLength: 2.2,
      colorOccupied: '#10b981',
      colorFree: '#ffffff',
    });
  });
});
