import { getNextDay, getPreviousDay, normalizeDateOnly } from '@/utils/clinicalDayUtils';

export interface AdmissionDateOption {
  value: string;
  label: string;
  isFallbackValue?: boolean;
}

const formatAdmissionDateOptionLabel = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

export const resolveAllowedAdmissionDates = (recordDate: string): string[] => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  if (!normalizedRecordDate) {
    return [];
  }

  return [
    getPreviousDay(normalizedRecordDate),
    normalizedRecordDate,
    getNextDay(normalizedRecordDate),
  ];
};

export const resolveAdmissionDateOptions = (
  recordDate: string,
  admissionDate?: string
): AdmissionDateOption[] => {
  const allowedDates = resolveAllowedAdmissionDates(recordDate);
  const options: AdmissionDateOption[] = allowedDates.map(value => ({
    value,
    label: formatAdmissionDateOptionLabel(value),
  }));

  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  if (normalizedAdmissionDate && !allowedDates.includes(normalizedAdmissionDate)) {
    options.unshift({
      value: normalizedAdmissionDate,
      label: formatAdmissionDateOptionLabel(normalizedAdmissionDate),
      isFallbackValue: true,
    });
  }

  return options;
};
