import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { executeExportClinicalDocumentPdf } from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';

const generateClinicalDocumentPdfBlobMock = vi.fn();
const exportClinicalDocumentPdfViaBackendMock = vi.fn();

vi.mock('@/features/clinical-documents/internal', async () => {
  const actual = await vi.importActual<typeof import('@/features/clinical-documents/internal')>(
    '@/features/clinical-documents/internal'
  );
  return {
    ...actual,
    generateClinicalDocumentPdfBlob: (...args: unknown[]) =>
      generateClinicalDocumentPdfBlobMock(...args),
    exportClinicalDocumentPdfViaBackend: (...args: unknown[]) =>
      exportClinicalDocumentPdfViaBackendMock(...args),
  };
});

const buildRecord = (): ClinicalDocumentRecord =>
  createClinicalDocumentDraft({
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
      fing: '2026-03-06',
    },
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  });

describe('clinicalDocumentPdfExportUseCase', () => {
  const savePdfMetadata = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    generateClinicalDocumentPdfBlobMock.mockResolvedValue(
      new Blob(['pdf'], { type: 'application/pdf' })
    );
    exportClinicalDocumentPdfViaBackendMock.mockResolvedValue({
      fileId: 'pdf-123',
      webViewLink: 'https://drive.test/pdf-123',
      folderPath: '/drive/clinicos',
    });
  });

  it('forwards annexMode to PDF generation and persists successful metadata', async () => {
    const record = buildRecord();

    const result = await executeExportClinicalDocumentPdf(
      {
        record,
        hospitalId: 'hhr',
        fileName: 'epicrisis.pdf',
        annexMode: 'annex_only',
      },
      {
        clinicalDocumentPort: {
          listByEpisode: vi.fn(),
          listByEpisodeKeys: vi.fn(),
          saveDraft: vi.fn(),
          createDraft: vi.fn(),
          savePdfMetadata,
          lockDocumentsByEpisodeKey: vi.fn(),
          delete: vi.fn(),
          subscribeByEpisode: vi.fn(),
          subscribeByEpisodeKeys: vi.fn(),
        },
      }
    );

    expect(generateClinicalDocumentPdfBlobMock).toHaveBeenCalledWith(record, {
      annexMode: 'annex_only',
    });
    expect(exportClinicalDocumentPdfViaBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: record.id,
        fileName: 'epicrisis.pdf',
      })
    );
    expect(savePdfMetadata).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        fileId: 'pdf-123',
        exportStatus: 'exported',
      }),
      'hhr'
    );
    expect(result.status).toBe('success');
  });

  it('persists failed metadata when PDF generation fails before upload', async () => {
    const record = buildRecord();
    generateClinicalDocumentPdfBlobMock.mockRejectedValueOnce(new Error('render failed'));

    const result = await executeExportClinicalDocumentPdf(
      {
        record,
        hospitalId: 'hhr',
        fileName: 'epicrisis.pdf',
        annexMode: 'exclude',
      },
      {
        clinicalDocumentPort: {
          listByEpisode: vi.fn(),
          listByEpisodeKeys: vi.fn(),
          saveDraft: vi.fn(),
          createDraft: vi.fn(),
          savePdfMetadata,
          lockDocumentsByEpisodeKey: vi.fn(),
          delete: vi.fn(),
          subscribeByEpisode: vi.fn(),
          subscribeByEpisodeKeys: vi.fn(),
        },
      }
    );

    expect(exportClinicalDocumentPdfViaBackendMock).not.toHaveBeenCalled();
    expect(savePdfMetadata).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        exportStatus: 'failed',
        exportError: 'render failed',
      }),
      'hhr'
    );
    expect(result.status).toBe('failed');
    expect(result.issues?.[0]?.message).toBe('render failed');
  });
});
