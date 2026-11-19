import { formatCensusIsoDate } from '@/shared/census/censusPresentation';
import { formatCalendarDate } from '@/utils/dateDisplayUtils';

export const formatHandoffDate = (isoDate?: string | null): string => {
  if (!isoDate) {
    return 'Sin fecha';
  }

  return formatCensusIsoDate(isoDate);
};

export const formatHandoffVerboseDate = (isoDate?: string | null): string => {
  if (!isoDate) {
    return 'Sin fecha';
  }

  return (
    formatCalendarDate(isoDate, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) ?? isoDate
  );
};

export const resolveHandoffDocumentDate = (recordDate?: string): string | null => {
  if (!recordDate) {
    return null;
  }

  const formatted = formatHandoffDate(recordDate);
  return formatted === recordDate ? null : formatted;
};

export const resolveHandoffDocumentTitleLabel = ({
  selectedShift,
  recordDate,
}: {
  selectedShift: 'day' | 'night';
  recordDate?: string;
}): string | null => {
  const formattedDate = resolveHandoffDocumentDate(recordDate);
  if (!formattedDate) {
    return null;
  }

  return `${selectedShift === 'day' ? 'TL' : 'TN'} ${formattedDate}`;
};
