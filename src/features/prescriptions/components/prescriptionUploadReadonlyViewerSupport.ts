import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

export type PrescriptionUploadViewerDayKey = 'today' | 'yesterday';

export interface PrescriptionUploadViewerDayOption {
  key: PrescriptionUploadViewerDayKey;
  label: 'Hoy' | 'Ayer';
  isoDate: string;
  displayDate: string;
}

export const formatPrescriptionUploadViewerDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}-${month}-${year}`;
};

export const buildPrescriptionUploadViewerDayOptions = (
  now = new Date()
): PrescriptionUploadViewerDayOption[] => {
  const todayIso = getClinicalCalendarDateISO(now);
  const yesterday = new Date(`${todayIso}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  return [
    {
      key: 'today',
      label: 'Hoy',
      isoDate: todayIso,
      displayDate: formatPrescriptionUploadViewerDate(todayIso),
    },
    {
      key: 'yesterday',
      label: 'Ayer',
      isoDate: yesterdayIso,
      displayDate: formatPrescriptionUploadViewerDate(yesterdayIso),
    },
  ];
};
