import { describe, expect, it } from 'vitest';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { resolveUndoPatientMovement } from '@/features/census/controllers/patientMovementUndoController';

describe('patientMovementUndoController', () => {
  it('restores main patient snapshot when bed is empty', () => {
    const bedId = 'R1';
    const resolution = resolveUndoPatientMovement({
      bedData: { ...createEmptyPatient(bedId), location: 'Sala 1' },
      bedId,
      isNested: false,
      originalData: { ...createEmptyPatient(bedId), patientName: 'Paciente A', rut: '1-9' },
      createEmptyPatient,
    });

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value.updatedBed.patientName).toBe('Paciente A');
      expect(resolution.value.updatedBed.location).toBe('Sala 1');
    }
  });

  it('blocks restore when main bed is occupied', () => {
    const bedId = 'R1';
    const resolution = resolveUndoPatientMovement({
      bedData: { ...createEmptyPatient(bedId), patientName: 'Otro paciente' },
      bedId,
      isNested: false,
      originalData: { ...createEmptyPatient(bedId), patientName: 'Paciente A' },
      createEmptyPatient,
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error.code).toBe('MAIN_BED_OCCUPIED');
    }
  });

  it('blocks nested restore when main bed is empty', () => {
    const bedId = 'R1';
    const resolution = resolveUndoPatientMovement({
      bedData: createEmptyPatient(bedId),
      bedId,
      isNested: true,
      originalData: { ...createEmptyPatient(bedId), patientName: 'RN A' },
      createEmptyPatient,
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error.code).toBe('MAIN_BED_EMPTY');
    }
  });

  it('blocks nested restore when clinical crib is already occupied', () => {
    const bedId = 'R1';
    const resolution = resolveUndoPatientMovement({
      bedData: {
        ...createEmptyPatient(bedId),
        patientName: 'Madre',
        clinicalCrib: { ...createEmptyPatient(bedId), patientName: 'RN existente' },
      },
      bedId,
      isNested: true,
      originalData: { ...createEmptyPatient(bedId), patientName: 'RN nuevo' },
      createEmptyPatient,
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error.code).toBe('CLINICAL_CRIB_OCCUPIED');
    }
  });

  it('restores nested clinical crib snapshot', () => {
    const bedId = 'R1';
    const resolution = resolveUndoPatientMovement({
      bedData: { ...createEmptyPatient(bedId), patientName: 'Madre' },
      bedId,
      isNested: true,
      originalData: { ...createEmptyPatient(bedId), patientName: 'RN A', rut: '2-7' },
      createEmptyPatient,
    });

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value.updatedBed.patientName).toBe('Madre');
      expect(resolution.value.updatedBed.clinicalCrib?.patientName).toBe('RN A');
    }
  });
});
