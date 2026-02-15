import type { BedDefinition, DailyRecord } from '@/types';

export interface MoveCopyDateOption {
  label: 'Ayer' | 'Hoy' | 'Mañana';
  offset: -1 | 0 | 1;
}

export interface MoveCopyDateOptionModel extends MoveCopyDateOption {
  isoDate: string;
  displayDate: string;
}

export interface MoveCopyBedOptionModel {
  id: string;
  name: string;
  isOccupied: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  statusLabel: 'Ocupada' | 'Libre';
}

const MOVE_COPY_DATE_OPTIONS: readonly MoveCopyDateOption[] = [
  { label: 'Ayer', offset: -1 },
  { label: 'Hoy', offset: 0 },
  { label: 'Mañana', offset: 1 },
] as const;

const parseIsoDate = (isoDate: string): Date | null => {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const addDaysToIsoDate = (baseDate: string, days: number): string => {
  const parsed = parseIsoDate(baseDate);
  if (!parsed) {
    return baseDate;
  }

  parsed.setDate(parsed.getDate() + days);
  return toIsoDate(parsed);
};

export const buildMoveCopyDateOptions = (
  baseDate: string,
  locale: string = 'es-CL'
): MoveCopyDateOptionModel[] =>
  MOVE_COPY_DATE_OPTIONS.map(option => {
    const isoDate = addDaysToIsoDate(baseDate, option.offset);
    const parsed = parseIsoDate(isoDate);

    return {
      ...option,
      isoDate,
      displayDate: parsed
        ? parsed.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
        : '--/--',
    };
  });

export const resolveMoveCopyBaseDate = (
  currentRecordDate: string | undefined,
  fallbackDate: string
): string => {
  if (!currentRecordDate) {
    return fallbackDate;
  }

  return parseIsoDate(currentRecordDate) ? currentRecordDate : fallbackDate;
};

interface ResolveMoveCopyBedOptionsParams {
  allBeds: BedDefinition[];
  currentRecord: DailyRecord;
  targetRecord: DailyRecord | null;
  sourceBedId: string | null;
  targetBedId: string | null;
}

export const resolveMoveCopySourceBedName = (
  allBeds: BedDefinition[],
  sourceBedId: string | null
): string => allBeds.find(bed => bed.id === sourceBedId)?.name || '';

export const resolveMoveCopyBedOptions = ({
  allBeds,
  currentRecord,
  targetRecord,
  sourceBedId,
  targetBedId,
}: ResolveMoveCopyBedOptionsParams): MoveCopyBedOptionModel[] => {
  const activeExtraBeds = targetRecord?.activeExtraBeds || currentRecord.activeExtraBeds || [];
  const visibleBeds = allBeds.filter(bed => !bed.isExtra || activeExtraBeds.includes(bed.id));

  return visibleBeds
    .filter(bed => bed.id !== sourceBedId)
    .map(bed => {
      const hasPatientName = Boolean(targetRecord?.beds?.[bed.id]?.patientName);
      const isSelected = targetBedId === bed.id;

      return {
        id: bed.id,
        name: bed.name,
        isOccupied: hasPatientName,
        isDisabled: hasPatientName,
        isSelected,
        statusLabel: hasPatientName ? 'Ocupada' : 'Libre',
      };
    });
};
