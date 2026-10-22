import type { PatientData } from '@/services/contracts/patientServiceContracts';
import { calculateAge, formatDateToCL, splitPatientName } from '@/utils/clinicalUtils';
import { calculateDischargeStayDays } from '@/utils/clinicalDayUtils';
import type { DischargeFormData } from './ieehPdfContracts';
import { getTodayISO } from '@/utils/dateCoreUtils';

const CHAR_SPACING = 1;

export { calculateAge, splitPatientName };

export const parseDate = (
  dateStr: string | undefined
): { dia: string; mes: string; anio: string } | null => {
  if (!dateStr) return null;
  const normalized = formatDateToCL(dateStr);
  const parts = normalized.split('-');
  if (parts.length !== 3) return null;
  return { dia: parts[0], mes: parts[1], anio: parts[2] };
};

export const parseTime = (timeStr: string | undefined): { hora: string; min: string } | null => {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  return { hora: parts[0], min: parts[1] };
};

export const resolveDischargeDiagnosis = (
  patient: PatientData,
  discharge: DischargeFormData
): { diagnostico: string; cie10: string } => ({
  diagnostico:
    discharge.diagnosticoPrincipal || patient.cie10Description || patient.pathology || '',
  cie10: discharge.cie10Code || patient.cie10Code || '',
});

export const drawOptionalText = (
  drawText: (
    text: string,
    coords: { x: number; y: number; maxWidth: number },
    options?: { fontSize?: number; bold?: boolean }
  ) => void,
  text: string | undefined,
  coords: { x: number; y: number; maxWidth: number },
  options?: { fontSize?: number; bold?: boolean }
) => {
  if (!text) return;
  drawText(text, coords, options);
};

const measureTextWidth = (
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number
): number => {
  if (!text) return 0;
  let width = 0;
  for (const [index, char] of [...text].entries()) {
    width += font.widthOfTextAtSize(char, fontSize);
    if (index < text.length - 1) {
      width += CHAR_SPACING;
    }
  }
  return width;
};

export const wrapTextByWidth = (
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number
): string[] => {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  const pushLine = () => {
    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }
  };

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (measureTextWidth(candidate, font, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      pushLine();
    }

    if (measureTextWidth(word, font, fontSize) <= maxWidth) {
      currentLine = word;
      continue;
    }

    let fragment = '';
    for (const char of word) {
      const nextFragment = `${fragment}${char}`;
      if (measureTextWidth(nextFragment, font, fontSize) <= maxWidth) {
        fragment = nextFragment;
      } else {
        if (fragment) {
          lines.push(fragment);
        }
        fragment = char;
      }
    }
    currentLine = fragment;
  }

  pushLine();
  return lines;
};

export const calculateDaysOfStay = (
  admissionDate: string | undefined,
  dischargeDate: string | undefined
): number => {
  return calculateDischargeStayDays(admissionDate, dischargeDate) ?? 0;
};

export const buildIEEHFileName = (patientName: string | undefined): string => {
  const safeName = (patientName || 'paciente')
    .replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `IEEH_${safeName}_${getTodayISO()}.pdf`;
};
