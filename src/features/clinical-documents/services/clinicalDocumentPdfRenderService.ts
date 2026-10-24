import { httpsCallable } from 'firebase/functions';
import * as z from 'zod';

import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { buildClinicalDocumentPrintHtml } from '@/features/clinical-documents/services/clinicalDocumentPrintHtmlBuilder';
import type { ClinicalDocumentAnnexPrintMode } from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';
import { decodeBase64PdfBlob } from '@/features/clinical-documents/services/clinicalDocumentPdfBinarySupport';
import { generateClinicalDocumentDomSnapshotPdfBlob } from '@/features/clinical-documents/services/clinicalDocumentPdfSnapshotSupport';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { clinicalDocumentPdfRenderLogger } from '@/features/clinical-documents/services/clinicalDocumentLoggers';

interface RenderClinicalDocumentPdfPayload {
  html: string;
}

interface RenderClinicalDocumentPdfResult {
  contentBase64: string;
  mimeType: string;
}

const renderClinicalDocumentPdfResultSchema = z.object({
  contentBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

export const createClinicalDocumentPdfRenderService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => {
  const generateBackendPrintStyledPdfBlob = async (html: string): Promise<Blob> => {
    const functions = await functionsRuntime.getFunctions();
    const callable = httpsCallable<
      RenderClinicalDocumentPdfPayload,
      RenderClinicalDocumentPdfResult
    >(functions, 'renderClinicalDocumentPdfFromHtml');

    const response = await callable({ html });
    const payload = renderClinicalDocumentPdfResultSchema.parse(response.data);
    return decodeBase64PdfBlob(payload.contentBase64, payload.mimeType || 'application/pdf');
  };

  return {
    generateClinicalDocumentPrintStyledPdfBlob: async (
      record?: ClinicalDocumentRecord,
      options: { annexMode?: ClinicalDocumentAnnexPrintMode } = {}
    ): Promise<Blob | null> => {
      const html = await buildClinicalDocumentPrintHtml({
        includeAppStyles: true,
        documentType: record?.documentType,
        pageTitle: record?.title,
        annexMode: options.annexMode,
        includePatientSignature: record?.includePatientSignature ?? true,
      });
      if (!html) {
        return null;
      }

      try {
        return await generateBackendPrintStyledPdfBlob(html);
      } catch (error) {
        clinicalDocumentPdfRenderLogger.warn(
          'Backend render failed, falling back to client snapshot',
          error
        );
      }

      try {
        return await generateClinicalDocumentDomSnapshotPdfBlob(html);
      } catch (error) {
        clinicalDocumentPdfRenderLogger.warn('Client snapshot render failed', error);
        return null;
      }
    },
  };
};

const clinicalDocumentPdfRenderService = createClinicalDocumentPdfRenderService();
export const generateClinicalDocumentPrintStyledPdfBlob =
  clinicalDocumentPdfRenderService.generateClinicalDocumentPrintStyledPdfBlob;
