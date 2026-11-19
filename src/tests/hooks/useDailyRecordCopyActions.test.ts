import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useDailyRecordCopyActions } from '@/hooks/useDailyRecordCopyActions';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const dayWith = (date: string, patientName: string): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: { R1: DataFactory.createMockPatient('R1', { patientName }) },
  });

it('keeps one copy action across edits and copies from the day shown at click time', async () => {
  const dailyRecord = {
    copyPatientToDateDetailed: vi.fn(async () => ({
      sourceDate: '2026-05-18',
      targetDate: '2026-05-19',
      sourceBedId: 'R1',
      targetBedId: 'R1',
      outcome: 'clean' as const,
      sourceCompatibilityIntensity: 'none' as const,
      sourceMigrationRulesApplied: [],
    })),
  };
  const refresh = vi.fn();
  const warning = vi.fn();
  const { result, rerender } = renderHook(
    ({ record }: { record: DailyRecord | null }) =>
      useDailyRecordCopyActions({ record, refresh, dailyRecord, warning }),
    { initialProps: { record: dayWith('2026-05-17', 'PACIENTE SINTETICO A') } }
  );
  const copyAction = result.current;

  rerender({ record: dayWith('2026-05-17', 'PACIENTE SINTETICO B') });
  expect(result.current).toBe(copyAction);

  rerender({ record: dayWith('2026-05-18', 'PACIENTE SINTETICO C') });
  await act(() => copyAction('R1', '2026-05-19'));
  expect(dailyRecord.copyPatientToDateDetailed).toHaveBeenCalledWith(
    '2026-05-18',
    'R1',
    '2026-05-19',
    'R1'
  );

  rerender({ record: dayWith('2026-05-18', '') });
  await act(() => copyAction('R1', '2026-05-19'));
  expect(dailyRecord.copyPatientToDateDetailed).toHaveBeenCalledTimes(1);
});
