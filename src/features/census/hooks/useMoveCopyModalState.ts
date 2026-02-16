import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTodayISO } from '@/utils/dateUtils';
import {
  buildMoveCopyDateOptions,
  resolveMoveCopyBaseDate,
} from '@/features/census/controllers/moveCopyModalController';
import type { ActionType } from '@/features/census/types/censusActionTypes';

interface UseMoveCopyModalStateParams {
  isOpen: boolean;
  type: ActionType;
  currentRecordDate?: string;
  targetBedId: string | null;
  onSetTarget: (targetBedId: string) => void;
  onConfirm: (targetDate?: string) => void;
}

interface UseMoveCopyModalStateResult {
  selectedDate: string;
  dateOptions: ReturnType<typeof buildMoveCopyDateOptions>;
  canConfirm: boolean;
  setSelectedDate: (date: string) => void;
  handleDateSelect: (targetDate: string) => void;
  handleConfirm: () => void;
}

export const useMoveCopyModalState = ({
  isOpen,
  type,
  currentRecordDate,
  targetBedId,
  onSetTarget,
  onConfirm,
}: UseMoveCopyModalStateParams): UseMoveCopyModalStateResult => {
  const baseDate = useMemo(
    () => resolveMoveCopyBaseDate(currentRecordDate, getTodayISO()),
    [currentRecordDate]
  );
  const dateOptions = useMemo(() => buildMoveCopyDateOptions(baseDate), [baseDate]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    isOpen && currentRecordDate ? baseDate : ''
  );
  const openSignatureRef = useRef<string | null>(null);
  const selectedDateRef = useRef(selectedDate);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    if (!isOpen || !currentRecordDate) {
      openSignatureRef.current = null;
      return;
    }

    const currentSignature = `${currentRecordDate}|${baseDate}`;
    if (openSignatureRef.current === currentSignature) {
      return;
    }
    openSignatureRef.current = currentSignature;

    if (selectedDateRef.current === baseDate) {
      return;
    }

    queueMicrotask(() => {
      setSelectedDate(baseDate);
    });
  }, [baseDate, currentRecordDate, isOpen]);

  const handleDateSelect = useCallback(
    (targetDate: string) => {
      if (targetDate === selectedDate) {
        return;
      }

      setSelectedDate(targetDate);
      onSetTarget('');
    },
    [onSetTarget, selectedDate]
  );

  const canConfirm = Boolean(targetBedId) && (type !== 'copy' || Boolean(selectedDate));

  const handleConfirm = useCallback(() => {
    if (!canConfirm) {
      return;
    }

    onConfirm(type === 'copy' ? selectedDate : undefined);
  }, [canConfirm, onConfirm, selectedDate, type]);

  return {
    selectedDate,
    dateOptions,
    canConfirm,
    setSelectedDate,
    handleDateSelect,
    handleConfirm,
  };
};
