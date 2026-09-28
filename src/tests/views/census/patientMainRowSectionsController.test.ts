// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { BEDS } from '@/constants/beds';
import { buildPatientActionSectionBinding } from '@/features/census/controllers/patientRowActionSectionBindingsController';
import { buildPatientMainRowSections } from '@/features/census/controllers/patientMainRowSectionsController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientMainRowSectionsController', () => {
  it('builds visual row sections from main row props', () => {
    const props = {
      bed: BEDS[0],
      bedType: BEDS[0].type,
      data: DataFactory.createMockPatient('R1'),
      currentDateString: '2026-03-05',
      readOnly: false,
      actionMenuAlign: 'top' as const,
      diagnosisMode: 'free' as const,
      isBlocked: false,
      isEmpty: false,
      hasCompanion: true,
      hasClinicalCrib: false,
      isCunaMode: false,
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
      onToggleMode: vi.fn(),
      onToggleCompanion: vi.fn(),
      onToggleClinicalCrib: vi.fn(),
      onToggleBedType: vi.fn(),
      onUpdateClinicalCrib: vi.fn(),
      onChange: {
        text: vi.fn(),
        check: vi.fn(),
        devices: vi.fn(),
        deviceDetails: vi.fn(),
        deviceHistory: vi.fn(),
        toggleDocType: vi.fn(),
        deliveryRoute: vi.fn(),
        multiple: vi.fn(),
      },
    };

    const action = buildPatientActionSectionBinding(props);
    const sections = buildPatientMainRowSections(props, action);

    expect(sections.action).toBe(action);
    expect(sections.bedConfig.bed).toBe(props.bed);
    expect(sections.bedType.bedId).toBe(props.bed.id);
    expect(sections.inputCells.data).toBe(props.data);
    expect(sections.blocked.blockedReason).toBe(props.data.blockedReason);
  });
});
