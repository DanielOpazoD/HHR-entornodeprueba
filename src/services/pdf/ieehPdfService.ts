/**
 * IEEH PDF Service — Llenado Automático del Informe Estadístico de Egreso Hospitalario
 *
 * Genera un PDF llenado a partir de la plantilla docs/estadistico-egreso.pdf,
 * escribiendo texto sobre las posiciones exactas del formulario oficial del MINSAL.
 *
 * DIMENSIONES DEL PDF:
 *  - 609.57 × 935.43 puntos (oficio chileno: 215 × 330mm)
 *  - Coordenadas PDF: origen en esquina INFERIOR-IZQUIERDA
 *  - Y invertido respecto a la pantalla: Y=935 es el borde superior
 *
 * CAMPOS DISPONIBLES PARA LLENADO (Fase 1):
 *  #4  Nombre legal (Primer Apellido, Segundo Apellido, Nombres)
 *  #5  Tipo identificación + RUN
 *  #6  Sexo registral
 *  #7  Fecha de nacimiento (Día, Mes, Año)
 *  #8  Edad + Unidad
 *  #10 Pueblo indígena (Rapanui) — Sección PUEBLOS INDÍGENAS
 *  #18 Previsión
 *  #22 Procedencia del paciente
 *  #24 Ingreso (hora, fecha)
 *  #29 Egreso (hora, fecha) — del movimiento de alta
 *  #30 Días de estada — calculado
 *  #33 Diagnóstico principal + Código CIE-10
 *  Especialidad del médico tratante
 *
 * ÚLTIMA CALIBRACIÓN: 2026-02-23 (v5, 5 iteraciones visuales)
 * TEST DE GOBERNANZA: src/tests/services/pdf/ieehPdfCoordinates.test.ts
 */

import type { PDFFont } from 'pdf-lib';
import { PatientData } from '@/services/contracts/patientServiceContracts';
import { openPdfPrintDialog, saveAndDownloadPdf } from './pdfBase';
import { FIELD_COORDS, mapInsurance, mapSex, mapProcedencia } from './ieehPdfCoordinates';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { loadPdfLibGenerationRuntime } from './pdfLibRuntime';
import type { DischargeFormData } from './ieehPdfContracts';
import {
  buildIEEHFileName,
  calculateAge,
  calculateDaysOfStay,
  drawOptionalText,
  parseDate,
  parseTime,
  resolveDischargeDiagnosis,
  splitPatientName,
  wrapTextByWidth,
} from './ieehPdfSupport';

export type { DischargeFormData } from './ieehPdfContracts';

// ── Template PDF path (loaded as asset via fetch) ──
const TEMPLATE_PATH = '/docs/estadistico-egreso.pdf';

// --- Constants ---
const FONT_SIZE = 12; // Uniform size for all fields (20% larger than original 10pt)
const CHAR_SPACING = 1; // Extra spacing between characters for form legibility

/**
 * Main function: Fill the IEEH form with patient data
 *
 * @param patient - Patient data from the census
 * @param discharge - Additional discharge-specific data
 * @returns Uint8Array of the filled PDF ready for download
 */
export const fillIEEHForm = async (
  patient: PatientData,
  discharge: DischargeFormData = {}
): Promise<Uint8Array> => {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLibGenerationRuntime();

  // 1. Load the template PDF
  const templateResponse = await fetch(TEMPLATE_PATH);
  if (!templateResponse.ok) {
    throw new Error(
      `No se pudo cargar la plantilla IEEH (${templateResponse.status}). Verifique que el archivo ${TEMPLATE_PATH} exista.`
    );
  }
  const templateBytes = await templateResponse.arrayBuffer();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const textColor = rgb(0, 0, 0);

  // 2. Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // 3. Get page 1
  const page = pdfDoc.getPage(0);

  // Helper: draw text at coordinates
  const drawText = (
    text: string,
    coords: { x: number; y: number; maxWidth: number },
    options: { fontSize?: number; bold?: boolean; preserveCase?: boolean } = {}
  ) => {
    if (!text) return;
    const fontSize = options.fontSize ?? FONT_SIZE;
    const f: PDFFont = options.bold ? fontBold : font;

    // Uppercase by default, preserve case when explicitly requested
    const displayText = options.preserveCase ? text : text.toUpperCase();

    // Draw each character individually with extra spacing for legibility
    let xOffset = coords.x;
    for (const char of displayText) {
      page.drawText(char, {
        x: xOffset,
        y: coords.y,
        size: fontSize,
        font: f,
        color: textColor,
      });
      xOffset += f.widthOfTextAtSize(char, fontSize) + CHAR_SPACING;
    }
  };

  const drawMultilineText = (
    text: string,
    coords: { x: number; y: number; maxWidth: number },
    options: {
      fontSize?: number;
      bold?: boolean;
      lineHeight?: number;
      maxLines?: number;
      preserveCase?: boolean;
    } = {}
  ) => {
    if (!text) return;
    const fontSize = options.fontSize ?? FONT_SIZE;
    const f: PDFFont = options.bold ? fontBold : font;
    const lineHeight = options.lineHeight ?? fontSize + 2;
    const maxLines = options.maxLines ?? 3;
    const displayText = options.preserveCase ? text : text.toUpperCase();
    const wrapped = wrapTextByWidth(displayText, coords.maxWidth, f, fontSize);
    const linesToDraw = wrapped.slice(0, maxLines);

    linesToDraw.forEach((line, lineIndex) => {
      drawText(
        line,
        { ...coords, y: coords.y - lineIndex * lineHeight },
        {
          ...options,
          preserveCase: true, // already handled above
        }
      );
    });
  };

  // ── Fill fields ──

  // #4: NOMBRE LEGAL
  const [nombres, primerApellido, segundoApellido] = splitPatientName(patient.patientName);
  drawText(primerApellido, FIELD_COORDS.primerApellido);
  drawText(segundoApellido, FIELD_COORDS.segundoApellido);
  drawText(nombres, FIELD_COORDS.nombres);

  // #5: TIPO DE IDENTIFICACIÓN + RUN
  const tipoId = patient.documentType === 'RUT' ? '1' : '4'; // 1=RUN, 4=Pasaporte
  drawText(tipoId, FIELD_COORDS.tipoIdentificacion);
  if (patient.rut) {
    drawText(patient.rut, FIELD_COORDS.runDigits);
  }

  // #6: SEXO REGISTRAL
  const sexo = mapSex(patient.biologicalSex);
  drawText(sexo, FIELD_COORDS.sexoRegistral, { bold: true });

  // #7: FECHA DE NACIMIENTO
  const birthDate = parseDate(patient.birthDate);
  if (birthDate) {
    drawText(birthDate.dia, FIELD_COORDS.nacDia);
    drawText(birthDate.mes, FIELD_COORDS.nacMes);
    drawText(birthDate.anio, FIELD_COORDS.nacAnio);
  }

  // #8: EDAD
  const ageStr = calculateAge(patient.birthDate);
  if (ageStr) {
    const ageNum = ageStr.replace(/\D/g, '');
    drawText(ageNum, FIELD_COORDS.edad);
    // Unit: default to Años (1)
    drawText('1', FIELD_COORDS.edadUnidad);
  }

  // #9: PUEBLO INDÍGENA
  if (patient.isRapanui) {
    drawText('3', FIELD_COORDS.puebloIndigena); // 3=Rapa Nui
  }

  // #18: PREVISIÓN
  const prevision = mapInsurance(patient.insurance);
  drawText(prevision, FIELD_COORDS.prevision);

  // #22: PROCEDENCIA
  const procedencia = mapProcedencia(patient.admissionOrigin);
  drawText(procedencia, FIELD_COORDS.procedencia);

  // #24: INGRESO
  const admDate = parseDate(patient.admissionDate);
  const admTime = parseTime(patient.admissionTime);
  if (admTime) {
    drawText(admTime.hora, FIELD_COORDS.ingresoHora);
    drawText(admTime.min, FIELD_COORDS.ingresoMin);
  }
  if (admDate) {
    drawText(admDate.dia, FIELD_COORDS.ingresoDia);
    drawText(admDate.mes, FIELD_COORDS.ingresoMes);
    drawText(admDate.anio, FIELD_COORDS.ingresoAnio);
  }

  // #29: EGRESO
  const disDate = parseDate(discharge.dischargeDate);
  const disTime = parseTime(discharge.dischargeTime);
  if (disTime) {
    drawText(disTime.hora, FIELD_COORDS.egresoHora);
    drawText(disTime.min, FIELD_COORDS.egresoMin);
  }
  if (disDate) {
    drawText(disDate.dia, FIELD_COORDS.egresoDia);
    drawText(disDate.mes, FIELD_COORDS.egresoMes);
    drawText(disDate.anio, FIELD_COORDS.egresoAnio);
  }

  // #30: DÍAS DE ESTADA
  const days =
    discharge.daysOfStay ?? calculateDaysOfStay(patient.admissionDate, discharge.dischargeDate);
  if (days > 0) {
    drawText(String(days), FIELD_COORDS.diasEstada);
  }

  // #31: CONDICIÓN AL EGRESO (1-7, dialog override or default 1=Domicilio)
  drawText(discharge.condicionEgreso || '1', FIELD_COORDS.condicionEgreso);
  if (discharge.destination) {
    drawText(discharge.destination, FIELD_COORDS.destinoAlAlta);
  }

  // #33: DIAGNÓSTICO PRINCIPAL + CIE-10
  // Dialog overrides take priority over patient data
  const { diagnostico, cie10 } = resolveDischargeDiagnosis(patient, discharge);
  drawMultilineText(diagnostico, FIELD_COORDS.diagnosticoPrincipal);
  if (cie10) {
    drawText(cie10, FIELD_COORDS.codigoCIE10, { bold: true });
  }

  // #39: INTERVENCIÓN QUIRÚRGICA
  drawOptionalText(drawText, discharge.intervencionQuirurgica, FIELD_COORDS.intervencionQuirurgica);
  if (discharge.intervencionQuirurgDescrip) {
    drawMultilineText(
      discharge.intervencionQuirurgDescrip,
      FIELD_COORDS.intervencionQuirurgDescrip,
      {
        fontSize: 8,
        preserveCase: true,
        maxLines: 3,
        lineHeight: 9,
      }
    );
  }
  if (discharge.intervencionCodigo) {
    drawText(discharge.intervencionCodigo, FIELD_COORDS.intervencionCodigo, { fontSize: 9 });
  }

  // #42: PROCEDIMIENTO
  drawOptionalText(drawText, discharge.procedimiento, FIELD_COORDS.procedimiento);
  if (discharge.procedimientoDescrip) {
    drawMultilineText(discharge.procedimientoDescrip, FIELD_COORDS.procedimientoDescrip, {
      fontSize: 8,
      preserveCase: true,
      maxLines: 3,
      lineHeight: 9,
    });
  }
  if (discharge.procedimientoCodigo) {
    drawText(discharge.procedimientoCodigo, FIELD_COORDS.procedimientoCodigo, { fontSize: 9 });
  }

  // #49: MÉDICO TRATANTE
  drawOptionalText(drawText, discharge.tratanteApellido1, FIELD_COORDS.tratanteApellido1);
  drawOptionalText(drawText, discharge.tratanteApellido2, FIELD_COORDS.tratanteApellido2);
  drawOptionalText(drawText, discharge.tratanteNombre, FIELD_COORDS.tratanteNombre);
  drawOptionalText(drawText, discharge.tratanteRut, FIELD_COORDS.tratanteRut);

  // #50: ESPECIALIDAD
  const specialtyStr = String(patient.specialty || '');
  if (specialtyStr && specialtyStr !== 'Vacío' && specialtyStr !== '') {
    drawText(specialtyStr, FIELD_COORDS.especialidadMedico);
  }

  // 4. Serialize and return
  const filledPdf = await pdfDoc.save();
  return filledPdf;
};

/**
 * Generate and trigger download of the filled IEEH form
 */
export const downloadIEEHForm = async (
  patient: PatientData,
  discharge: DischargeFormData = {}
): Promise<void> => {
  const pdfBytes = await fillIEEHForm(patient, discharge);
  await saveAndDownloadPdf(pdfBytes, buildIEEHFileName(patient.patientName));
};

/**
 * Generate and open the browser print dialog for the filled IEEH form.
 */
export const printIEEHForm = async (
  patient: PatientData,
  discharge: DischargeFormData = {},
  printWindow?: Window | null
): Promise<void> => {
  const pdfBytes = await fillIEEHForm(patient, discharge);
  await openPdfPrintDialog(pdfBytes, buildIEEHFileName(patient.patientName), printWindow);
};

/**
 * Open filled IEEH form in a new browser tab for preview
 */
export const previewIEEHForm = async (
  patient: PatientData,
  discharge: DischargeFormData = {}
): Promise<void> => {
  const pdfBytes = await fillIEEHForm(patient, discharge);
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  defaultBrowserWindowRuntime.open(url, '_blank');
};
