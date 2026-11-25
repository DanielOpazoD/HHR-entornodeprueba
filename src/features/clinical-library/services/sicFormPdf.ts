import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import type { ClinicalFormDefinition, ClinicalFormValues } from '../domain/forms/clinicalFormTypes';
import { validateClinicalFormValues } from '../domain/forms/clinicalFormDraft';
import { validateSicRequired } from '../domain/forms/sicFormData';
import { createClinicalFormPdf, loadClinicalFormTemplate } from './clinicalFormPdf';

export const addSicSignatureToPdf = async (
  bytes: Uint8Array,
  png?: Uint8Array
): Promise<Uint8Array> => {
  if (!png) return bytes;
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const pdf = await PDFDocument.load(bytes);
  const image = await pdf.embedPng(png);
  const { width, height } = image.scaleToFit(84, 19);
  pdf.getPage(0).drawImage(image, {
    x: 503 + (84 - width) / 2,
    y: 792 - 678 - height - (19 - height) / 2,
    width,
    height,
  });
  return pdf.save();
};

export const generateSicFormPdf = async (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  png?: Uint8Array
) => {
  validateSicRequired(validateClinicalFormValues(form, values, hidden));
  return addSicSignatureToPdf(
    await createClinicalFormPdf(await loadClinicalFormTemplate(form), form, values, hidden),
    png
  );
};
