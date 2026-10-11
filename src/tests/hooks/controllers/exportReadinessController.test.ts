import { describe, expect, it, vi } from 'vitest';
import {
  prepareRecordExport,
  waitForExportReadiness,
} from '@/hooks/controllers/exportReadinessController';
import type { SyncStatus } from '@/context/dailyRecordContextContracts';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';

const date = '2026-10-01';
const record = { date } as DailyRecord;
const setup = (initialStatus: SyncStatus) => {
  let time = 0;
  const state = { selectedDate: date, recordDate: date, syncStatus: initialStatus };
  const run = (onWait = (_time: number) => {}) =>
    waitForExportReadiness({
      expectedDate: date,
      readState: () => state,
      now: () => time,
      wait: async ms => {
        time += ms;
        onWait(time);
      },
    });
  return { state, run };
};

describe('export readiness', () => {
  it('blocks a save that never settles instead of exporting at the deadline', async () => {
    expect(await setup('saving').run()).toEqual({ status: 'blocked', reason: 'saving' });
  });

  it('allows an idle local snapshot without requiring remote persistence', async () => {
    expect((await setup('idle').run()).status).toBe('ready');
  });

  it('waits for the blur-triggered save and checks readiness again before printing', async () => {
    const { state, run } = setup('idle');
    const result = await run(time => {
      if (time === 50) state.syncStatus = 'saving';
      if (time === 300) state.syncStatus = 'saved';
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a settled save');
    expect(result.check()).toBeNull();
    state.syncStatus = 'saving';
    expect(result.check()).toBe('saving');
  });

  it.each(['error', 'date', 'record'] as const)(
    'blocks a %s change while waiting',
    async change => {
      const { state, run } = setup('saving');
      const result = await run(() => {
        if (change === 'error') state.syncStatus = 'error';
        if (change === 'date') state.selectedDate = '2026-10-02';
        if (change === 'record') state.recordDate = '2026-09-30';
      });
      expect(result).toEqual({
        status: 'blocked',
        reason: change === 'error' ? 'save_failed' : 'date_changed',
      });
    }
  );

  it('does not read or export a snapshot when flushing fails', async () => {
    const readRecord = vi.fn(() => record);
    const warning = vi.fn();
    const result = await prepareRecordExport({
      expectedDate: date,
      readRecord,
      warning,
      flushBeforeExport: async () => {
        throw new Error('local save failed');
      },
    });
    expect(result).toBeNull();
    expect(readRecord).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      'No se inició la exportación',
      expect.stringContaining('guardado falló')
    );
  });

  it('rechecks a save that starts between flushing and consuming the snapshot', async () => {
    const warning = vi.fn();
    const result = await prepareRecordExport({
      expectedDate: date,
      readRecord: () => record,
      warning,
      flushBeforeExport: async () => ({ status: 'ready', check: () => 'saving' }),
    });
    expect(result).toBeNull();
    expect(warning).toHaveBeenCalledWith(
      'No se inició la exportación',
      expect.stringContaining('sigue guardándose')
    );
  });
  it('requires a snapshot for daily exports while allowing an explicit monthly date range', async () => {
    const warning = vi.fn();
    const args = { expectedDate: date, readRecord: () => null, warning };
    expect(await prepareRecordExport(args)).toBeNull();
    expect(warning).toHaveBeenCalledWith(
      'No se inició la exportación',
      expect.stringContaining('No hay un censo')
    );
    expect(await prepareRecordExport({ ...args, allowEmptyRecord: true })).toEqual(
      expect.objectContaining({ record: null })
    );
  });
});
