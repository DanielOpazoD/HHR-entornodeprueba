// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';

describe('patientRowStateController', () => {
  it('derives default-safe state when data is missing', () => {
    expect(derivePatientRowState(undefined)).toEqual({
      isCunaMode: false,
      hasCompanion: false,
      hasClinicalCrib: false,
      isBlocked: false,
      isEmpty: true,
    });
  });

  it('derives row flags from patient data', () => {
    const data = {
      patientName: 'RN 1',
      bedMode: 'Cuna',
      hasCompanionCrib: true,
      clinicalCrib: { bedMode: 'Cuna' },
      isBlocked: true,
    } as PatientData;

    expect(derivePatientRowState(data)).toEqual({
      isCunaMode: true,
      hasCompanion: true,
      hasClinicalCrib: true,
      isBlocked: true,
      isEmpty: false,
    });
  });

  it('keeps whitespace-only activation placeholders as empty rows until identity is real', () => {
    const data = {
      patientName: ' ',
      rut: '',
      isBlocked: false,
    } as PatientData;

    expect(derivePatientRowState(data)).toEqual({
      isCunaMode: false,
      hasCompanion: false,
      hasClinicalCrib: false,
      isBlocked: false,
      isEmpty: true,
    });
  });

  it('treats rows with a persisted rut as non-empty even before the name arrives', () => {
    const data = {
      patientName: '',
      rut: '11.111.111-1',
      isBlocked: false,
    } as PatientData;

    expect(derivePatientRowState(data).isEmpty).toBe(false);
  });
});
