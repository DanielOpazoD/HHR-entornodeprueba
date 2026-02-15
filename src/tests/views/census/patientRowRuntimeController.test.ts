import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowActionDispatcher,
  buildPatientRowBedTypeToggles,
} from '@/features/census/controllers/patientRowRuntimeController';
import { PatientData } from '@/types';

const mockPatient = {
  bedId: 'R1',
  patientName: 'Paciente',
} as PatientData;

describe('patientRowRuntimeController', () => {
  it('dispatches row action with bed id and patient payload', () => {
    const onAction = vi.fn();
    const dispatch = buildPatientRowActionDispatcher({
      onAction,
      bedId: 'R1',
      patient: mockPatient,
    });

    dispatch('clear');
    expect(onAction).toHaveBeenCalledWith('clear', 'R1', mockPatient);
  });

  it('builds bed type toggles bound to bed id', () => {
    const toggleBedType = vi.fn();
    const updateClinicalCrib = vi.fn();

    const toggles = buildPatientRowBedTypeToggles({
      bedId: 'R1',
      toggleBedType,
      updateClinicalCrib,
    });

    toggles.onToggleBedType();
    toggles.onUpdateClinicalCrib('remove');

    expect(toggleBedType).toHaveBeenCalledWith('R1');
    expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'remove');
  });
});
