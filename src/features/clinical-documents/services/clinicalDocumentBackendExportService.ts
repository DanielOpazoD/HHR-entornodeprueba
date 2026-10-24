import { httpsCallable } from 'firebase/functions';
import type { ClinicalDocumentType } from '@/features/clinical-documents/domain/entities';
import * as z from 'zod';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { blobToBase64 } from '@/features/clinical-documents/services/clinicalDocumentPdfBinarySupport';

interface ExportClinicalDocumentPdfPayload {
  documentId: string;
  fileName: string;
  documentType: ClinicalDocumentType;
  patientName: string;
  patientRut: string;
  episodeKey: string;
  contentBase64: string;
  mimeType: string;
}

interface ExportClinicalDocumentPdfResult {
  fileId: string;
  webViewLink: string;
  folderPath: string;
  usedBackend: boolean;
}

const exportClinicalDocumentPdfResultSchema = z.object({
  fileId: z.string(),
  webViewLink: z.string().url(),
  folderPath: z.string(),
  usedBackend: z.boolean(),
});

export const createClinicalDocumentBackendExportService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => ({
  exportClinicalDocumentPdfViaBackend: async ({
    documentId,
    fileName,
    documentType,
    patientName,
    patientRut,
    episodeKey,
    pdfBlob,
  }: {
    documentId: string;
    fileName: string;
    documentType: ClinicalDocumentType;
    patientName: string;
    patientRut: string;
    episodeKey: string;
    pdfBlob: Blob;
  }): Promise<ExportClinicalDocumentPdfResult> => {
    const functions = await functionsRuntime.getFunctions();
    const callable = httpsCallable<
      ExportClinicalDocumentPdfPayload,
      ExportClinicalDocumentPdfResult
    >(functions, 'exportClinicalDocumentPdfToDrive');

    const contentBase64 = await blobToBase64(pdfBlob);
    const response = await callable({
      documentId,
      fileName,
      documentType,
      patientName,
      patientRut,
      episodeKey,
      contentBase64,
      mimeType: pdfBlob.type || 'application/pdf',
    });

    return exportClinicalDocumentPdfResultSchema.parse(response.data);
  },
});

const clinicalDocumentBackendExportService = createClinicalDocumentBackendExportService();
export const exportClinicalDocumentPdfViaBackend =
  clinicalDocumentBackendExportService.exportClinicalDocumentPdfViaBackend;
