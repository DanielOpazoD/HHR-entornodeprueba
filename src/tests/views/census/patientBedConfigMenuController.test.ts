// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolvePatientBedIndicators } from '@/features/census/controllers/patientBedConfigMenuController';

describe('patientBedConfigMenuController', () => {
  it('builds indicator badges from bed flags', () => {
    const indicators = resolvePatientBedIndicators({
      isCunaMode: true,
      hasCompanion: true,
      hasClinicalCrib: true,
    });

    expect(indicators.map(item => item.key)).toEqual(['cuna']);
    expect(indicators.map(item => item.label)).toEqual(['CUNA']);
  });
});
