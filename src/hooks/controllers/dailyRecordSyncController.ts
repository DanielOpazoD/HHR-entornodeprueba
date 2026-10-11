import type { DailyRecordDateRef } from '@/application/shared/dailyRecordCoreContracts';

interface PreviousDayReader {
  getPreviousDay: (date: string) => Promise<DailyRecordDateRef | null>;
}

interface WarningNotifier {
  (title: string, message: string): void;
}

export const resolveCreateDaySourceDate = async (
  dailyRecord: PreviousDayReader,
  currentDateString: string,
  copyFromPrevious: boolean,
  specificDate: string | undefined,
  warning: WarningNotifier
) => {
  if (!copyFromPrevious) {
    return undefined;
  }

  if (specificDate) {
    return specificDate;
  }

  const previousRecord = await dailyRecord.getPreviousDay(currentDateString);
  if (!previousRecord) {
    warning('No se encontró registro anterior', 'No hay datos del día previo para copiar.');
    return null;
  }

  return previousRecord.date;
};

export const buildCreateDaySuccessMessage = (sourceDate?: string) =>
  sourceDate ? `Copiado desde ${sourceDate}` : 'Registro en blanco';
