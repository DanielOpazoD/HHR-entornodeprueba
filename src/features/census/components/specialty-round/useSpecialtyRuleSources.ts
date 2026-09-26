import { useEffect, useRef, useState } from 'react';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { DiagnosisAssociation } from './specialtyRulesHistoryModel';
import { historicalMonthRange, summarizeHistoricalAssociations } from './specialtyRulesHistoryModel';

/** The live census is read once only when the panel was opened from another day. */
export const useSpecialtyRuleSources = (
  date: string, beds: Record<string, PatientData> | null, today: string
) => {
  const [remoteCurrentBeds, setRemoteCurrentBeds] = useState<Record<string, PatientData> | null>(null);
  const [currentError, setCurrentError] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7));
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [history, setHistory] = useState<DiagnosisAssociation[]>([]);
  const historyRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (date === today) return;
    let active = true;
    setCurrentError(false);
    void import('@/services/storage/firestore/firestoreRecordQueries')
      .then(service => service.getRecordFromFirestoreDetailed(today, { source: 'server' }))
      .then(result => {
        if (!active) return;
        setRemoteCurrentBeds(result.status === 'resolved' ? result.record?.beds ?? null : null);
        setCurrentError(result.status !== 'resolved');
      }).catch(() => { if (active) setCurrentError(true); });
    return () => { active = false; };
  }, [date, today]);

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
      const records = await service.getRecordsRangeFromFirestore(range.start, range.end,
        { requireServer: true });
      if (!mountedRef.current || request !== historyRequestRef.current) return;
      setHistory(summarizeHistoricalAssociations(records));
      setHistoryState('ready');
    } catch {
      if (mountedRef.current && request === historyRequestRef.current) setHistoryState('error');
    }
  };

  return { currentBeds: date === today ? beds : remoteCurrentBeds, currentError,
    historyMonth, historyState, history, changeHistoryMonth, loadHistory };
};
