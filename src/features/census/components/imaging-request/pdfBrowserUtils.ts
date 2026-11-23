import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';

import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

import { injectPrintScript } from '@/services/pdf/pdfBase';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import type { CustomMark } from './pdfMarkTypes';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

const MARK_TEXT_Y_OFFSET = 3;
const MARK_X_OFFSET = 4;
const MARK_Y_OFFSET = 4;
const PDF_TEMPLATE_FETCH_TIMEOUT_MS = 15_000;
const PDF_TAB_REVOKE_DELAY_MS = 60_000;
const PDF_DOWNLOAD_REVOKE_DELAY_MS = 1_000;

export const getTodayFormatted = (): string => formatDateDDMMYYYY(getTodayISO());

export const loadPdfTemplate = async (
  templatePath: string,
  timeoutMs: number = PDF_TEMPLATE_FETCH_TIMEOUT_MS
): Promise<PDFDocument> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(
      templatePath,
      controller ? { signal: controller.signal } : undefined
    );
    if (!response.ok) {
      throw new Error(`No se pudo cargar la plantilla PDF (${response.status}).`);
    }
    const templateBytes = await response.arrayBuffer();
    return PDFDocument.load(templateBytes);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};

export const createUppercaseTextDrawer = ({
  page,
  font,
  fontSize,
}: {
  page: PDFPage;
  font: PDFFont;
  fontSize: number;
}) => {
  return (
    text: string,
    coords: { x: number; y: number; maxWidth: number },
    options: { shrinkToFit?: boolean } = {}
  ) => {
    if (!text) return;

    const upperText = text.toUpperCase();
    // Only single-line fields are measured: WinAnsi metrics reject the line breaks a free-text
    // field such as the diagnosis may carry, which drawText itself lays out as separate lines.
    const width = options.shrinkToFit ? font.widthOfTextAtSize(upperText, fontSize) : 0;
    const size = width > coords.maxWidth ? (fontSize * coords.maxWidth) / width : fontSize;

    page.drawText(upperText, {
      x: coords.x,
      y: coords.y,
      size,
      font,
    });
  };
};

export const drawCustomMarks = ({
  page,
  font,
  marks,
  fontSize,
}: {
  page: PDFPage;
  font: PDFFont;
  marks: CustomMark[];
  fontSize: number;
}) => {
  marks.forEach(mark => {
    const xPos = page.getWidth() * (mark.x / 100);
    const yPos = page.getHeight() * (1 - mark.y / 100);

    if (mark.text) {
      page.drawText(mark.text.toUpperCase(), {
        x: xPos,
        y: yPos - MARK_TEXT_Y_OFFSET,
        size: fontSize,
        font,
      });
      return;
    }

    page.drawText('X', {
      x: xPos - MARK_X_OFFSET,
      y: yPos - MARK_Y_OFFSET,
      size: 14,
      font,
    });
  });
};

export const openPdfBlobInNewTab = ({
  bytes,
  fileName,
}: {
  bytes: Uint8Array;
  fileName: string;
}) => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const newWindow = defaultBrowserWindowRuntime.open(url, '_blank');

  if (!newWindow) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), PDF_DOWNLOAD_REVOKE_DELAY_MS);
  } else {
    globalThis.setTimeout(() => URL.revokeObjectURL(url), PDF_TAB_REVOKE_DELAY_MS);
  }

  return url;
};

export const injectPrintScriptAndOpen = async ({
  filledBytes,
  fileName,
}: {
  filledBytes: Uint8Array;
  fileName: string;
}) => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const printDoc = await PDFDocument.load(filledBytes);
  await injectPrintScript(printDoc);
  const finalBytes = await printDoc.save();
  openPdfBlobInNewTab({ bytes: finalBytes as Uint8Array, fileName });
};

export const embedHelvetica = async (pdfDoc: PDFDocument) =>
  pdfDoc.embedFont((await loadPdfLibGenerationRuntime()).StandardFonts.Helvetica);
