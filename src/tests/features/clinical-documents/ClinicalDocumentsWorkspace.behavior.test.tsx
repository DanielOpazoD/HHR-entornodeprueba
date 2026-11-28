vi.mock(
  '@/features/clinical-documents/controllers/clinicalDocumentTemplateController',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@/features/clinical-documents/controllers/clinicalDocumentTemplateController')
    >()),
    listActiveClinicalDocumentTemplates: vi.fn(),
  })
);
import { listActiveClinicalDocumentTemplates } from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';
import { buildDocument } from './useClinicalDocumentWorkspaceBootstrap.fixtures';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const { openClinicalDocumentBrowserPrintPreview } = vi.hoisted(() => ({
  openClinicalDocumentBrowserPrintPreview: vi.fn(async () => true),
}));

const authState = {
  currentUser: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
  role: 'doctor_urgency',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}));

const notificationApi = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
};

vi.mock('@/context/UIContext', () => ({
  useNotification: () => notificationApi,
}));

vi.mock('@/constants/firestorePaths', async importOriginal => {
  const actual = await importOriginal<typeof import('@/constants/firestorePaths')>();
  return {
    ...actual,
    getActiveHospitalId: () => 'hhr',
  };
});

vi.mock('@/features/clinical-documents/services/clinicalDocumentBrowserPrintService', () => ({
  openClinicalDocumentBrowserPrintPreview,
}));

const clinicalDocument = buildDocument();

clinicalDocument.sections = clinicalDocument.sections.map(section => ({
  ...section,
  content: `${section.title} completo`,
}));

const workspacePatient: PatientData = {
  bedId: 'R1',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  age: '40a',
  birthDate: '1986-01-01',
  pathology: 'Diagnostico de prueba',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-06',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
};

const activeTemplate: ClinicalDocumentTemplate = {
  id: 'epicrisis',
  name: 'Epicrisis',
  title: 'Epicrisis médica',
  version: 1,
  patientFields: [],
  sections: [],
  allowCustomTitle: false,
  allowAddSection: false,
  allowClinicalUpdateSections: false,
  status: 'active',
  documentType: 'epicrisis',
  defaultPatientInfoTitle: 'Información del Paciente',
  defaultFooterMedicoLabel: 'Médico',
  defaultFooterEspecialidadLabel: 'Especialidad',
};

const secondaryTemplate: ClinicalDocumentTemplate = {
  id: 'evolucion',
  name: 'Evolución',
  title: 'Evolución médica',
  version: 1,
  patientFields: [],
  sections: [],
  allowCustomTitle: false,
  allowAddSection: false,
  allowClinicalUpdateSections: false,
  status: 'active',
  documentType: 'evolucion',
  defaultPatientInfoTitle: 'Información del Paciente',
  defaultFooterMedicoLabel: 'Médico',
  defaultFooterEspecialidadLabel: 'Especialidad',
};

vi.mock('@/services/repositories/ClinicalDocumentRepository', () => ({
  ClinicalDocumentRepository: {
    subscribeByEpisode: vi.fn(),
    subscribeByEpisodeKeys: vi.fn(),
  },
}));

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >('@/application/clinical-documents/clinicalDocumentUseCases');
  return {
    ...actual,
    executeCreateClinicalDocumentDraft: vi.fn(),
    executePersistClinicalDocumentDraft: vi.fn(),
    executeDeleteClinicalDocument: vi.fn(),
  };
});

describe('ClinicalDocumentsWorkspace behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openClinicalDocumentBrowserPrintPreview.mockReset();
    openClinicalDocumentBrowserPrintPreview.mockResolvedValue(true);
    Object.defineProperty(globalThis.document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
    });
    authState.currentUser = { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' };
    authState.role = 'doctor_urgency';

    vi.mocked(listActiveClinicalDocumentTemplates).mockReturnValue([
      activeTemplate,
      secondaryTemplate,
    ]);

    vi.mocked(ClinicalDocumentRepository.subscribeByEpisode).mockImplementation(
      (_episodeKey, callback) => {
        callback([clinicalDocument]);
        return vi.fn();
      }
    );
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        callback([clinicalDocument]);
        return vi.fn();
      }
    );

    const createDraftResult: ApplicationOutcome<ClinicalDocumentRecord | null> = {
      status: 'success',
      data: { ...clinicalDocument, id: 'new-doc' },
      issues: [],
    };
    vi.mocked(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).mockResolvedValue(
      createDraftResult
    );
    const persistDraftResult: ApplicationOutcome<ClinicalDocumentRecord | null> = {
      status: 'success',
      data: clinicalDocument,
      issues: [],
    };
    vi.mocked(clinicalDocumentUseCases.executePersistClinicalDocumentDraft).mockResolvedValue(
      persistDraftResult
    );
    const deleteResult: ApplicationOutcome<null> = {
      status: 'success',
      data: null,
      issues: [],
    };
    vi.mocked(clinicalDocumentUseCases.executeDeleteClinicalDocument).mockResolvedValue(
      deleteResult
    );
  });

  it('distinguishes a pending read, denied access, retry and a confirmed empty episode', async () => {
    const subscribe = vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys);
    subscribe.mockImplementation(() => () => {});
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );
    const emptyText = /No hay documentos clínicos para este episodio/i;
    expect(screen.getByText(/Cargando documentos del episodio/)).toBeInTheDocument();
    const first = subscribe.mock.calls.at(-1)!;
    act(() => first[1]([], false));
    expect(screen.queryByText(emptyText)).toBeNull();
    act(() => first[3]?.(Object.assign(new Error('synthetic'), { code: 'permission-denied' })));
    expect(screen.getByText(/No se pudieron actualizar los documentos/)).toBeInTheDocument();
    expect(screen.queryByText(emptyText)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    const retry = subscribe.mock.calls.at(-1)!;
    expect(retry).not.toBe(first);
    act(() => retry[1]([], true));
    expect(screen.getByText(emptyText)).toBeInTheDocument();
  });

  it('renders read-only sheet actions for nurse role', async () => {
    authState.currentUser = { uid: 'n1', email: 'nurse@test.com', displayName: 'Nurse Test' };
    authState.role = 'nurse_hospital';

    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Doctor Test')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /drive/i })).not.toBeInTheDocument();
  });

  it('blocks editing for non-admin users when the episode is closed', async () => {
    authState.currentUser = {
      uid: 's1',
      email: 'specialist@test.com',
      displayName: 'Specialist Test',
    };
    authState.role = 'doctor_specialist';

    render(
      <ClinicalDocumentsWorkspace
        patient={{
          ...workspacePatient,
          dischargeDate: '2026-03-08',
          episodeClosureKind: 'discharge',
        }}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/episodio cerrado por alta/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^crear documento$/i })).toBeDisabled();
    expect(screen.queryByTitle(/eliminar documento/i)).not.toBeInTheDocument();
  });

  it('keeps admin editing enabled on closed episodes', async () => {
    authState.currentUser = { uid: 'a1', email: 'admin@test.com', displayName: 'Admin Test' };
    authState.role = 'admin';

    render(
      <ClinicalDocumentsWorkspace
        patient={{
          ...workspacePatient,
          transferDate: '2026-03-08',
          episodeClosureKind: 'transfer',
        }}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^crear documento$/i })).toBeEnabled();
    });

    expect(screen.queryByText(/episodio cerrado/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/eliminar documento/i)).toBeInTheDocument();
  });

  it('updates the open document to the newly selected template type', async () => {
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Doctor Test')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /tipo de documento/i }), {
      target: { value: 'evolucion' },
    });

    await waitFor(() => {
      expect(screen.getAllByText(/evoluci[oó]n/i).length).toBeGreaterThan(0);
    });
  });

  it('keeps the current draft visible when a stale remote subscription arrives over local changes', async () => {
    let subscriptionCallback: ((docs: ClinicalDocumentRecord[]) => void) | null = null;
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        subscriptionCallback = callback;
        callback([clinicalDocument]);
        return vi.fn();
      }
    );

    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Doctor Test')).toBeInTheDocument();
    });

    const antecedentesEditor = screen.getByRole('textbox', { name: /contenido antecedentes/i });
    antecedentesEditor.innerHTML = 'Cambio local sin guardar';
    fireEvent.input(antecedentesEditor);

    expect(subscriptionCallback).toBeTruthy();
    await act(async () => {
      subscriptionCallback?.([
        {
          ...clinicalDocument,
          audit: {
            ...clinicalDocument.audit,
            updatedAt: '2026-03-06T12:00:00.000Z',
          },
          sections: clinicalDocument.sections.map(section =>
            section.id === 'antecedentes'
              ? { ...section, content: 'Cambio remoto pendiente' }
              : section
          ),
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText('Cambio local sin guardar')).toBeInTheDocument();
      expect(screen.queryByText(/actualización remota pendiente/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /recargar remoto/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /descartar local/i })).not.toBeInTheDocument();
    });
  });

  it('keeps staged remote updates out of manual overwrite controls', async () => {
    let subscriptionCallback: ((docs: ClinicalDocumentRecord[]) => void) | null = null;
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        subscriptionCallback = callback;
        callback([clinicalDocument]);
        return vi.fn();
      }
    );

    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Doctor Test')).toBeInTheDocument();
    });

    const antecedentesEditor = screen.getByRole('textbox', { name: /contenido antecedentes/i });
    antecedentesEditor.innerHTML = 'Cambio local temporal';
    fireEvent.input(antecedentesEditor);

    await act(async () => {
      subscriptionCallback?.([
        {
          ...clinicalDocument,
          audit: {
            ...clinicalDocument.audit,
            updatedAt: '2026-03-06T12:15:00.000Z',
          },
          sections: clinicalDocument.sections.map(section =>
            section.id === 'antecedentes'
              ? { ...section, content: 'Cambio remoto definitivo' }
              : section
          ),
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText('Cambio local temporal')).toBeInTheDocument();
      expect(screen.queryByText(/actualización remota pendiente/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /recargar remoto/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /descartar local/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Cambio remoto definitivo')).not.toBeInTheDocument();
    });
  });
});
