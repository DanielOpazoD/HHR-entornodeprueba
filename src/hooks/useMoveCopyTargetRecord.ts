import { useEffect, useRef, useState } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useLatestRef } from '@/hooks/useLatestRef';

interface UseMoveCopyTargetRecordParams {
  isOpen: boolean;
  selectedDate: string;
  currentRecord: DailyRecord | null;
  getRecordForDate: (date: string) => Promise<DailyRecord | null>;
  onError?: (error: unknown) => void;
}

interface UseMoveCopyTargetRecordResult {
  targetRecord: DailyRecord | null;
  isLoading: boolean;
}

export const useMoveCopyTargetRecord = ({
  isOpen,
  selectedDate,
  currentRecord,
  getRecordForDate,
  onError,
}: UseMoveCopyTargetRecordParams): UseMoveCopyTargetRecordResult => {
  const [targetRecord, setTargetRecord] = useState<DailyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const getRecordForDateRef = useLatestRef(getRecordForDate);
  const onErrorRef = useLatestRef(onError);
  const currentRecordDate = currentRecord?.date ?? '';
  const useCurrentRecord = !selectedDate || selectedDate === currentRecordDate;

  useEffect(() => {
    if (!isOpen || useCurrentRecord) {
      setTargetRecord(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let disposed = false;

    const loadTargetRecord = async () => {
      // Prevent stale availability from previous date while loading a new target day.
      setTargetRecord(null);
      setIsLoading(true);

      try {
        const fetchedRecord = await getRecordForDateRef.current(selectedDate);
        if (!disposed && requestId === requestIdRef.current) {
          setTargetRecord(fetchedRecord);
        }
      } catch (error) {
        if (!disposed && requestId === requestIdRef.current) {
          setTargetRecord(null);
          onErrorRef.current?.(error);
        }
      } finally {
        if (!disposed && requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadTargetRecord();

    return () => {
      disposed = true;
    };
  }, [currentRecordDate, getRecordForDateRef, isOpen, onErrorRef, selectedDate, useCurrentRecord]);

  return {
    targetRecord: !isOpen ? null : useCurrentRecord ? currentRecord : targetRecord,
    isLoading: isOpen && !useCurrentRecord && isLoading,
  };
};
