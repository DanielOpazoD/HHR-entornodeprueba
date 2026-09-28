// @vitest-environment node
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

  it('normalizes ISO datetime values before calculating elapsed days', () => {
    expect(
      calculateHospitalizedDays({
        admissionDate: '2026-02-10T23:59:00.000Z',
        currentDate: '2026-02-15T01:00:00.000Z',
      })
    ).toBe(5);
  });
});
