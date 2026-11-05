import type { MMRADExam } from '@/services/radiology/mmradService';
import {
  formatMmradStamp,
  mmradStampSortKey,
  sortByMmradStampDesc,
} from '@/services/radiology/mmradStamp';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Stamp reading lives with the MMRAD service, shared with the radiology modal.
export const studySortKey = (exam: Pick<MMRADExam, 'fecha_examen'>): string =>
  mmradStampSortKey(exam.fecha_examen);
export const sortStudiesNewestFirst = sortByMmradStampDesc;
export const formatStudyStamp = formatMmradStamp;

export const isCtStudy = (exam: Pick<MMRADExam, 'mod'>): boolean =>
  exam.mod.trim().toUpperCase() === 'CT';

export const studyKey = (exam: MMRADExam): string =>
  [exam.nombre_examen, exam.fecha_examen, exam.dicom_url ?? '', exam.pdf_url ?? ''].join('|');

/** MMRAD only accepts ISO days as bounds; anything else would silently widen the search. */
export const asMmradDateBound = (iso: string | undefined): string | undefined =>
  iso && ISO_DAY.test(iso) ? iso : undefined;
