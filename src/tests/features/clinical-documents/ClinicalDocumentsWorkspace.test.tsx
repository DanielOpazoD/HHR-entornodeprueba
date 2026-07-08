import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/entities';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';
import * as clinicalDocumentPdfExportUseCase from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';
import type { ExportClinicalDocumentPdfOutput } from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import { ClinicalDocumentTemplateRepository } from '@/services/repositories/ClinicalDocumentTemplateRepository';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const { openClinicalDocumentBrowserPrintPreview } = vi.hoisted(() => ({
  openClinicalDocumentBrowserPrintPreview: vi.fn(async () => true),
}));

const authState = {
  user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
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

vi.mock('@/features/clinical-documents/services/clinicalDocumentPrintPdfService', () => ({
  openClinicalDocumentBrowserPrintPreview,
}));

const clinicalDocument = createClinicalDocumentDraft({
  templateId: 'epicrisis',
  hospitalId: 'hhr',
  actor: {
    uid: 'u1',
    email: 'doctor@test.com',
    displayName: 'Doctor Test',
    role: 'doctor_urgency',
  },
  episode: {
    patientRut: '11.111.111-1',
    patientName: 'Paciente Test',
    episodeKey: '11.111.111-1__2026-03-06',
    admissionDate: '2026-03-06',
    sourceDailyRecordDate: '2026-03-06',
    sourceBedId: 'R1',
    specialty: 'Medicina',
  },
  patientFieldValues: {
    nombre: 'Paciente Test',
    rut: '11.111.111-1',
    edad: '40a',
    fecnac: '1986-01-01',
    fing: '2026-03-06',
    finf: '2026-03-06',
    hinf: '10:30',
  },
  medico: 'Doctor Test',
  especialidad: 'Medicina',
});

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

vi.mock('@/services/repositories/ClinicalDocumentTemplateRepository', () => ({
  ClinicalDocumentTemplateRepository: {
    listActive: vi.fn(),
    seedDefaults: vi.fn(),
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

vi.mock('@/application/clinical-documents/clinicalDocumentPdfExportUseCase', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentPdfExportUseCase')
  >('@/application/clinical-documents/clinicalDocumentPdfExportUseCase');
  return {
    ...actual,
    executeExportClinicalDocumentPdf: vi.fn(),
  };
});

describe('ClinicalDocumentsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openClinicalDocumentBrowserPrintPreview.mockReset();
    openClinicalDocumentBrowserPrintPreview.mockResolvedValue(true);
    Object.defineProperty(globalThis.document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
    });
    authState.user = { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' };
    authState.role = 'doctor_urgency';

    vi.mocked(ClinicalDocumentTemplateRepository.listActive).mockResolvedValue([
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
    const exportResult: ApplicationOutcome<ExportClinicalDocumentPdfOutput | null> = {
      status: 'success',
      data: { pdf: { exportStatus: 'exported' } },
      issues: [],
    };
    vi.mocked(clinicalDocumentPdfExportUseCase.executeExportClinicalDocumentPdf).mockResolvedValue(
      exportResult
    );
  });

  it('renders the real shell and wires create/print/drive through use-case boundaries', async () => {
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
    antecedentesEditor.innerHTML = 'Antecedentes actualizados';
    fireEvent.input(antecedentesEditor);
    fireEvent.click(screen.getByRole('button', { name: /^crear documento$/i }));

    await waitFor(() => {
      expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /epicrisis/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /pdf/i }));

    await waitFor(() => {
      expect(openClinicalDocumentBrowserPrintPreview).toHaveBeenCalled();
      expect(
        clinicalDocumentPdfExportUseCase.executeExportClinicalDocumentPdf
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            id: clinicalDocument.id,
            status: 'draft',
          }),
          hospitalId: 'hhr',
          fileName: expect.any(String),
        })
      );
      expect(notificationApi.info).not.toHaveBeenCalled();
    });
  });

  it('supports manual drive upload on the real shell boundary', async () => {
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /drive/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /drive/i }));

    await waitFor(() => {
      expect(
        clinicalDocumentPdfExportUseCase.executeExportClinicalDocumentPdf
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            id: clinicalDocument.id,
          }),
          hospitalId: 'hhr',
          fileName: expect.any(String),
        })
      );
    });
  });

  it('wires specialist author delete from the workspace model into the sidebar action', async () => {
    authState.role = 'doctor_specialist';
    const authoredDocument: ClinicalDocumentRecord = {
      ...clinicalDocument,
      title: 'Evolución médica 25/05/2026',
      isActiveEpisodeDocument: true,
      isLocked: false,
      audit: {
        ...clinicalDocument.audit,
        createdBy: {
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Doctor Test',
          role: 'doctor_specialist',
        },
      },
    };
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisode).mockImplementation(
      (_episodeKey, callback) => {
        callback([authoredDocument]);
        return vi.fn();
      }
    );
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (_episodeKeys, callback) => {
        callback([authoredDocument]);
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
      expect(screen.getAllByText('Evolución médica 25/05/2026')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTitle(/eliminar documento/i));

    await waitFor(() => {
      expect(clinicalDocumentUseCases.executeDeleteClinicalDocument).toHaveBeenCalledWith(
        authoredDocument.id,
        'hhr',
        expect.objectContaining({ templateId: authoredDocument.templateId })
      );
    });
  });

  it('hides the sidebar and increases the sheet zoom for editing', async () => {
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/tipo de documento/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('clinical-document-sheet-zoom-layer')).toHaveStyle({
      transform: 'scale(1.1)',
    });

    fireEvent.click(screen.getByRole('button', { name: /ocultar panel lateral/i }));

    expect(screen.queryByText(/tipo de documento/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mostrar panel lateral/i })).toBeInTheDocument();
    expect(screen.getByTestId('clinical-document-sheet-zoom-layer')).toHaveStyle({
      transform: 'scale(1.3)',
    });

    fireEvent.click(screen.getByRole('button', { name: /mostrar panel lateral/i }));

    expect(screen.getByText(/tipo de documento/i)).toBeInTheDocument();
    expect(screen.getByTestId('clinical-document-sheet-zoom-layer')).toHaveStyle({
      transform: 'scale(1.1)',
    });
  });

  it('allows hiding and restoring sections on the real shell boundary', async () => {
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Antecedentes' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Antecedentes' }));
    fireEvent.click(screen.getByRole('button', { name: /eliminar sección antecedentes/i }));
    expect(
      screen.getByRole('button', { name: /restaurar sección: antecedentes/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restaurar sección: antecedentes/i }));
    expect(
      screen.getByRole('button', { name: /eliminar sección antecedentes/i })
    ).toBeInTheDocument();
  });

  it('closes advanced formatting on double click outside editable fields', async () => {
    render(
      <ClinicalDocumentsWorkspace
        patient={workspacePatient}
        currentDateString="2026-03-06"
        bedId="R1"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Formato' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Formato' }));
    expect(screen.getByText('Formato de texto')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('clinical-documents-workspace'));

    await waitFor(() => {
      expect(screen.queryByText('Formato de texto')).not.toBeInTheDocument();
    });
  });
});
