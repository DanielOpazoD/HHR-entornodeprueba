import { useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';

type DailyMovements = NonNullable<ReturnType<typeof useDailyRecordMovements>>;

interface UseCensusMovementDataResult {
  recordDate: string;
  discharges: DailyMovements['discharges'] | null | undefined;
  transfers: DailyMovements['transfers'] | null | undefined;
  cma: DailyMovements['cma'] | null | undefined;
}

export const useCensusMovementData = (): UseCensusMovementDataResult => {
  const staff = useDailyRecordStaff();
  const movements = useDailyRecordMovements();

  return {
    recordDate: staff?.date || '',
    discharges: movements?.discharges,
    transfers: movements?.transfers,
    cma: movements?.cma,
  };
};
