import { describe, expect, it } from 'vitest';
import { buildPatientBedConfigCardState } from '@/features/census/controllers/patientBedConfigCardController';

describe('patientBedConfigCardController', () => {
  it('builds derived view state for active non-blocked patient', () => {
    const result = buildPatientBedConfigCardState({
      admissionDate: '2026-02-10',
      currentDateString: '2026-02-15',
      patientName: 'Paciente',
      isBlocked: false,
      hasCompanion: true,
      hasClinicalCrib: false,
      isCunaMode: false,
      readOnly: false,
    });

    expect(result.daysHospitalized).toBe(5);
    expect(result.showDaysCounter).toBe(true);
    expect(result.showIndicators).toBe(true);
    expect(result.showMenu).toBe(true);
    expect(result.showClinicalCribToggle).toBe(true);
    expect(result.showClinicalCribActions).toBe(false);
  });

  it('hides interactive blocks when row is blocked/readOnly', () => {
    const blocked = buildPatientBedConfigCardState({
      admissionDate: '2026-02-10',
      currentDateString: '2026-02-15',
      patientName: 'Paciente',
      isBlocked: true,
      hasCompanion: false,
      hasClinicalCrib: true,
      isCunaMode: true,
      readOnly: true,
    });

    expect(blocked.showDaysCounter).toBe(false);
    expect(blocked.showIndicators).toBe(false);
    expect(blocked.showMenu).toBe(false);
    expect(blocked.showClinicalCribToggle).toBe(false);
    expect(blocked.showClinicalCribActions).toBe(true);
  });
});
