import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';
import {
  createClinicalDocumentDraft,
  getClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/factories';
import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/domain/entities';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import { ClinicalDocumentTemplateRepository } from '@/services/repositories/ClinicalDocumentTemplateRepository';
import * as attachments from '@/application/clinical-documents/clinicalAttachmentUseCases';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'doctor', email: 'doctor@example.test' },
    role: 'doctor_urgency',
  }),
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
vi.mock('@/application/clinical-documents/clinicalAttachmentUseCases', () => ({
  executeListClinicalAttachmentsByEpisode: vi.fn(),
  executeListClinicalAttachmentsByPatient: vi.fn(),
  executeUploadClinicalAttachment: vi.fn(),
  executeDeleteClinicalAttachment: vi.fn(),
  executeRenameClinicalAttachment: vi.fn(),
  executeRegenerateClinicalAttachmentAccess: vi.fn(),
  executeSuggestClinicalAttachmentDisplayName: vi.fn(),
}));

const date = '2026-03-06';
const actor = {
  uid: 'doctor',
  email: 'doctor@example.test',
  displayName: 'Doctor',
  role: 'doctor_urgency',
};
const patients = ['11.111.111-1', '22.222.222-2'].map((rut, index) =>
  DataFactory.createMockPatient(`R${index + 1}`, {
    rut,
    patientName: `Paciente ${index}`,
    admissionDate: date,
  })
);
const documents = patients.map(patient =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor,
    episode: buildClinicalDocumentEpisodeContext(patient, date, patient.bedId),
    patientFieldValues: { nombre: patient.patientName, rut: patient.rut },
    medico: 'Doctor',
    especialidad: 'Medicina',
  })
);
const success = <T,>(data: T) => ({ status: 'success' as const, data, issues: [] });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const fileFor = (index: number, name: string): ClinicalAttachmentRecord => ({
  id: name,
  hospitalId: 'hhr',
  patientRut: patients[index].rut,
  patientRutKey: patients[index].rut.replaceAll('.', ''),
  patientName: patients[index].patientName,
  episodeKey: documents[index].episodeKey,
  documentId: documents[index].id,
  storagePath: `synthetic/${name}`,
  downloadUrl: `https://example.test/${name}`,
  originalFileName: name,
  displayName: name,
  contentType: 'application/pdf',
  fileKind: 'pdf',
  sizeBytes: 100,
  status: 'active',
  createdAt: `${date}T10:00:00Z`,
  updatedAt: `${date}T10:00:00Z`,
  createdBy: actor,
  updatedBy: actor,
});
const workspace = (index: number) => (
  <ClinicalDocumentsWorkspace
    patient={patients[index]}
    currentDateString={date}
    bedId={patients[index].bedId}
  />
);

describe('ClinicalDocumentsWorkspace attachment selection integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ClinicalDocumentTemplateRepository.listActive).mockResolvedValue([
      getClinicalDocumentTemplate('epicrisis'),
    ]);
    vi.mocked(ClinicalDocumentRepository.subscribeByEpisodeKeys).mockImplementation(
      (keys, callback) => {
        callback(documents.filter(document => keys.includes(document.episodeKey)));
        return vi.fn();
      }
    );
    vi.mocked(attachments.executeListClinicalAttachmentsByEpisode)
      .mockReset()
      .mockResolvedValue(success([]));
    vi.mocked(attachments.executeListClinicalAttachmentsByPatient)
      .mockReset()
      .mockResolvedValue(success([]));
    vi.mocked(attachments.executeUploadClinicalAttachment).mockReset();
  });

  it('keeps the current files visible when an obsolete A read finishes after A-B-A', async () => {
    const oldRead = deferred<ReturnType<typeof success<ClinicalAttachmentRecord[]>>>();
    const fileA = fileFor(0, 'actual-A.pdf');
    const fileB = fileFor(1, 'actual-B.pdf');
    vi.mocked(attachments.executeListClinicalAttachmentsByEpisode)
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(success([fileB]))
      .mockResolvedValueOnce(success([fileA]));
    const { rerender } = render(workspace(0));
    await waitFor(() =>
      expect(attachments.executeListClinicalAttachmentsByEpisode).toHaveBeenCalledTimes(1)
    );
    rerender(workspace(1));
    expect(await screen.findByText('actual-B.pdf')).toBeVisible();
    rerender(workspace(0));
    expect(await screen.findByText('actual-A.pdf')).toBeVisible();
    await act(async () => {
      oldRead.resolve(success([fileFor(0, 'obsoleto-A.pdf')]));
    });
    expect(screen.getByText('actual-A.pdf')).toBeVisible();
    expect(screen.queryByText('obsoleto-A.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('actual-B.pdf')).not.toBeInTheDocument();
  });

  it('keeps a pending upload out of B and reads it back when A is reopened', async () => {
    const upload = deferred<ReturnType<typeof success<ClinicalAttachmentRecord>>>();
    const saved = fileFor(0, 'guardado-A.pdf');
    const stored: ClinicalAttachmentRecord[] = [];
    vi.mocked(attachments.executeListClinicalAttachmentsByEpisode).mockImplementation(
      async ({ episodeKey }) => success(stored.filter(item => item.episodeKey === episodeKey))
    );
    vi.mocked(attachments.executeUploadClinicalAttachment).mockImplementation(() => upload.promise);
    const { container, rerender, unmount } = render(workspace(0));
    await screen.findByText(/sin archivos del episodio/i);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: { files: [new File(['synthetic'], 'guardado-A.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() =>
      expect(attachments.executeUploadClinicalAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          patientRut: patients[0].rut,
          episodeKey: documents[0].episodeKey,
        })
      )
    );
    rerender(workspace(1));
    await waitFor(() =>
      expect(attachments.executeListClinicalAttachmentsByEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ episodeKey: documents[1].episodeKey })
      )
    );
    await act(async () => {
      stored.push(saved);
      upload.resolve(success(saved));
    });
    expect(screen.queryByText('guardado-A.pdf')).not.toBeInTheDocument();
    unmount();
    render(workspace(0));
    expect(await screen.findByText('guardado-A.pdf')).toBeVisible();
  });
});
