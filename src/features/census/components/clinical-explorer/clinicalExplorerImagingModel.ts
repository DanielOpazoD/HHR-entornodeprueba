import type { MMRADExam } from '@/services/radiology/mmradService';

/** MMRAD stamps: "DD/MM/YYYY", "DD/MM/YYYY HH:MM", sometimes with dots or dashes. */
const STAMP = /(\d{2})[/.-](\d{2})[/.-](\d{4})(?:\s+(\d{2}):(\d{2}))?/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Sortable "YYYY-MM-DD HH:MM" from an MMRAD stamp; an unreadable stamp sorts last. */
export const studySortKey = (exam: Pick<MMRADExam, 'fecha_examen'>): string => {
  const [, day, month, year, hours = '00', minutes = '00'] = STAMP.exec(exam.fecha_examen) ?? [];
  return day && month && year ? `${year}-${month}-${day} ${hours}:${minutes}` : '';
};

export const sortStudiesNewestFirst = <T extends Pick<MMRADExam, 'fecha_examen'>>(
  exams: readonly T[]
): T[] => [...exams].sort((a, b) => studySortKey(b).localeCompare(studySortKey(a)));

/** The study date as the app writes dates: DD-MM-YYYY and, when MMRAD gives it, HH:MM. */
export const formatStudyStamp = (fecha: string): string => {
  const [, day, month, year, hours, minutes] = STAMP.exec(fecha) ?? [];
  if (!day || !month || !year) return fecha;
  return `${day}-${month}-${year}${hours && minutes ? ` ${hours}:${minutes}` : ''}`;
};

export const isCtStudy = (exam: Pick<MMRADExam, 'mod'>): boolean =>
  exam.mod.trim().toUpperCase() === 'CT';

export const studyKey = (exam: MMRADExam): string =>
  [exam.nombre_examen, exam.fecha_examen, exam.dicom_url ?? '', exam.pdf_url ?? ''].join('|');

/** MMRAD only accepts ISO days as bounds; anything else would silently widen the search. */
export const asMmradDateBound = (iso: string | undefined): string | undefined =>
  iso && ISO_DAY.test(iso) ? iso : undefined;
