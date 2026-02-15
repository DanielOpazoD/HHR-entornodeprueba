import { describe, expect, it } from 'vitest';
import {
  resolveBedModeButtonModel,
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

    expect(indicators.map(item => item.key)).toEqual(['cuna', 'rn', 'cc']);
    expect(indicators.map(item => item.label)).toEqual(['CUNA', 'RN', '+CC']);
  });

  it('resolves bed mode/companion/clinical crib visual models', () => {
    const bedMode = resolveBedModeButtonModel(true);
    expect(bedMode.label).toBe('Cambiar a Cama');
    expect(bedMode.className).toContain('bg-pink-50');

    const companion = resolveCompanionButtonModel(true);
    expect(companion.className).toContain('bg-emerald-50');

    const clinical = resolveClinicalCribButtonModel(false);
    expect(clinical.className).toContain('bg-slate-50');
  });
});
