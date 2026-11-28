// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildPatientRowBindings } from '@/features/census/controllers/patientRowBindingsController';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

const createInputHandlers = (): PatientRowRuntime['handlers'] => ({
  mainInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    toggleDocType: vi.fn(),
    deliveryRoute: vi.fn(),
    multiple: vi.fn(),
  },
  cribInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    multiple: vi.fn(),
  },
});

const createRuntime = (overrides: Partial<PatientRowRuntime> = {}): PatientRowRuntime => ({
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
    showClinicalDocuments: false,
    showExamRequest: false,
    showImagingRequest: false,
    showHistory: false,
    openDemographics: vi.fn(),
    closeDemographics: vi.fn(),
    openClinicalDocuments: vi.fn(),
    closeClinicalDocuments: vi.fn(),
    openExamRequest: vi.fn(),
    closeExamRequest: vi.fn(),
    openImagingRequest: vi.fn(),
    closeImagingRequest: vi.fn(),
    openHistory: vi.fn(),
    closeHistory: vi.fn(),
  },
  handlers: createInputHandlers(),
  modalSavers: {
    onSaveDemographics: vi.fn(),
    onSaveCribDemographics: vi.fn(),
    onRevertEmptyDemographics: vi.fn(),
  },
  bedConfigActions: {
    toggleBedMode: vi.fn(),
    toggleCompanionCrib: vi.fn(),
    toggleClinicalCrib: vi.fn(),
    removeClinicalCrib: vi.fn(),
  },
  handleAction: vi.fn(),
  ...overrides,
});

describe('patientRowBindingsController', () => {
  it('builds main/sub/modal bindings from runtime contract', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const data = DataFactory.createMockPatient('R1');
    const runtime = createRuntime({
      uiState: {
        ...createRuntime().uiState,
        showExamRequest: true,
      },
    });

    const result = buildPatientRowBindings({
      bed,
      bedType: BedType.MEDIA,
      data,
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      isSubRow: false,
      role: 'doctor_urgency',
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: true,
      },
      runtime,
    });

    expect(result.mainRowProps.bed).toBe(bed);
    expect(result.mainRowProps.data).toBe(data);
    expect(result.mainRowProps.onAction).toBe(runtime.handleAction);
    expect(result.mainRowProps.indicators.hasClinicalDocument).toBe(true);
    expect(result.mainRowProps.indicators.isNewAdmission).toBe(true);
    expect(result.mainRowProps.onOpenClinicalDocuments).toBe(runtime.uiState.openClinicalDocuments);
    expect(result.subRowProps.onOpenDemographics).toBe(runtime.uiState.openDemographics);
    expect(result.modalsProps.bedId).toBe('R1');
    expect(result.modalsProps.onSaveDemographics).toBe(runtime.modalSavers.onSaveDemographics);
    expect(result.modalsProps.showClinicalDocuments).toBe(false);
    expect(result.modalsProps.canOpenClinicalDocuments).toBe(true);
    expect(result.modalsProps.canOpenExamRequest).toBe(true);
    expect(result.modalsProps.canOpenImagingRequest).toBe(true);
    expect(result.modalsProps.canOpenHistory).toBe(true);
  });

  it.each([
    {
      role: 'viewer',
      accessProfile: 'default',
      blocked: false,
      documents: false,
      history: true,
      arbitraryDate: false,
    },
    {
      role: 'doctor_specialist',
      accessProfile: 'specialist',
      blocked: false,
      documents: true,
      history: false,
      arbitraryDate: false,
    },
    {
      role: 'admin',
      accessProfile: 'default',
      blocked: true,
      documents: false,
      history: true,
      arbitraryDate: true,
    },
  ] as const)(
    'uses the same permissions for row actions and open dialogs ($role, blocked=$blocked)',
    ({ role, accessProfile, blocked, documents, history, arbitraryDate }) => {
      const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
      const runtime = createRuntime();
      const { mainRowProps, modalsProps } = buildPatientRowBindings({
        bed,
        bedType: bed.type,
        data: DataFactory.createMockPatient(bed.id),
        currentDateString: '2026-02-15',
        readOnly: false,
        actionMenuAlign: 'top',
        isSubRow: false,
        role,
        accessProfile,
        indicators: { hasClinicalDocument: true, isNewAdmission: true },
        runtime: {
          ...runtime,
          rowState: { ...runtime.rowState, isBlocked: blocked, hasCompanion: true },
          uiState: { ...runtime.uiState, showHistory: true, showClinicalDocuments: true },
        },
      });

      const actions = {
        canOpenClinicalDocuments: documents,
        canOpenHistory: history,
        canOpenExamRequest: true,
        canOpenImagingRequest: true,
      };
      expect(mainRowProps.mainRowViewState.rowActionsAvailability).toMatchObject(actions);
      expect(modalsProps).toMatchObject({
        ...actions,
        showClinicalDocuments: true,
        showHistory: true,
        canUseArbitraryAdmissionDate: arbitraryDate,
      });
      expect(mainRowProps.indicators).toEqual({
        hasClinicalDocument: documents,
        isNewAdmission: true,
      });
      expect(mainRowProps.isBlocked).toBe(blocked);
      expect(mainRowProps.hasCompanion).toBe(true);
    }
  );

  it('leaves indicators off and patient actions unavailable for an empty bed', () => {
    const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
    const runtime = createRuntime();
    const { mainRowProps, modalsProps } = buildPatientRowBindings({
      bed,
      bedType: bed.type,
      data: DataFactory.createMockPatient(bed.id, { patientName: '', rut: '' }),
      currentDateString: '2026-02-15',
      readOnly: false,
      actionMenuAlign: 'top',
      isSubRow: false,
      role: 'admin',
      runtime: { ...runtime, rowState: { ...runtime.rowState, isEmpty: true } },
    });

    expect(mainRowProps.indicators).toEqual({ hasClinicalDocument: false, isNewAdmission: false });
    expect(modalsProps).toMatchObject({
      canOpenClinicalDocuments: false,
      canOpenExamRequest: false,
      canOpenImagingRequest: false,
      canOpenHistory: false,
    });
  });
});
