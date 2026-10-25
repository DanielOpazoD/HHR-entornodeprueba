import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

export interface ClinicalEventFormData {
  name: string;
  date: string;
  note: string;
}

export const EMPTY_CLINICAL_EVENT_FORM: ClinicalEventFormData = {
  name: '',
  date: '',
  note: '',
};

export const buildClinicalEventToday = (isoNow: string): string =>
  getClinicalCalendarDateISO(new Date(isoNow));

export const buildClinicalEventAddForm = (today: string): ClinicalEventFormData => ({
  name: '',
  date: today,
  note: '',
});

export const buildClinicalEventEditForm = (event: ClinicalEvent): ClinicalEventFormData => ({
  name: event.name,
  date: event.date,
  note: event.note || '',
});

export const canSaveClinicalEventForm = (formData: ClinicalEventFormData): boolean =>
  formData.name.trim().length > 0 && formData.date.length > 0;

export const buildClinicalEventSubmission = (
  formData: ClinicalEventFormData
): Omit<ClinicalEvent, 'id' | 'createdAt'> => ({
  name: formData.name.trim(),
  date: formData.date,
  note: formData.note.trim() || undefined,
});

export const sortClinicalEventsByDateDesc = (events: ClinicalEvent[]): ClinicalEvent[] =>
  [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
