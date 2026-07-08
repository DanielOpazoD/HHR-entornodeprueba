import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';

import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

import { injectPrintScript } from './pdfBase';
import { loadPdfLibGenerationRuntime } from './pdfLibRuntime';
import type { CustomMark } from './pdfMarkTypes';

const MARK_TEXT_Y_OFFSET = 3;
const MARK_X_OFFSET = 4;
const MARK_Y_OFFSET = 4;

export const getTodayFormatted = (): string => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

export const loadPdfTemplate = async (templatePath: string): Promise<PDFDocument> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const response = await fetch(templatePath);
  const templateBytes = await response.arrayBuffer();
  return PDFDocument.load(templateBytes);
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
  return (text: string, coords: { x: number; y: number; maxWidth: number }) => {
    if (!text) return;

    page.drawText(text.toUpperCase(), {
      x: coords.x,
      y: coords.y,
      size: fontSize,
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
  }

  return url;
};

export const createPdfObjectUrl = (bytes: Uint8Array): string => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
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

export const buildSuggestedPdfName = (prefix: string, patientName: string): string => {
  const safeName = (patientName || 'paciente')
    .replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  return `${prefix}_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
};

export const embedHelvetica = async (pdfDoc: PDFDocument) =>
  pdfDoc.embedFont((await loadPdfLibGenerationRuntime()).StandardFonts.Helvetica);
