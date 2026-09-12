import { flushPerfReport, markPerf } from '@/shared/runtime/perfAudit';
import { useEffect } from 'react';
import { recordCensusAvailability } from '@/shared/runtime/censusStartupPerf';

/** Observe availability without coupling diagnostics to the clinical sync coordinator. */
export function useCensusRecordPerf(date: string, recordDate?: string, source?: string): void {
  useEffect(() => {
    recordCensusAvailability(date, recordDate === date, source === 'local');
  }, [date, recordDate, source]);
}

/** Legacy diagnostic remains distinct from the verified visible-table contract. */
export function useCensusBootstrapPerf(date: string, phase: string): void {
  useEffect(() => {
    if (phase !== 'record_ready' && phase !== 'confirmed_empty') return;
    markPerf('daily-record:ready');
    void flushPerfReport(`daily-record:${phase}`);
  }, [date, phase]);
}
