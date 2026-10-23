import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import * as templateUseCases from '@/application/clinical-documents/clinicalDocumentTemplateUseCases';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';

import {
  buildDocument,
  localTemplate,
  patient,
  remoteTemplate,
} from './useClinicalDocumentWorkspaceBootstrap.fixtures';

const controllerMocks = vi.hoisted(() => ({
  listActiveClinicalDocumentTemplates: vi.fn(),
  buildClinicalDocumentEpisodeContext: vi.fn(),
  hydrateClinicalDocumentWorkspaceRecord: vi.fn(),
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentTemplateController', () => ({
  listActiveClinicalDocumentTemplates: controllerMocks.listActiveClinicalDocumentTemplates,
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentEpisodeController', () => ({
  buildClinicalDocumentEpisodeContext: controllerMocks.buildClinicalDocumentEpisodeContext,
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController', () => ({
  hydrateClinicalDocumentWorkspaceRecord: controllerMocks.hydrateClinicalDocumentWorkspaceRecord,
}));

vi.mock('@/application/clinical-documents/clinicalDocumentTemplateUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentTemplateUseCases')
  >('@/application/clinical-documents/clinicalDocumentTemplateUseCases');
  return {
    ...actual,
    executeListActiveClinicalDocumentTemplates: vi.fn(),
    executeSeedClinicalDocumentTemplates: vi.fn(),
  };
});

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >('@/application/clinical-documents/clinicalDocumentUseCases');
  return {
    ...actual,
    subscribeClinicalDocumentsByEpisodeKeys: vi.fn(),
  };
});

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: vi.fn(),
}));

describe('useClinicalDocumentWorkspaceBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockReset();
    vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockReset();
    controllerMocks.listActiveClinicalDocumentTemplates.mockReturnValue([localTemplate]);
    controllerMocks.buildClinicalDocumentEpisodeContext.mockReturnValue({
      episodeKey: '11.111.111-1__2026-03-06',
      documentLookupEpisodeKeys: ['11111111-1__2026-03-06'],
      sourceDailyRecordDate: '2026-03-06',
      specialty: 'Medicina',
    });
    controllerMocks.hydrateClinicalDocumentWorkspaceRecord.mockImplementation(document => document);
    vi.mocked(templateUseCases.executeListActiveClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [remoteTemplate],
      issues: [],
    });
    vi.mocked(templateUseCases.executeSeedClinicalDocumentTemplates).mockResolvedValue({
      status: 'success',
      data: [localTemplate],
      issues: [],
    });
    vi.mocked(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        callback([buildDocument()]);
        return vi.fn();
      }
    );
  });

  it.each([
    { isActive: false, canRead: true },
    { isActive: true, canRead: false },
  ])('does not load remote data for $isActive activity and $canRead readability', async flags => {
    renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        ...flags,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
      })
    );

    await Promise.resolve();

    expect(templateUseCases.executeListActiveClinicalDocumentTemplates).not.toHaveBeenCalled();
    expect(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).not.toHaveBeenCalled();
  });

  it('loads remote templates and hydrates subscription documents', async () => {
    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        isActive: true,
        canRead: true,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
      })
    );

    await waitFor(() => {
      expect(result.current.templates).toEqual([remoteTemplate]);
      expect(result.current.documents).toHaveLength(1);
      expect(result.current.selectedDocumentId).toBe(result.current.documents[0]?.id);
    });

    expect(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).toHaveBeenCalledWith(
      ['11.111.111-1__2026-03-06', '11111111-1__2026-03-06'],
      expect.any(Function),
      'hhr'
    );
  });

  it('ignores legacy alternate-key documents when the current patient has a canonical episode id', async () => {
    controllerMocks.buildClinicalDocumentEpisodeContext.mockReturnValue({
      episodeKey: 'episode-current-patient',
      documentLookupEpisodeKeys: ['11.111.111-1__2026-03-06'],
      patientRut: '11.111.111-1',
      sourceDailyRecordDate: '2026-03-06',
      specialty: 'Medicina',
    });
    vi.mocked(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        callback([
          buildDocument({
            id: 'old-bed-doc',
            episodeKey: '11.111.111-1__2026-03-06',
            patientName: 'Paciente anterior',
          }),
          buildDocument({
            id: 'current-doc',
            episodeKey: 'episode-current-patient',
            patientName: 'Paciente Test',
          }),
        ]);
        return vi.fn();
      }
    );

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        isActive: true,
        canRead: true,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
      })
    );

    await waitFor(() => {
      expect(result.current.documents.map(document => document.id)).toEqual(['current-doc']);
      expect(result.current.selectedDocumentId).toBe('current-doc');
    });
  });

  it('clears documents immediately when the bed changes to a different patient episode', async () => {
    controllerMocks.buildClinicalDocumentEpisodeContext.mockImplementation((nextPatient: never) => {
      const rut = (nextPatient as { rut?: string }).rut;
      return rut === '22.222.222-2'
        ? {
            episodeKey: 'ep_new_patient',
            documentLookupEpisodeKeys: [],
            patientRut: '22.222.222-2',
            sourceDailyRecordDate: '2026-03-06',
            specialty: 'Medicina',
          }
        : {
            episodeKey: 'ep_old_patient',
            documentLookupEpisodeKeys: [],
            patientRut: '11.111.111-1',
            sourceDailyRecordDate: '2026-03-06',
            specialty: 'Medicina',
          };
    });
    vi.mocked(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).mockImplementation(
      (episodeKeys, callback) => {
        if (episodeKeys.includes('ep_old_patient')) {
          callback([
            buildDocument({
              id: 'old-patient-doc',
              episodeKey: 'ep_old_patient',
              patientName: 'Paciente anterior',
            }),
          ]);
        }
        return vi.fn();
      }
    );

    const { result, rerender } = renderHook(
      ({ hookPatient }) =>
        useClinicalDocumentWorkspaceBootstrap({
          patient: hookPatient as never,
          currentDateString: '2026-03-06',
          bedId: 'R1',
          isActive: true,
          canRead: true,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
        }),
      { initialProps: { hookPatient: patient } }
    );

    await waitFor(() => {
      expect(result.current.documents.map(document => document.id)).toEqual(['old-patient-doc']);
      expect(result.current.selectedDocumentId).toBe('old-patient-doc');
    });

    rerender({
      hookPatient: {
        ...patient,
        patientName: 'Paciente Nuevo',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'ep_new_patient',
      },
    });

    await waitFor(() => {
      expect(result.current.documents).toEqual([]);
      expect(result.current.selectedDocumentId).toBeNull();
    });
  });

  it('keeps the selected document when the subscription still contains it', async () => {
    let subscriptionCallback: ((docs: ReturnType<typeof buildDocument>[]) => void) | null = null;
    const primary = buildDocument();
    const secondary = { ...buildDocument(), id: 'secondary-doc' };
    vi.mocked(clinicalDocumentUseCases.subscribeClinicalDocumentsByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        subscriptionCallback = callback as typeof subscriptionCallback;
        callback([primary, secondary]);
        return vi.fn();
      }
    );

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceBootstrap({
        patient: patient as never,
        currentDateString: '2026-03-06',
        bedId: 'R1',
        isActive: true,
        canRead: true,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
      })
    );

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(2);
    });

    act(() => {
      result.current.setSelectedDocumentId('secondary-doc');
    });

    act(() => {
      subscriptionCallback?.([{ ...secondary, title: 'Documento actualizado' }, primary]);
    });

    expect(result.current.selectedDocumentId).toBe('secondary-doc');
  });
});
