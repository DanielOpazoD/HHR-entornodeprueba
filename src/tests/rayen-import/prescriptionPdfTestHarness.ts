// @vitest-environment node
import path from 'node:path';

import { jsPDF } from 'jspdf';
import * as PDFLib from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import '../../../extension/prescription-pdf.js';
import '../../../extension/pdf-print.js';

const standardFontDataUrl = path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep;

export const prescriptionPdf = (
  globalThis as typeof globalThis & {
    HhrPrescriptionPdf: {
      generateProfessionalPrescriptionPdf: (
        data: {
          patient: Record<string, string>;
          professional: string;
          professionalRun?: string;
          validationDate: string;
          validationDateTime?: string;
          dateSource?: 'validation' | 'indication';
          emissionDateTime?: string;
          folio?: string;
          printedBy?: string;
          address?: string;
          officialEquivalent?: boolean;
          isExternalPrescription?: boolean;
          printFormat?: string;
          medications: Array<Record<string, string>>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
      generateBradenSummaryPdf: (
        data: {
          generatedAt: string;
          patients: Array<{
            name: string;
            run: string;
            bed: string;
            braden: null | {
              total: number;
              severity: string;
              dateTime: string;
              author: string;
            };
          }>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
      generateIntegratedRegimenPdf: (
        data: {
          generatedAt: string;
          patients: Array<{
            name: string;
            run: string;
            service: string;
            room: string;
            bed: string;
            regimen: null | { diet: string; observation: string; dateTime: string };
            braden: null | { total: number; severity: string; dateTime: string; author: string };
          }>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
    };
  }
).HhrPrescriptionPdf;

export const pdfPrint = (
  globalThis as typeof globalThis & {
    HhrPdfPrint: {
      preparePdfForBrowserPrint: (
        buffer: ArrayBuffer,
        library: typeof PDFLib
      ) => Promise<ArrayBuffer>;
      mergePdfBuffers: (
        buffers: ArrayBuffer[],
        library: typeof PDFLib,
        limits?: { maxInputBytes?: number; maxPages?: number }
      ) => Promise<ArrayBuffer>;
    };
  }
).HhrPdfPrint;

export const extractPageText = async (buffer: ArrayBuffer) => {
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    useWorkerFetch: false,
  }).promise;
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map(item => ('str' in item ? item.str : '')).join(' ');
    })
  );
};
