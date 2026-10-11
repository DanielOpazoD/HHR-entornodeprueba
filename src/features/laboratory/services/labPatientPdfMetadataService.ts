import { fetchSyslabPdfArrayBuffer } from '@/services/laboratory/syslabService';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { extractPdfText, normalizePdfText } from './labPdfTextSupport';

const toIsoBirthDate = (day: string, month: string, year: string): string | null => {
  const fullYear = year.length === 2 ? `19${year}` : year;
  const dd = day.padStart(2, '0');
  const mm = month.padStart(2, '0');
  const yyyy = fullYear.padStart(4, '0');
  // Validate a calendar date in the same UTC frame used by the component checks below.
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(yyyy) ||
    date.getUTCMonth() + 1 !== Number(mm) ||
    date.getUTCDate() !== Number(dd)
  ) {
    return null;
  }

  return `${yyyy}-${mm}-${dd}`;
};

export const parseLabPatientBirthDateFromPdfText = (text: string): string | null => {
  const normalized = normalizePdfText(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');

  const slashMatch = normalized.match(
    /(?:Fecha\s*(?:de\s*)?Nac(?:imiento)?\.?|F\.\s*Nac\.?|Nacimiento)\s*:?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/i
  );
  if (slashMatch) {
    return toIsoBirthDate(slashMatch[1], slashMatch[2], slashMatch[3]);
  }

  const isoMatch = normalized.match(
    /(?:Fecha\s*(?:de\s*)?Nac(?:imiento)?\.?|F\.\s*Nac\.?|Nacimiento)\s*:?\s*(\d{4})-(\d{1,2})-(\d{1,2})/i
  );
  if (isoMatch) {
    return toIsoBirthDate(isoMatch[3], isoMatch[2], isoMatch[1]);
  }

  return null;
};

export const resolveLabPatientBirthDateFromPdf = async (
  examList: SyslabExamItem[]
): Promise<string | undefined> => {
  const examWithPdf = examList.find(exam => Boolean(exam.link));
  if (!examWithPdf?.link) {
    return undefined;
  }

  try {
    const buffer = await fetchSyslabPdfArrayBuffer(examWithPdf.link);
    const text = await extractPdfText(buffer);
    return parseLabPatientBirthDateFromPdfText(text) ?? undefined;
  } catch {
    return undefined;
  }
};
