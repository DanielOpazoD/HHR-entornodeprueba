import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';
import {
  createClinicalDocumentDraft,
  getClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/factories';
import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import { ClinicalDocumentTemplateRepository } from '@/services/repositories/ClinicalDocumentTemplateRepository';
import { DataFactory } from '@/tests/factories/DataFactory';

const { getLabResults, searchSyslabExams, fetchSyslabExamDetails, buildLabSummaryText } =
  vi.hoisted(() => ({
    getLabResults: vi.fn(),
    searchSyslabExams: vi.fn(),
    fetchSyslabExamDetails: vi.fn(),
    buildLabSummaryText: vi.fn(),
  }));
const authState = { role: 'doctor_urgency' };
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'doctor', email: 'doctor@example.test' }, role: authState.role }),
}));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/services/repositories/ClinicalDocumentRepository', () => ({
  ClinicalDocumentRepository: { subscribeByEpisodeKeys: vi.fn() },
}));
vi.mock('@/services/repositories/ClinicalDocumentTemplateRepository', () => ({
  ClinicalDocumentTemplateRepository: { listActive: vi.fn() },
}));
vi.mock('@/features/clinical-documents/services/clinicalDocumentSignatureProfileService', () => ({
  clinicalDocumentSignatureProfileService: { getProfile: vi.fn(async () => null) },
}));
vi.mock('@/features/clinical-documents/hooks/useClinicalAttachments', () => ({
  useClinicalAttachments: () => ({
    attachments: [],
    patientAttachments: [],
    isLoadingAttachments: false,
    isLoadingPatientAttachments: false,
    isUploadingAttachment: false,
  }),
}));
vi.mock('@/features/laboratory', () => ({ getLabResults, buildLabSummaryText }));
vi.mock('@/services/laboratory/syslabService', () => ({
  searchSyslabExams,
  fetchSyslabExamDetails,
}));
vi.mock('@/services/radiology/mmradService', () => ({
  searchMMRADExams: vi.fn(async () => ({ examenes: [] })),
}));
vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >()),
  executePersistClinicalDocumentDraft: vi.fn(async () => ({
    status: 'success',
    data: null,
    issues: [],
  })),
}));

const date = '2026-03-06';
const patients = ['11.111.111-1', '22.222.222-2'].map((rut, index) =>
  DataFactory.createMockPatient(`R${index + 1}`, {
    rut,
    patientName: `Paciente ${index}`,
    admissionDate: date,
  })
);
const documents = [0, 0, 1].map((patientIndex, index) => ({
  ...createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'doctor',
      email: 'doctor@example.test',
      displayName: 'Doctor',
      role: 'doctor_urgency',
    },
    episode: buildClinicalDocumentEpisodeContext(
      patients[patientIndex],
      date,
      patients[patientIndex].bedId
    ),
    patientFieldValues: {
      nombre: patients[patientIndex].patientName,
      rut: patients[patientIndex].rut,
    },
    medico: 'Doctor',
    especialidad: 'Medicina',
  }),
  id: `document-${index}`,
  title: `Documento ${index}`,
}));
const workspace = (patient = patients[0], isActive = true) => (
  <ClinicalDocumentsWorkspace
    patient={patient}
    currentDateString={date}
    bedId={patient.bedId}
    isActive={isActive}
  />
);
const openDialog = async (kind: 'lab' | 'mmrad') => {
  await within(screen.getByRole('complementary')).findByRole('button', { name: /^Documento 0/ });
  fireEvent.click(screen.getByRole('button', { name: /insertar contenido/i }));
  fireEvent.click(
    screen.getByRole('button', { name: kind === 'lab' ? /^laboratorio$/i : /imagenología mmrad/i })
  );
  await screen.findByText(kind === 'lab' ? 'Insertar Laboratorio' : 'Copiar informe MMRAD');
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('ClinicalDocumentsWorkspace external dialog context isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'doctor_urgency';
    vi.mocked(ClinicalDocumentTemplateRepository.listActive).mockResolvedValue([
      getClinicalDocumentTemplate('epicrisis'),
    ]);
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (keys, callback) => {
        callback(documents.filter(document => keys.includes(document.episodeKey)));
        return vi.fn();
      }
    );
    getLabResults.mockResolvedValue({ exams: {} });
    searchSyslabExams.mockResolvedValue({ success: true, data: [] });
    buildLabSummaryText.mockReturnValue('Resultado tardío del documento anterior');
    fetchSyslabExamDetails.mockReset();
  });

  it.each(['lab', 'mmrad'] as const)(
    'closes %s on document change and does not reopen it when returning',
    async kind => {
      render(workspace());
      await openDialog(kind);
      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', { name: /^Documento 1/ })
      );
      expect(
        screen.queryByText(kind === 'lab' ? 'Insertar Laboratorio' : 'Copiar informe MMRAD')
      ).not.toBeInTheDocument();
      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', { name: /^Documento 0/ })
      );
      expect(
        screen.queryByText(kind === 'lab' ? 'Insertar Laboratorio' : 'Copiar informe MMRAD')
      ).not.toBeInTheDocument();
    }
  );

  it.each(['patient', 'episode', 'inactive', 'read-only'] as const)(
    'closes the open dialog on %s context change',
    async change => {
      const { rerender } = render(workspace());
      await openDialog('lab');
      if (change === 'read-only') authState.role = 'nurse_hospital';
      const nextPatient =
        change === 'patient'
          ? patients[1]
          : change === 'episode'
            ? { ...patients[0], clinicalEpisodeId: 'next-synthetic-episode' }
            : patients[0];
      rerender(workspace(nextPatient, change !== 'inactive'));
      expect(screen.queryByText('Insertar Laboratorio')).not.toBeInTheDocument();
    }
  );

  it('discards pending lab details after selecting a different document in the same episode', async () => {
    const detail = deferred<{
      success: boolean;
      data: { findings: { examName: string; value: string }[] }[];
    }>();
    searchSyslabExams.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'synthetic-exam',
          date: '06/03/2026',
          time: '10:30:00',
          link: 'https://syslab.example.test/exam',
        },
      ],
    });
    fetchSyslabExamDetails.mockReturnValue(detail.promise);
    render(workspace());
    await openDialog('lab');
    fireEvent.click(await screen.findByRole('button', { name: /06\/03\/2026 10:30/ }));
    await waitFor(() => expect(fetchSyslabExamDetails).toHaveBeenCalledOnce());
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /^Documento 1/ })
    );
    await act(async () => {
      detail.resolve({ success: true, data: [{ findings: [{ examName: 'Hb', value: '13' }] }] });
    });
    expect(screen.queryByText('Resultado tardío del documento anterior')).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /^Documento 0/ })
    );
    expect(screen.queryByText('Resultado tardío del documento anterior')).not.toBeInTheDocument();
  });
});
