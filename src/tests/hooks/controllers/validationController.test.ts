import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { validatePatientDischarge } from '@/hooks/controllers/validationController';

describe('validationController', () => {
  it('validates minimal discharge readiness', () => {
    expect(
      validatePatientDischarge({
        patientName: 'Paciente',
        admissionDate: '2026-03-17',
      } as PatientData)
    ).toBe(true);
    expect(
      validatePatientDischarge({
        patientName: '',
        admissionDate: '2026-03-17',
      } as PatientData)
    ).toBe(false);
  });
});
