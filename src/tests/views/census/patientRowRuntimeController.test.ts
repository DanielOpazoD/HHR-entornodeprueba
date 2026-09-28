// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowInteractionRuntime,
  buildPatientRowActionDispatcher,
  buildPatientRowBedTypeToggles,
  buildPatientRowRuntime,
} from '@/features/census/controllers/patientRowRuntimeController';
import type { PatientData } from '@/types/domain/patient';

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

  it('builds interaction runtime with ui state, action dispatcher and bed toggles', () => {
    const onAction = vi.fn();
    const uiState = { showDemographics: false } as never;
    const bedConfigActions = { toggleBedMode: vi.fn() } as never;
    const toggleBedType = vi.fn();
    const updateClinicalCrib = vi.fn();

    const runtime = buildPatientRowInteractionRuntime({
      uiState,
      bedConfigActions,
      onAction,
      bedId: 'R1',
      patient: mockPatient,
      toggleBedType,
      updateClinicalCrib,
    });

    runtime.handleAction('move');
    runtime.bedTypeToggles.onToggleBedType();

    expect(runtime.uiState).toBe(uiState);
    expect(runtime.bedConfigActions).toBe(bedConfigActions);
    expect(onAction).toHaveBeenCalledWith('move', 'R1', mockPatient);
    expect(toggleBedType).toHaveBeenCalledWith('R1');
  });

  it('builds the final row runtime from row, interaction and editing state', () => {
    const runtime = buildPatientRowRuntime({
      rowState: {
        isCunaMode: false,
        hasCompanion: false,
        hasClinicalCrib: false,
        isBlocked: false,
        isEmpty: false,
      },
      interactionRuntime: {
        uiState: { showDemographics: false } as never,
        bedConfigActions: { toggleBedMode: vi.fn() } as never,
        handleAction: vi.fn(),
        bedTypeToggles: {
          onToggleBedType: vi.fn(),
          onUpdateClinicalCrib: vi.fn(),
        },
      },
      editingRuntime: {
        handlers: {
          mainInputChangeHandlers: {} as never,
          cribInputChangeHandlers: {} as never,
        },
        modalSavers: {
          onSaveDemographics: vi.fn(),
          onSaveCribDemographics: vi.fn(),
          onRevertEmptyDemographics: vi.fn(),
        },
      },
    });

    expect(runtime.rowState.isEmpty).toBe(false);
    expect(runtime.handleAction).toBeTypeOf('function');
    expect(runtime.modalSavers.onSaveCribDemographics).toBeTypeOf('function');
  });
});
