import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useLatestRef } from '@/hooks/useLatestRef';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

interface UseMoveCopyTargetRecordParams {
  isOpen: boolean;
  selectedDate: string;
  currentRecord: DailyRecord | null;
  getRecordForDate: (date: string) => Promise<DailyRecord | null>;
}

interface UseMoveCopyTargetRecordResult {
  targetRecord: DailyRecord | null;
  isLoading: boolean;
  loadFailed: boolean;
  retry: () => void;
}

export const useMoveCopyTargetRecord = ({
  isOpen,
  selectedDate,
  currentRecord,
  getRecordForDate,
}: UseMoveCopyTargetRecordParams): UseMoveCopyTargetRecordResult => {
  const [targetRecord, setTargetRecord] = useState<DailyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const requestIdRef = useRef(0);
  const getRecordForDateRef = useLatestRef(getRecordForDate);
  const currentRecordDate = currentRecord?.date ?? '';
  const useCurrentRecord = !selectedDate || selectedDate === currentRecordDate;

  const loadsTarget = isOpen && !useCurrentRecord;
  if (useChangedOnRender([currentRecordDate, isOpen, selectedDate, useCurrentRecord])) {
    // Prevent stale availability or errors from a previous date while loading a new target day.
    setTargetRecord(null);
    setLoadFailed(false);
    setIsLoading(loadsTarget);
  }

  const retry = useCallback(() => {
    if (!isOpen || useCurrentRecord) return;
    setTargetRecord(null);
    setLoadFailed(false);
    setIsLoading(true);
    setRetryCount(count => count + 1);
  }, [isOpen, useCurrentRecord]);

  useEffect(() => {
    if (!isOpen || useCurrentRecord) return;

    const requestId = ++requestIdRef.current;
    let disposed = false;

    const loadTargetRecord = async () => {
      try {
        const fetchedRecord = await getRecordForDateRef.current(selectedDate);
        if (!disposed && requestId === requestIdRef.current) {
          setTargetRecord(fetchedRecord);
          setLoadFailed(false);
        }
      } catch {
        if (!disposed && requestId === requestIdRef.current) {
          setTargetRecord(null);
          setLoadFailed(true);
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
  }, [currentRecordDate, getRecordForDateRef, isOpen, retryCount, selectedDate, useCurrentRecord]);

  return {
    targetRecord: !isOpen ? null : useCurrentRecord ? currentRecord : targetRecord,
    isLoading: isOpen && !useCurrentRecord && isLoading,
    loadFailed: isOpen && !useCurrentRecord && loadFailed,
    retry,
  };
};
