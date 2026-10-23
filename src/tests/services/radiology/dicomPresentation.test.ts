import { describe, expect, it } from 'vitest';
import {
  adjustTransfer,
  defaultVolumePresentation,
  normalizeVolumePresentation,
} from '@/services/radiology/dicomPresentation';

describe('DICOM volume presentation', () => {
  it('uses modality-specific presets and never labels MR intensities as CT', () => {
    expect(defaultVolumePresentation('MR').preset).toBe('MR-Default');
    const value = normalizeVolumePresentation(
      { ...defaultVolumePresentation('CT'), shift: 500 },
      'MR'
    );
    expect(value.preset).toBe('MR-Default');
    expect(value.shift).toBe(0);
  });
  it('bounds controls and rejects nonfinite presentation values', () => {
    expect(
      normalizeVolumePresentation(
        { ...defaultVolumePresentation('CT'), opacity: NaN, shift: Infinity, clipPercent: 1000 },
        'CT'
      )
    ).toMatchObject({ opacity: 100, shift: 0, clipPercent: 95 });
    expect(
      normalizeVolumePresentation(
        { ...defaultVolumePresentation('CT'), opacity: -5, shift: 5000 },
        'CT'
      )
    ).toMatchObject({ opacity: 5, shift: 1000 });
  });
  it('shifts scalar breakpoints while preserving colors and scaling only opacity', () => {
    expect(adjustTransfer('8 -100 1 0 0 200 0 1 0', 4, 50)).toBe('8 -50 1 0 0 250 0 1 0');
    expect(adjustTransfer('4 -100 0.2 200 0.8', 2, -50, 0.5)).toBe('4 -150 0.1 150 0.4');
  });
});
