import { describe, expect, it, vi } from 'vitest';

import {
  buildPatientMainRowBindings,
  buildPatientRowBindings,
  buildPatientRowModalsBindings,
  buildPatientSubRowBindings,
} from '@/features/census/controllers/patientRowBindingsController';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types';

const asRuntime = (value: Partial<PatientRowRuntime>): PatientRowRuntime =>
  value as unknown as PatientRowRuntime;

describe('patientRowBindingsController', () => {
  it('builds main/sub/modal bindings from runtime contract', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = asRuntime({
      bedTypeToggles: {
        onToggleBedType: vi.fn(),
        onUpdateClinicalCrib: vi.fn(),
      },
      rowState: {
        isBlocked: false,
        isEmpty: false,
        hasCompanion: false,
        hasClinicalCrib: false,
        isCunaMode: false,
      },
      uiState: {
        showDemographics: false,
        showExamRequest: true,
        showHistory: false,
        openDemographics: vi.fn(),
        closeDemographics: vi.fn(),
        openExamRequest: vi.fn(),
        closeExamRequest: vi.fn(),
        openHistory: vi.fn(),
        closeHistory: vi.fn(),
      },
      handlers: {
        mainInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['mainInputChangeHandlers'],
        cribInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['cribInputChangeHandlers'],
      },
      modalSavers: {
        onSaveDemographics: vi.fn(),
        onSaveCribDemographics: vi.fn(),
      },
      bedConfigActions: {
        toggleBedMode: vi.fn(),
        toggleCompanionCrib: vi.fn(),
        toggleClinicalCrib: vi.fn(),
      },
      handleAction: vi.fn(),
    });

    const result = buildPatientRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      isSubRow: false,
      runtime,
    });

    expect(result.mainRowProps.bed).toBe(bed);
    expect(result.mainRowProps.data).toBe(data);
    expect(result.mainRowProps.onAction).toBe(runtime.handleAction);
    expect(result.subRowProps.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(result.modalsProps.bedId).toBe('R1');
    expect(result.modalsProps.onSaveDemographics).toBe(runtime.modalSavers.onSaveDemographics);
  });

  it('builds split bindings with consistent runtime wiring', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = asRuntime({
      bedTypeToggles: {
        onToggleBedType: vi.fn(),
        onUpdateClinicalCrib: vi.fn(),
      },
      rowState: {
        isBlocked: true,
        isEmpty: false,
        hasCompanion: true,
        hasClinicalCrib: true,
        isCunaMode: false,
      },
      uiState: {
        showDemographics: true,
        showExamRequest: false,
        showHistory: true,
        openDemographics: vi.fn(),
        closeDemographics: vi.fn(),
        openExamRequest: vi.fn(),
        closeExamRequest: vi.fn(),
        openHistory: vi.fn(),
        closeHistory: vi.fn(),
      },
      handlers: {
        mainInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['mainInputChangeHandlers'],
        cribInputChangeHandlers:
          {} as unknown as PatientRowRuntime['handlers']['cribInputChangeHandlers'],
      },
      modalSavers: {
        onSaveDemographics: vi.fn(),
        onSaveCribDemographics: vi.fn(),
      },
      bedConfigActions: {
        toggleBedMode: vi.fn(),
        toggleCompanionCrib: vi.fn(),
        toggleClinicalCrib: vi.fn(),
      },
      handleAction: vi.fn(),
    });

    const main = buildPatientMainRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      runtime,
    });
    const sub = buildPatientSubRowBindings({
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      runtime,
    });
    const modals = buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      runtime,
    });

    expect(main.isBlocked).toBe(true);
    expect(main.hasCompanion).toBe(true);
    expect(sub.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(modals.showHistory).toBe(true);
  });
});
