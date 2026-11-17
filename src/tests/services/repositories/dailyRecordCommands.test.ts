// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createPartialUpdateDailyRecordCommand,
  createSaveDailyRecordCommand,
} from '@/services/repositories/contracts/dailyRecordCommands';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-02-19T00:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordCommands contracts', () => {
  it('creates save command for valid record', () => {
    const command = createSaveDailyRecordCommand(
      makeRecord('2026-02-19'),
      '2026-02-19T00:00:00.000Z'
    );
    expect(command.date).toBe('2026-02-19');
    expect(command.record.date).toBe('2026-02-19');
    expect(command.contexts).toEqual(['clinical', 'staffing', 'movements', 'handoff', 'metadata']);
  });

  it('rejects save command with invalid date', () => {
    expect(() => createSaveDailyRecordCommand(makeRecord('19-02-2026'))).toThrow(
      /Invalid date format/
    );
  });

  it('creates partial update command for valid input', () => {
    const command = createPartialUpdateDailyRecordCommand('2026-02-19', {
      'beds.R1.pathology': 'DX',
    });
    expect(command.date).toBe('2026-02-19');
    expect(command.patch['beds.R1.pathology']).toBe('DX');
    expect(command.contexts).toEqual(['clinical']);
  });

  it('rejects partial update command when patch is empty', () => {
    expect(() => createPartialUpdateDailyRecordCommand('2026-02-19', {})).toThrow(
      /requires at least one patch field/
    );
  });
});
