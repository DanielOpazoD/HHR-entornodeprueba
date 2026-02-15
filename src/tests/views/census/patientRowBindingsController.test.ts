import { describe, expect, it, vi } from 'vitest';

import { buildPatientRowBindings } from '@/features/census/controllers/patientRowBindingsController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types';

describe('patientRowBindingsController', () => {
  it('builds main/sub/modal bindings from runtime contract', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = {
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
        mainInputChangeHandlers: {} as any,
        cribInputChangeHandlers: {} as any,
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
    };

    const result = buildPatientRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      diagnosisMode: 'free',
      isSubRow: false,
      runtime: runtime as any,
    });

    expect(result.mainRowProps.bed).toBe(bed);
    expect(result.mainRowProps.data).toBe(data);
    expect(result.mainRowProps.onAction).toBe(runtime.handleAction);
    expect(result.subRowProps.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(result.modalsProps.bedId).toBe('R1');
    expect(result.modalsProps.onSaveDemographics).toBe(runtime.modalSavers.onSaveDemographics);
  });
});
