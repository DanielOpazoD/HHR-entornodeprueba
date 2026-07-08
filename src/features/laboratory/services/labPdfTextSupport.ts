import {
  extractPdfTextFromBuffer,
  normalizePdfText,
} from '@/services/pdf/pdfTextExtractionRuntime';

export const extractPdfText = (buffer: ArrayBuffer): Promise<string> =>
  extractPdfTextFromBuffer(buffer, normalizePdfText);

export { normalizePdfText };
