import { describe, expect, it } from 'vitest';
import {
  resolveClinicalCribButtonModel,
  resolveCompanionButtonModel,
  resolvePatientBedIndicators,
} from '@/features/census/controllers/patientBedConfigMenuController';

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

  it('resolves companion and clinical crib visual models', () => {
    const companion = resolveCompanionButtonModel(true);
    expect(companion.className).toContain('bg-emerald-50');

    const clinical = resolveClinicalCribButtonModel(false);
    expect(clinical.className).toContain('bg-slate-50');
  });
});
