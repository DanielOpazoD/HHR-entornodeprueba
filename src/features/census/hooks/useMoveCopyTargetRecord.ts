import { useEffect, useRef, useState } from 'react';
import type { DailyRecord } from '@/types';
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
  const currentRecordRef = useLatestRef(currentRecord);
  const getRecordForDateRef = useLatestRef(getRecordForDate);
  const onErrorRef = useLatestRef(onError);
  const currentRecordDate = currentRecord?.date ?? '';

  useEffect(() => {
    if (!isOpen) {
      setTargetRecord(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let disposed = false;

    const loadTargetRecord = async () => {
      const record = currentRecordRef.current;

      if (!selectedDate || selectedDate === record?.date) {
        setTargetRecord(record);
        setIsLoading(false);
        return;
      }

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
  }, [currentRecordDate, currentRecordRef, getRecordForDateRef, isOpen, onErrorRef, selectedDate]);

  return {
    targetRecord,
    isLoading,
  };
};
