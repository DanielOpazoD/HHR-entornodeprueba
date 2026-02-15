import { describe, expect, it } from 'vitest';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';

describe('patientBedConfigViewController', () => {
  it('returns null when required dates are missing', () => {
    expect(
      calculateHospitalizedDays({ admissionDate: undefined, currentDate: '2026-02-15' })
    ).toBeNull();
    expect(
      calculateHospitalizedDays({ admissionDate: '2026-02-10', currentDate: undefined })
    ).toBeNull();
  });

  it('returns non-negative day difference', () => {
    expect(
      calculateHospitalizedDays({
        admissionDate: '2026-02-10',
        currentDate: '2026-02-15',
      })
    ).toBe(5);

    expect(
      calculateHospitalizedDays({
        admissionDate: '2026-02-16',
        currentDate: '2026-02-15',
      })
    ).toBe(0);
  });
});
