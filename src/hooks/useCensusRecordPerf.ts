import { flushPerfReport, markPerf } from '@/shared/runtime/perfAudit';
import { useEffect, useRef, useState } from 'react';
import { recordCensusAvailability } from '@/shared/runtime/censusStartupPerf';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import {
  dailyActionNow,
  recordDailyActionTiming,
} from '@/services/observability/dailyActionTiming';

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

/**
 * Time from choosing another day to that day's census (or its confirmed absence) being committed
 * to the screen. The first day is the startup, measured on its own; a day left before it is shown
 * reports nothing, since that wait never ended.
 */
export function useCensusDayChangeTiming(
  date: string,
  recordDate: string | undefined,
  phase: DailyRecordBootstrapPhase
): void {
  // Taken during render so a day already in cache still counts the render that shows it.
  const [change, setChange] = useState<{ date: string; startedAt?: number }>({ date });
  if (change.date !== date) setChange({ date, startedAt: dailyActionNow() });
  const reported = useRef(change);

  useEffect(() => {
    if (change.date !== date || change.startedAt === undefined || reported.current === change) {
      return;
    }
    const shown = recordDate === date || phase === 'confirmed_empty';
    if (!shown && phase !== 'remote_record_timeout') return;
    reported.current = change;
    recordDailyActionTiming('census_day_change_ready', change.startedAt, shown);
  }, [change, date, recordDate, phase]);
}
