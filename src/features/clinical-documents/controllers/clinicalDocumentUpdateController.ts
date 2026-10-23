/**
 * Clinical Document Update Controller
 *
 * Pure logic for creating clinical update sections.
 * Each update is a section with kind: 'clinical-update',
 * auto-populated date/time, and a unique incremental ID.
 */

import type { ClinicalDocumentSection } from '@/features/clinical-documents/domain/entities';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

/**
 * Creates a new clinical update section with the current date and time.
 *
 * @param existingSections - Current sections to calculate next order
 * @returns A new section configured as a clinical update
 */
export const createClinicalUpdateSection = (
  existingSections: ClinicalDocumentSection[]
): ClinicalDocumentSection => {
  const now = new Date();
  const maxOrder = existingSections.reduce((max, s) => Math.max(max, s.order), 0);
  const updateCount = existingSections.filter(s => s.kind === 'clinical-update').length;

  return {
    id: `clinical-update-${updateCount + 1}-${Date.now()}`,
    title: 'Actualización clínica',
    content: '',
    kind: 'clinical-update',
    order: maxOrder + 1,
    required: false,
    visible: true,
    updateDate: formatDateISO(now),
    updateTime: formatTime(now),
  };
};

/** Hospital calendar date of `date`, YYYY-MM-DD. */
const formatDateISO = (date: Date): string => calendarStampInClinicalTimeZone(date).iso;

/** Hospital wall-clock time of `date`, HH:MM. */
const formatTime = (date: Date): string => calendarStampInClinicalTimeZone(date).hhmm;
