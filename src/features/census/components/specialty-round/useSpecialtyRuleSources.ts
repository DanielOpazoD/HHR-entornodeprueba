import { useEffect, useRef, useState } from 'react';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { DiagnosisAssociation } from './specialtyRulesHistoryModel';
import {
  historicalMonthRange,
  summarizeHistoricalAssociations,
} from './specialtyRulesHistoryModel';

/** The live census is read once only when the panel was opened from another day. */
export const useSpecialtyRuleSources = (
  date: string,
  beds: Record<string, PatientData> | null,
  today: string
) => {
  const [current, setCurrent] = useState<{
    day: string;
    beds: Record<string, PatientData> | null;
    state: 'loading' | 'ready' | 'missing' | 'error';
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7));
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [history, setHistory] = useState<DiagnosisAssociation[]>([]);
  const historyRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (date === today) return;
    let active = true;
    setCurrent({ day: today, beds: null, state: 'loading' });
    void import('@/services/storage/firestore/firestoreRecordQueries')
      .then(service => service.getRecordFromFirestoreDetailed(today, { source: 'server' }))
      .then(result => {
        if (!active) return;
        const available = result.status === 'resolved' && result.record;
        setCurrent({
          day: today,
          beds: available ? result.record!.beds : null,
          state: available ? 'ready' : result.status === 'missing' ? 'missing' : 'error',
        });
      })
      .catch(() => {
        if (active) setCurrent({ day: today, beds: null, state: 'error' });
      });
    return () => {
      active = false;
    };
  }, [date, today, retry]);

  const changeHistoryMonth = (month: string) => {
    historyRequestRef.current += 1;
    setHistoryMonth(month);
    setHistoryState('idle');
    setHistory([]);
  };

  const loadHistory = async () => {
    const request = ++historyRequestRef.current;
    const range = historicalMonthRange(historyMonth, today);
    setHistoryState('loading');
    setHistory([]);
    if (!range) {
      setHistoryState('ready');
      return;
    }
    try {
      const service = await import('@/services/storage/firestore/firestoreRecordQueries');
      const records = await service.getRecordsRangeFromFirestore(range.start, range.end, {
        requireServer: true,
      });
      if (!mountedRef.current || request !== historyRequestRef.current) return;
      setHistory(summarizeHistoricalAssociations(records));
      setHistoryState('ready');
    } catch {
      if (mountedRef.current && request === historyRequestRef.current) setHistoryState('error');
    }
  };

  const remoteAvailable = date !== today && current?.day === today && current.state === 'ready';
  return {
    currentBeds: remoteAvailable ? current.beds : beds,
    currentDate: remoteAvailable ? today : date,
    currentError: date !== today && current?.day === today && current.state === 'error',
    retryCurrent: () => setRetry(value => value + 1),
    historyMonth,
    historyState,
    history,
    changeHistoryMonth,
    loadHistory,
  };
};
