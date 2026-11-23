// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CUDYR_MIN_HOSPITALIZATION_HOURS,
  CUDYR_NIGHT_REFERENCE_TIME,
  hasVisibleCudyrPatientName,
  resolveCudyrEligibility,
} from '@/domain/cudyr/cudyrEligibility';

describe('cudyrEligibilityController', () => {
  const recordDate = '2026-04-12';

  it('allows patients admitted before the record date', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente Previo',
        admissionDate: '2026-04-11',
        admissionTime: '23:30',
      })
    ).toMatchObject({
      isEligible: true,
      isBlocked: false,
    });
  });

  it('allows same-day admissions with missing time by conservative night-shift assumption', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente sin hora',
        admissionDate: '2026-04-12',
      })
    ).toMatchObject({
      isEligible: true,
      isBlocked: false,
    });
  });

  it('allows same-day admissions exactly at the 8-hour cutoff', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente 17:00',
        admissionDate: '2026-04-12',
        admissionTime: '17:00',
      })
    ).toMatchObject({
      isEligible: true,
      isBlocked: false,
    });
  });

  it('blocks same-day admissions that have not completed 8 hours by 01:00 of the next day', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente 17:01',
        admissionDate: '2026-04-12',
        admissionTime: '17:01',
      })
    ).toMatchObject({
      isEligible: false,
      isBlocked: true,
      blockedReason: `Ingreso menor a ${CUDYR_MIN_HOSPITALIZATION_HOURS} h al corte fijo ${CUDYR_NIGHT_REFERENCE_TIME}.`,
    });
  });

  it('blocks admissions that belong to the next calendar day of the night shift even without a time', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente madrugada',
        admissionDate: '2026-04-13',
      })
    ).toMatchObject({
      isEligible: false,
      isBlocked: true,
    });
  });

  it('blocks patients with missing admission date because the 8-hour rule cannot be evaluated', () => {
    expect(
      resolveCudyrEligibility({
        recordDate,
        patientName: 'Paciente sin fecha',
      })
    ).toMatchObject({
      isEligible: false,
      isBlocked: true,
      blockedReason: 'Sin fecha de ingreso para evaluar CUDYR.',
    });
  });

  it('detects whether a patient has a displayable CUDYR name', () => {
    expect(hasVisibleCudyrPatientName('Paciente visible')).toBe(true);
    expect(hasVisibleCudyrPatientName('   ')).toBe(false);
    expect(hasVisibleCudyrPatientName(undefined)).toBe(false);
  });
});
