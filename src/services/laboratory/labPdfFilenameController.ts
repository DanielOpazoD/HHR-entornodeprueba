import type { SyslabExamItem } from '@/types/domain/labExamTypes';

const MULTIPLE_SPACES = /\s+/g;

const normalizedDate = (value: string): { key: string; label: string } | null => {
  const dayFirst = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  const yearFirst = value.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : yearFirst
      ? { day: yearFirst[3], month: yearFirst[2], year: yearFirst[1] }
      : null;
  if (!parts) return null;

  const day = parts.day.padStart(2, '0');
  const month = parts.month.padStart(2, '0');
  return { key: `${parts.year}-${month}-${day}`, label: `${day}-${month}-${parts.year}` };
};

const safeFilenamePart = (value: string, fallback: string): string =>
  [...value]
    .filter(character => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(MULTIPLE_SPACES, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '') || fallback;

export const resolveLabPdfDateLabel = (exams: SyslabExamItem[]): string => {
  const dates = new Map<string, string>();
  exams.forEach(exam => {
    const date = normalizedDate(exam.date);
    if (date) dates.set(date.key, date.label);
  });
  const ordered = [...dates.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (ordered.length === 0) return 'sin fecha';
  if (ordered.length === 1) return ordered[0][1];
  return `${ordered[0][1]} a ${ordered.at(-1)![1]}`;
};

export const buildLabPdfFilename = (exams: SyslabExamItem[], rut: string): string => {
  const patientName = exams.find(exam => exam.patientName.trim())?.patientName || 'Paciente';
  const base = [
    `Laboratorio HHR ${resolveLabPdfDateLabel(exams)}`,
    safeFilenamePart(patientName, 'Paciente'),
    safeFilenamePart(rut, 'RUT no informado'),
  ].join(', ');
  return `${base.slice(0, 190).trim()}.pdf`;
};
