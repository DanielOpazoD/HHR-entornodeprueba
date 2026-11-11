import type { PatientData } from '@/types/domain/patient';

/**
 * Imaging Request PDF Service — Solicitud de Imágenes
 *
 * Fills the official imaging request form template with patient data
 * using coordinate-based text injection (same pattern as ieehPdfService).
 *
 * COORDINATES SOURCE: User-provided JSON from PDF field mapping tool.
 * Template: public/docs/solicitud-imagen.pdf
 */

import { calculateAge, formatDateToCL as formatDate } from '@/utils/clinicalUtils';
import { formatPatientDisplayName } from '@/utils/patientNameDisplayUtils';
import { saveAndDownloadPdf } from './pdfBase';
import {
  SOLICITUD_FIELD_COORDS,
  ENCUESTA_FIELD_COORDS,
  CONSENTIMIENTO_FIELD_COORDS,
} from './imagingRequestPdfCoordinates';
import type { CustomMark } from './pdfMarkTypes';
import {
  buildSuggestedPdfName,
  createUppercaseTextDrawer,
  drawCustomMarks,
  embedHelvetica,
  getTodayFormatted,
  injectPrintScriptAndOpen,
  loadPdfTemplate,
  createPdfObjectUrl,
} from './pdfBrowserUtils';

// Re-export constants for backwards compatibility and tests
export { SOLICITUD_FIELD_COORDS, ENCUESTA_FIELD_COORDS, CONSENTIMIENTO_FIELD_COORDS };
export type { CustomMark } from './pdfMarkTypes';

// ── Template PDF paths ──
export const SOLICITUD_TEMPLATE_PATH = '/docs/solicitud-imagen.pdf';
export const ENCUESTA_TEMPLATE_PATH = '/docs/encuesta-contraste.pdf';
export const CONSENTIMIENTO_TEMPLATE_PATH = '/docs/consentimiento.pdf';

const FONT_SIZE = 10;

const getDiagnosisValue = (patient: PatientData): string =>
  patient.pathology || patient.cie10Description || '';

type FieldCoords = { x: number; y: number; maxWidth: number };
type DrawText = (text: string, coords: FieldCoords, options?: { shrinkToFit?: boolean }) => void;

const fillImagingPatientIdentity = ({
  drawText,
  patient,
  coords,
  includeBirthDate,
}: {
  drawText: DrawText;
  patient: PatientData;
  coords: Record<string, FieldCoords>;
  includeBirthDate?: boolean;
}) => {
  // One measured line: separate name columns let long given names run into the surnames.
  drawText(formatPatientDisplayName(patient), coords.nombreCompleto, { shrinkToFit: true });
  drawText(patient.rut || '', coords.rut);
  drawText(calculateAge(patient.birthDate), coords.edad);

  if (includeBirthDate && 'fechaNacimiento' in coords) {
    drawText(formatDate(patient.birthDate), coords.fechaNacimiento);
  }
};

const fillPhysicianAndDiagnosis = ({
  drawText,
  patient,
  requestingPhysician,
  coords,
  includeDateField,
}: {
  drawText: DrawText;
  patient: PatientData;
  requestingPhysician: string;
  coords: Record<string, FieldCoords>;
  includeDateField?: string;
}) => {
  drawText(getDiagnosisValue(patient), coords.diagnostico);

  if (includeDateField) {
    drawText(getTodayFormatted(), coords[includeDateField]);
  }

  if (requestingPhysician) {
    drawText(requestingPhysician, coords.medicoTratante);
  }
};

const fillImagingTemplate = async ({
  templatePath,
  coords,
  patient,
  requestingPhysician,
  marks,
  includeBirthDate,
  includeDateField,
}: {
  templatePath: string;
  coords: Record<string, { x: number; y: number; maxWidth: number }>;
  patient: PatientData;
  requestingPhysician: string;
  marks: CustomMark[];
  includeBirthDate?: boolean;
  includeDateField?: string;
}): Promise<Uint8Array> => {
  const pdfDoc = await loadPdfTemplate(templatePath);
  const font = await embedHelvetica(pdfDoc);
  const page = pdfDoc.getPage(0);
  const drawText = createUppercaseTextDrawer({ page, font, fontSize: FONT_SIZE });

  fillImagingPatientIdentity({
    drawText,
    patient,
    coords,
    includeBirthDate,
  });
  fillPhysicianAndDiagnosis({
    drawText,
    patient,
    requestingPhysician,
    coords,
    includeDateField,
  });
  drawCustomMarks({ page, font, marks, fontSize: FONT_SIZE });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes as unknown as Uint8Array;
};

const printFilledImagingDocument = async (
  filledBytes: Uint8Array,
  prefix: string,
  patientName: string
): Promise<void> => {
  await injectPrintScriptAndOpen({
    filledBytes,
    fileName: `IMPRIMIR_${prefix}_${patientName}.pdf`,
  });
};

/**
 * Fill the imaging request form with patient data
 */
export const fillImagingRequestForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<Uint8Array> => {
  return fillImagingTemplate({
    templatePath: SOLICITUD_TEMPLATE_PATH,
    coords: SOLICITUD_FIELD_COORDS,
    patient,
    requestingPhysician,
    marks,
    includeBirthDate: true,
    includeDateField: 'fechaSolicitud',
  });
};

/**
 * Fill the general informed consent form with patient data
 */
export const fillConsentimientoForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<Uint8Array> => {
  return fillImagingTemplate({
    templatePath: CONSENTIMIENTO_TEMPLATE_PATH,
    coords: CONSENTIMIENTO_FIELD_COORDS,
    patient,
    requestingPhysician,
    marks,
    includeDateField: 'fecha',
  });
};

/**
 * Download the filled imaging request form
 */
export const downloadImagingRequestForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<void> => {
  const bytes = await fillImagingRequestForm(patient, requestingPhysician, marks);
  const suggestedName = buildSuggestedPdfName('SolicitudImagen', patient.patientName || 'paciente');

  await saveAndDownloadPdf(bytes, suggestedName);
};

/**
 * Generate a Blob URL for the filled imaging request form
 * This is used for previewing the PDF in an iframe
 */
export const generateImagingRequestPreviewUrl = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<string> => {
  const pdfBytes = await fillImagingRequestForm(patient, requestingPhysician, marks);
  return createPdfObjectUrl(pdfBytes);
};

/**
 * Print the official Solicitud de Imágenes by injecting an auto-print script
 * and opening it in a hidden iframe (or a new tab as fallback)
 */
export const printImagingRequestForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<void> => {
  const filledBytes = await fillImagingRequestForm(patient, requestingPhysician, marks);
  await printFilledImagingDocument(filledBytes, 'Solicitud', patient.patientName);
};

/**
 * Print the official Consentimiento Informado by injecting an auto-print script
 */
export const printConsentimientoForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<void> => {
  const filledBytes = await fillConsentimientoForm(patient, requestingPhysician, marks);
  await printFilledImagingDocument(filledBytes, 'Consentimiento', patient.patientName);
};

/**
 * Fill the Encuesta Medio Contraste form with patient data
 */
export const fillImagingEncuestaForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<Uint8Array> => {
  return fillImagingTemplate({
    templatePath: ENCUESTA_TEMPLATE_PATH,
    coords: ENCUESTA_FIELD_COORDS,
    patient,
    requestingPhysician,
    marks,
    includeBirthDate: true,
  });
};

/**
 * Print the Encuesta Medio Contraste directly
 */
export const printImagingEncuestaForm = async (
  patient: PatientData,
  requestingPhysician: string = '',
  marks: CustomMark[] = []
): Promise<void> => {
  const filledBytes = await fillImagingEncuestaForm(patient, requestingPhysician, marks);
  await printFilledImagingDocument(filledBytes, 'Encuesta', patient.patientName);
};
