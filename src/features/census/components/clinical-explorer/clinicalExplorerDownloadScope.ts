/**
 * What belongs to this hospitalization in each source of the explorer download (ID-01): the stays
 * the extension's ZIP summary lists, the CT studies of the episode's days and the Syslab reports
 * still pending inside the chosen range. Pure helpers, kept apart from the outcome model.
 */
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import type { MMRADExam } from '@/services/radiology/mmradService';
import { mmradStampSortKey } from '@/services/radiology/mmradStamp';
import type { DownloadRange, ListedStay } from './clinicalExplorerDownloadModel';

/**
 * Rows of a `;`-separated CSV with quoted cells, read as a whole: a quoted cell may hold `;`, `"` as
 * `""` and line breaks, so lines are never split before quotes are honoured.
 */
const readCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"' && text.charAt(index + 1) === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ';') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text.charAt(index + 1) === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stays listed in the extension's «00 Resumen.csv» (BOM, `;`, quoted cells): one per history
 * document, with its «Ingreso» and the PDF name when delivered. Null when unreadable, or when a
 * document row lacks a readable «Ingreso»: then no stay can be told apart safely.
 */
export const parseHistorySummary = (text: string): ListedStay[] | null => {
  // An odd number of quotes means a cell never closed: the summary was cut and cannot be trusted.
  if ((text.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const [header, ...rows] = readCsvRows(text.replace(/^\uFEFF/, ''));
  if (!header) return null;
  const start = header.indexOf('Ingreso');
  const file = header.indexOf('Archivo');
  const kind = header.indexOf('Documento');
  if (start < 0 || file < 0 || kind < 0) return null;
  const documents = rows.filter(cells => (cells[kind] ?? '').trim() !== '');
  if (documents.some(cells => !ISO_DAY.test(cells[start] ?? ''))) return null;
  return documents.map(cells => ({
    startDate: cells[start] ?? '',
    fileName: (cells[file] ?? '').trim(),
  }));
};

/**
 * CT studies of the episode's days. Seen from a past census, a study after that day may belong to a
 * later stay of the same RUN, so it is set apart for the person to know; seen from today's census
 * the stay is in course and nothing is cut.
 */
export const splitCtStudiesByDay = (
  studies: readonly MMRADExam[],
  lastDay: string | null
): { kept: MMRADExam[]; later: MMRADExam[] } => {
  if (!lastDay) return { kept: [...studies], later: [] };
  const later = studies.filter(exam => mmradStampSortKey(exam.fecha_examen).slice(0, 10) > lastDay);
  return { kept: studies.filter(exam => !later.includes(exam)), later };
};

const isoFromSyslabDate = (date: string): string => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};

/** ISO days of the reports Syslab listed but has not delivered yet; '' when the day is unknown. */
export const pendingReportDays = (
  exams: readonly SyslabExamItem[],
  pendingLinks: readonly string[]
): string[] =>
  pendingLinks.map(link => {
    const exam = exams.find(item => item.link === link);
    return exam ? isoFromSyslabDate(exam.date) : '';
  });

/** Pending reports that fall in the chosen range; one of unknown day counts, to be safe. */
export const countPendingInRange = (days: readonly string[], range: DownloadRange): number =>
  days.filter(day => !day || (day >= range.from && day <= range.to)).length;
