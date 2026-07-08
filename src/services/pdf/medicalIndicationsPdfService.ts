import type { PDFFont, PDFPage } from 'pdf-lib';
import { openPdfPrintDialog } from '@/services/pdf/pdfBase';
import {
  MEDICAL_INDICATIONS_LINE_FIELD_NAMES,
  MEDICAL_INDICATIONS_PDF_COORDINATES,
  MEDICAL_INDICATIONS_PDF_TEMPLATE_FALLBACK_PATHS,
  MEDICAL_INDICATIONS_PDF_TEMPLATE_PATH,
} from '@/services/pdf/medicalIndicationsPdfCoordinates';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { formatMedicalIndicationsDate } from '@/shared/contracts/medicalIndications';

const FONT_SIZE = 11;
const PDF_HEADER = '%PDF-';

export interface MedicalIndicationsPdfData {
  paciente_nombre: string;
  paciente_rut: string;
  paciente_diagnostico: string;
  paciente_edad: string;
  fecha_nacimiento: string;
  paciente_alergias: string;
  medicotratante: string;
  fecha_ingreso: string;
  fecha_actual: string;
  fecha_generacion?: string;
  diasEstada: string;
  Reposoindicacion: string;
  Regimenindicacion: string;
  Kinemotora: string;
  Kinerespiratoria: string;
  Kinecantidadvecesdia: string;
  Pendientes: string;
  indicaciones: string[];
}

const drawFieldText = (
  page: PDFPage,
  font: PDFFont,
  variableName: keyof typeof MEDICAL_INDICATIONS_PDF_COORDINATES,
  value: string
): void => {
  if (!value.trim()) return;

  const coords = MEDICAL_INDICATIONS_PDF_COORDINATES[variableName];
  page.drawText(value.trim(), {
    x: coords.x,
    y: coords.y,
    size: FONT_SIZE,
    font,
    maxWidth: coords.width,
  });
};

const fitTextToWidth = (
  text: string,
  maxWidth: number,
  font: PDFFont
): { fitted: string; rest: string } => {
  const cleanText = text.trim();
  if (!cleanText) return { fitted: '', rest: '' };
  if (font.widthOfTextAtSize(cleanText, FONT_SIZE) <= maxWidth) {
    return { fitted: cleanText, rest: '' };
  }

  const words = cleanText.split(/\s+/);
  let fitted = '';

  for (let index = 0; index < words.length; index += 1) {
    const nextCandidate = fitted ? `${fitted} ${words[index]}` : words[index];
    if (font.widthOfTextAtSize(nextCandidate, FONT_SIZE) <= maxWidth) {
      fitted = nextCandidate;
      continue;
    }

    if (!fitted) {
      let chunk = '';
      for (const char of words[index]) {
        const nextChunk = `${chunk}${char}`;
        if (font.widthOfTextAtSize(nextChunk, FONT_SIZE) <= maxWidth) {
          chunk = nextChunk;
        } else {
          break;
        }
      }

      const restWord = words[index].slice(chunk.length);
      const restWords = [restWord, ...words.slice(index + 1)].filter(Boolean).join(' ');
      return { fitted: chunk, rest: restWords.trim() };
    }

    const rest = words.slice(index).join(' ');
    return { fitted: fitted.trim(), rest: rest.trim() };
  }

  return { fitted: fitted.trim(), rest: '' };
};

const drawIndications = (page: PDFPage, font: PDFFont, indications: string[]): void => {
  const printableLines = Array.from(
    { length: MEDICAL_INDICATIONS_LINE_FIELD_NAMES.length },
    () => ''
  );
  let lineCursor = 0;

  indications
    .map(item => item.trim())
    .filter(Boolean)
    .forEach((indication, index) => {
      let remainingText = `${index + 1}. ${indication}`.trim();
      while (remainingText && lineCursor < printableLines.length) {
        const fieldName = MEDICAL_INDICATIONS_LINE_FIELD_NAMES[lineCursor];
        const maxWidth = MEDICAL_INDICATIONS_PDF_COORDINATES[fieldName].width;
        const { fitted, rest } = fitTextToWidth(remainingText, maxWidth, font);
        printableLines[lineCursor] = fitted;
        remainingText = rest;
        lineCursor += 1;
      }
    });

  printableLines.forEach((value, index) => {
    const fieldName = MEDICAL_INDICATIONS_LINE_FIELD_NAMES[index];
    drawFieldText(page, font, fieldName, value);
  });
};

export const fillMedicalIndicationsPdf = async (
  data: MedicalIndicationsPdfData
): Promise<Uint8Array> => {
  const { PDFDocument, StandardFonts } = await loadPdfLibGenerationRuntime();
  const templateBytes = await loadMedicalIndicationsTemplateBytes();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPage(0);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  drawFieldText(page, font, 'paciente_nombre', data.paciente_nombre);
  drawFieldText(page, font, 'paciente_rut', data.paciente_rut);
  drawFieldText(page, font, 'paciente_diagnostico', data.paciente_diagnostico);
  drawFieldText(page, font, 'paciente_edad', data.paciente_edad);
  drawFieldText(page, font, 'fecha_nacimiento', data.fecha_nacimiento);
  drawFieldText(page, font, 'paciente_alergias', data.paciente_alergias);
  drawFieldText(page, font, 'medicotratante', data.medicotratante);
  drawFieldText(page, font, 'fecha_ingreso', formatMedicalIndicationsDate(data.fecha_ingreso));
  drawFieldText(page, font, 'fecha_actual', data.fecha_actual);
  drawFieldText(page, font, 'diasEstada', data.diasEstada);
  drawFieldText(page, font, 'Reposoindicacion', data.Reposoindicacion);
  drawFieldText(page, font, 'Regimenindicacion', data.Regimenindicacion);
  drawFieldText(page, font, 'Kinemotora', data.Kinemotora);
  drawFieldText(page, font, 'Kinerespiratoria', data.Kinerespiratoria);
  drawFieldText(page, font, 'Kinecantidadvecesdia', data.Kinecantidadvecesdia);
  drawFieldText(page, font, 'Pendientes', data.Pendientes);

  if (data.fecha_generacion?.trim()) {
    page.drawText(`Generado el ${data.fecha_generacion.trim()}`, {
      x: 305,
      y: 399,
      size: 8,
      font,
      maxWidth: 210,
    });
  }

  drawIndications(page, font, data.indicaciones);

  return pdfDoc.save();
};

const isPdfFile = (bytes: ArrayBuffer): boolean => {
  const headerBytes = new Uint8Array(bytes.slice(0, PDF_HEADER.length));
  const header = String.fromCharCode(...headerBytes);
  return header === PDF_HEADER;
};

const loadMedicalIndicationsTemplateBytes = async (): Promise<ArrayBuffer> => {
  const templatePaths = [
    MEDICAL_INDICATIONS_PDF_TEMPLATE_PATH,
    ...MEDICAL_INDICATIONS_PDF_TEMPLATE_FALLBACK_PATHS,
  ];

  for (const templatePath of templatePaths) {
    const templateResponse = await fetch(templatePath);
    if (!templateResponse.ok) continue;

    const bytes = await templateResponse.arrayBuffer();
    if (isPdfFile(bytes)) {
      return bytes;
    }
  }

  throw new Error('No se pudo cargar la plantilla PDF de indicaciones médicas.');
};

export const printMedicalIndicationsPdf = async (
  data: MedicalIndicationsPdfData
): Promise<void> => {
  const bytes = await fillMedicalIndicationsPdf(data);
  await openPdfPrintDialog(bytes, `indicaciones-medicas-${data.paciente_nombre || 'paciente'}.pdf`);
};
