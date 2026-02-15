import { useEffect, useRef, useState } from 'react';
import type { DailyRecord } from '@/types';

interface UseMoveCopyTargetRecordParams {
  isOpen: boolean;
  selectedDate: string;
  currentRecord: DailyRecord | null;
  getRecordForDate: (date: string) => Promise<DailyRecord | null>;
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
}: UseMoveCopyTargetRecordParams): UseMoveCopyTargetRecordResult => {
  const [targetRecord, setTargetRecord] = useState<DailyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setTargetRecord(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let disposed = false;

    const loadTargetRecord = async () => {
      if (!selectedDate || selectedDate === currentRecord?.date) {
        setTargetRecord(currentRecord);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const fetchedRecord = await getRecordForDate(selectedDate);
        if (!disposed && requestId === requestIdRef.current) {
          setTargetRecord(fetchedRecord);
        }
      } catch (error) {
        if (!disposed && requestId === requestIdRef.current) {
          console.error('Failed to fetch target record', error);
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
  }, [currentRecord, getRecordForDate, isOpen, selectedDate]);

  return {
    targetRecord,
    isLoading,
  };
};
