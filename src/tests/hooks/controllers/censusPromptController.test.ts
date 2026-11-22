// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  executeLoadCensusPromptDataController,
  INITIAL_CENSUS_PROMPT_STATE,
  resolvePreviousDayState,
} from '@/features/census/hooks/censusPromptController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('censusPromptController', () => {
  it('exposes stable initial prompt state', () => {
    expect(INITIAL_CENSUS_PROMPT_STATE).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
    });
  });

  it('resolves previous day state from nullable record', () => {
    expect(resolvePreviousDayState('2026-02-13', null)).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
    });

    expect(
      resolvePreviousDayState('2026-02-13', DataFactory.createMockDailyRecord('2026-02-12'))
    ).toEqual({
      previousRecordAvailable: true,
      previousRecordDate: '2026-02-12',
    });
  });

  it('ignores an older record as the previous day source', () => {
    expect(
      resolvePreviousDayState('2026-02-13', DataFactory.createMockDailyRecord('2026-02-10'))
    ).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
    });
  });

  it('loads prompt state from the previous day read', async () => {
    const getPreviousDay = vi
      .fn()
      .mockResolvedValue(DataFactory.createMockDailyRecord('2026-02-12'));
    const result = await executeLoadCensusPromptDataController({
      currentDateString: '2026-02-13',
      getPreviousDay,
    });

    expect(getPreviousDay).toHaveBeenCalledExactlyOnceWith('2026-02-13');
    expect(result).toEqual({
      previousRecordAvailable: true,
      previousRecordDate: '2026-02-12',
    });
  });

  it('keeps the copy unavailable when the previous day read fails', async () => {
    const result = await executeLoadCensusPromptDataController({
      currentDateString: '2026-02-13',
      getPreviousDay: vi.fn().mockRejectedValue(new Error('prev failed')),
    });
    expect(result).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
    });
  });
});
