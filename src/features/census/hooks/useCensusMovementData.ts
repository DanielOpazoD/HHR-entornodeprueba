import { useDailyRecordData, useDailyRecordMovements } from '@/context/DailyRecordContext';

type DailyMovements = NonNullable<ReturnType<typeof useDailyRecordMovements>>;

interface UseCensusMovementDataResult {
  recordDate: string;
  discharges: DailyMovements['discharges'] | null | undefined;
  transfers: DailyMovements['transfers'] | null | undefined;
  cma: DailyMovements['cma'] | null | undefined;
}

export const useCensusMovementData = (): UseCensusMovementDataResult => {
  const { record } = useDailyRecordData();
  const movements = useDailyRecordMovements();

  return {
    recordDate: record?.date || '',
    discharges: movements?.discharges,
    transfers: movements?.transfers,
    cma: movements?.cma,
  };
};
