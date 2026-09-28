// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildPatientActionSectionBinding } from '@/features/census/controllers/patientRowActionSectionBindingsController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientRowActionSectionBindingsController', () => {
  it('maps row action availability into action cell callbacks', () => {
    const onOpenClinicalDocuments = vi.fn();
    const onOpenExamRequest = vi.fn();

    const binding = buildPatientActionSectionBinding({
      isBlocked: false,
      readOnly: false,
      actionMenuAlign: 'top',
      data: DataFactory.createMockPatient('R1', {
        admissionDate: '2026-03-03',
      }),
      currentDateString: '2026-03-05',
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: false,
      },
      mainRowViewState: {
        canToggleBedType: true,
        rowClassName: 'row',
        rowActionsAvailability: {
          canOpenClinicalDocuments: true,
          canOpenExamRequest: false,
          canOpenImagingRequest: false,
          canOpenHistory: true,
          canShowClinicalDocumentIndicator: true,
        },
        showBlockedContent: false,
      },
      onAction: vi.fn(),
      onOpenDemographics: vi.fn(),
      onOpenClinicalDocuments,
      onOpenExamRequest,
      onOpenImagingRequest: vi.fn(),
      onOpenHistory: vi.fn(),
    });

    expect(binding.onViewClinicalDocuments).toBe(onOpenClinicalDocuments);
    expect(binding.onViewExamRequest).toBeUndefined();
    expect(binding.hasClinicalDocument).toBe(true);
    expect(binding.showCmaAction).toBe(false);
  });

  it('builds medical indications patient only when the row has real identity data', () => {
    const baseParams = {
      isBlocked: false,
      readOnly: false,
      actionMenuAlign: 'top',
      currentDateString: '2026-03-05',
      indicators: {
        hasClinicalDocument: false,
        isNewAdmission: true,
      },
      mainRowViewState: {
        canToggleBedType: true,
        rowClassName: 'row',
        rowActionsAvailability: {
          canOpenClinicalDocuments: true,
          canOpenExamRequest: true,
          canOpenImagingRequest: true,
          canOpenHistory: true,
          canShowClinicalDocumentIndicator: true,
        },
        showBlockedContent: false,
      },
      onAction: vi.fn(),
      onOpenDemographics: vi.fn(),
      onOpenClinicalDocuments: vi.fn(),
      onOpenExamRequest: vi.fn(),
      onOpenImagingRequest: vi.fn(),
      onOpenHistory: vi.fn(),
    } as const;

    const namedBinding = buildPatientActionSectionBinding({
      ...baseParams,
      data: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente Uno',
        admissionDate: '2026-03-05',
      }),
    });

    expect(namedBinding.medicalIndicationsPatient?.label).toContain('Paciente Uno');

    const unnamedBinding = buildPatientActionSectionBinding({
      ...baseParams,
      data: DataFactory.createMockPatient('R2', {
        patientName: '',
        rut: '',
        admissionDate: '2026-03-05',
      }),
    });

    expect(unnamedBinding.medicalIndicationsPatient).toBeUndefined();
  });

  it('does not expose identity-driven actions for whitespace-only activation placeholders', () => {
    const binding = buildPatientActionSectionBinding({
      isBlocked: false,
      readOnly: false,
      actionMenuAlign: 'top',
      data: DataFactory.createMockPatient('R4', {
        patientName: ' ',
        rut: '',
        admissionDate: '2026-03-05',
      }),
      currentDateString: '2026-03-05',
      indicators: {
        hasClinicalDocument: false,
        isNewAdmission: true,
      },
      mainRowViewState: {
        canToggleBedType: true,
        rowClassName: 'row',
        rowActionsAvailability: {
          canOpenClinicalDocuments: true,
          canOpenExamRequest: true,
          canOpenImagingRequest: true,
          canOpenHistory: true,
          canShowClinicalDocumentIndicator: true,
        },
        showBlockedContent: false,
      },
      onAction: vi.fn(),
      onOpenDemographics: vi.fn(),
      onOpenClinicalDocuments: vi.fn(),
      onOpenExamRequest: vi.fn(),
      onOpenImagingRequest: vi.fn(),
      onOpenHistory: vi.fn(),
    });

    expect(binding.hasPatientIdentity).toBe(false);
    expect(binding.onViewMedicalIndications).toBeUndefined();
    expect(binding.medicalIndicationsPatient).toBeUndefined();
  });

  it('forwards the current clinical document count to the action cell binding', () => {
    const binding = buildPatientActionSectionBinding({
      isBlocked: false,
      readOnly: false,
      actionMenuAlign: 'top',
      data: DataFactory.createMockPatient('R3', {
        patientName: 'Paciente Tres',
        admissionDate: '2026-03-05',
      }),
      currentDateString: '2026-03-05',
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: false,
      },
      mainRowViewState: {
        canToggleBedType: true,
        rowClassName: 'row',
        rowActionsAvailability: {
          canOpenClinicalDocuments: true,
          canOpenExamRequest: true,
          canOpenImagingRequest: true,
          canOpenHistory: true,
          canShowClinicalDocumentIndicator: true,
        },
        showBlockedContent: false,
      },
      onAction: vi.fn(),
      onOpenDemographics: vi.fn(),
      onOpenClinicalDocuments: vi.fn(),
      onOpenExamRequest: vi.fn(),
      onOpenImagingRequest: vi.fn(),
      onOpenHistory: vi.fn(),
      clinicalDocumentCount: 3,
    });

    expect(binding.clinicalDocumentCount).toBe(3);
  });
});
