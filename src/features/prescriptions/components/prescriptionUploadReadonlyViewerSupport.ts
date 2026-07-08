export type PrescriptionUploadViewerDayKey = 'today' | 'yesterday';

export interface PrescriptionUploadViewerDayOption {
  key: PrescriptionUploadViewerDayKey;
  label: 'Hoy' | 'Ayer';
  isoDate: string;
  displayDate: string;
}

const padDatePart = (value: number): string => String(value).padStart(2, '0');

const toLocalIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const formatPrescriptionUploadViewerDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}-${month}-${year}`;
};

export const buildPrescriptionUploadViewerDayOptions = (
  now = new Date()
): PrescriptionUploadViewerDayOption[] => {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);

  const todayIso = toLocalIsoDate(today);
  const yesterdayIso = toLocalIsoDate(yesterday);

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
