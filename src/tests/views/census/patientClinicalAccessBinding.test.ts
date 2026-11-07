// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildPatientActionSectionBinding,
  buildPatientClinicalAccessBinding,
} from '@/features/census/controllers/patientRowActionSectionBindingsController';
import { DataFactory } from '@/tests/factories/DataFactory';

const callbacks = () => ({
  onAction: vi.fn(),
  onOpenDemographics: vi.fn(),
  onOpenClinicalDocuments: vi.fn(),
  onOpenExamRequest: vi.fn(),
  onOpenImagingRequest: vi.fn(),
  onOpenHistory: vi.fn(),
});

const binding = ({
  readOnly = false,
  isBlocked = false,
  accessProfile = 'default' as 'default' | 'specialist',
  patientName = 'Paciente de prueba',
  rut = '12.345.678-5',
} = {}) => {
  const handlers = callbacks();
  const action = buildPatientActionSectionBinding({
    isBlocked,
    readOnly,
    accessProfile,
    actionMenuAlign: 'top',
    data: DataFactory.createMockPatient('R1', {
      patientName,
      rut,
      clinicalEpisodeId: '141336',
    }),
    currentDateString: '2026-03-05',
    indicators: { hasClinicalDocument: true, isNewAdmission: false },
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
      showBlockedContent: isBlocked,
    },
    clinicalDocumentCount: 2,
    ...handlers,
  });
  return { handlers, access: buildPatientClinicalAccessBinding(action) };
};

describe('buildPatientClinicalAccessBinding', () => {
  it('offers requests and documents on an editable census', () => {
    const { handlers, access } = binding();

    expect(access).toMatchObject({
      censusDate: '2026-03-05',
      onRequestExams: handlers.onOpenExamRequest,
      onRequestImaging: handlers.onOpenImagingRequest,
      onViewClinicalDocuments: handlers.onOpenClinicalDocuments,
      clinicalDocumentCount: 2,
    });
  });

  it('keeps reading but drops requests on a read-only census', () => {
    const { handlers, access } = binding({ readOnly: true });

    expect(access?.patient.patientName).toBe('Paciente de prueba');
    expect(access?.onRequestExams).toBeUndefined();
    expect(access?.onRequestImaging).toBeUndefined();
    expect(access?.onViewClinicalDocuments).toBe(handlers.onOpenClinicalDocuments);
  });

  it('lets a specialist request on a read-only census, as the row menu does', () => {
    const { handlers, access } = binding({ readOnly: true, accessProfile: 'specialist' });

    expect(access?.onRequestExams).toBe(handlers.onOpenExamRequest);
    expect(access?.onRequestImaging).toBe(handlers.onOpenImagingRequest);
  });

  it('leaves the cell empty for a blocked bed or a bed without a patient', () => {
    expect(binding({ isBlocked: true }).access).toBeUndefined();
    expect(binding({ patientName: '', rut: '' }).access).toBeUndefined();
  });
});
