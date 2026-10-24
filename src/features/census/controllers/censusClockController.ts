import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
type DateProvider = () => Date;

export const formatClockTimeHHMM = (date: Date): string =>
  calendarStampInClinicalTimeZone(date).hhmm;

export const getCurrentClockTimeHHMM = (dateProvider: DateProvider = () => new Date()): string =>
  formatClockTimeHHMM(dateProvider());
