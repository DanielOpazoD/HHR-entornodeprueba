import {
  createApplicationFailed,
  createApplicationIssue,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import PizZip from 'pizzip';
import {
  normalizeClinicalDocumentAiImportText,
  validateClinicalDocumentAiImportFile,
  validateClinicalDocumentAiImportSourceText,
} from '@/features/clinical-documents/controllers/clinicalDocumentAiImportController';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';

const normalizeClinicalDocumentPdfText = (text: string): string =>
  normalizeClinicalDocumentAiImportText(
    text
      .replace(/\u00a2/g, 'ó')
      .replace(/\u00b0/g, 'o')
      .replace(/\r/g, '\n')
  );

const extractPdfText = (buffer: ArrayBuffer): Promise<string> =>
  extractPdfTextFromBuffer(buffer, normalizeClinicalDocumentPdfText);

const WORDPROCESSINGML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const readDocxElementText = (element: Element): string => {
  const localName = element.localName;
  if (localName === 't') {
    return element.textContent || '';
  }
  if (localName === 'tab') {
    return '\t';
  }
  if (localName === 'br' || localName === 'cr') {
    return '\n';
  }

  return Array.from(element.children).map(readDocxElementText).join('');
};

const parseDocxDocumentText = (documentXml: string): string => {
  const xmlDocument = new DOMParser().parseFromString(documentXml.trim(), 'application/xml');
  if (xmlDocument.getElementsByTagName('parsererror').length > 0) {
    throw new Error('DOCX document.xml is not valid XML.');
  }

  const paragraphs = Array.from(
    xmlDocument.getElementsByTagNameNS(WORDPROCESSINGML_NAMESPACE, 'p')
  );
  const lines =
    paragraphs.length > 0
      ? paragraphs.map(paragraph => readDocxElementText(paragraph))
      : Array.from(xmlDocument.getElementsByTagNameNS(WORDPROCESSINGML_NAMESPACE, 't')).map(
          node => node.textContent || ''
        );

  return normalizeClinicalDocumentAiImportText(lines.filter(Boolean).join('\n'));
};

const extractDocxText = async (buffer: ArrayBuffer): Promise<string> => {
  const zip = new PizZip(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('DOCX document.xml was not found.');
  }

  return parseDocxDocumentText(documentFile.asText());
};

const readFileArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('El archivo no se leyó como ArrayBuffer.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
};

const buildFailedTextOutcome = (message: string): ApplicationOutcome<string | null> =>
  createApplicationFailed(
    null,
    [
      createApplicationIssue('validation', message, {
        userSafeMessage: message,
        retryable: false,
      }),
    ],
    { userSafeMessage: message, retryable: false }
  );

export const extractClinicalDocumentAiImportFileText = async (
  file: File
): Promise<ApplicationOutcome<string | null>> => {
  const fileValidation = validateClinicalDocumentAiImportFile(file);
  if (!fileValidation.ok) {
    return buildFailedTextOutcome(fileValidation.message || 'Archivo no válido.');
  }

  try {
    const buffer = await readFileArrayBuffer(file);
    const normalizedName = file.name.toLowerCase();
    const text =
      normalizedName.endsWith('.pdf') || file.type === 'application/pdf'
        ? await extractPdfText(buffer)
        : await extractDocxText(buffer);
    const textValidation = validateClinicalDocumentAiImportSourceText(text);

    if (!textValidation.ok) {
      return buildFailedTextOutcome(textValidation.message || 'No se pudo extraer texto útil.');
    }

    return createApplicationSuccess(text);
  } catch {
    return buildFailedTextOutcome('No se pudo leer el archivo para importarlo con IA.');
  }
};
