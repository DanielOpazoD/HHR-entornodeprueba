// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import { buildNursingNoteChangePlan } from '@/hooks/controllers/handoffNursingNoteController';

const buildBed = (): PatientData =>
  ({
    patientName: 'Paciente',
    rut: '1-9',
    handoffNoteDayShift: 'Dia actual',
    handoffNoteNightShift: 'Noche actual',
    clinicalCrib: {
      patientName: 'RN',
      rut: '2-7',
      handoffNoteDayShift: 'Dia cuna',
      handoffNoteNightShift: 'Noche cuna',
    },
  }) as unknown as PatientData;

describe('handoffNursingNoteController', () => {
  it('builds a day-shift plan that mirrors the note to both shifts', () => {
    const plan = buildNursingNoteChangePlan({
      selectedShift: 'day',
      isNested: false,
      bed: buildBed(),
    });

    expect(plan).toEqual({
      noteKey: 'handoffNoteDayShift',
      noteFields: {
        handoffNoteDayShift: '',
        handoffNoteNightShift: '',
      },
      oldNote: 'Dia actual',
      usesMultipleUpdate: true,
    });
  });

  it('builds a night-shift nested plan using the crib note only', () => {
    const plan = buildNursingNoteChangePlan({
      selectedShift: 'night',
      isNested: true,
      bed: buildBed(),
    });

    expect(plan).toEqual({
      noteKey: 'handoffNoteNightShift',
      noteFields: {
        handoffNoteNightShift: '',
      },
      oldNote: 'Noche cuna',
      usesMultipleUpdate: false,
    });
  });
});
