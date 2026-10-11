// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  executeLoadCensusPromptDataController,
  filterAvailableDates,
  INITIAL_CENSUS_PROMPT_STATE,
  resolvePreviousDayState,
} from '@/hooks/controllers/censusPromptController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('censusPromptController', () => {
  it('exposes stable initial prompt state', () => {
    expect(INITIAL_CENSUS_PROMPT_STATE).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
      availableDates: [],
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

  it('ignores an older available record as default previous day source', () => {
    expect(
      resolvePreviousDayState('2026-02-13', DataFactory.createMockDailyRecord('2026-02-10'), [
        '2026-02-10',
      ])
    ).toEqual({
      previousRecordAvailable: false,
      previousRecordDate: undefined,
    });
  });

  it('filters current date and deduplicates available dates', () => {
    expect(
      filterAvailableDates('2026-02-13', ['2026-02-12', '2026-02-13', '2026-02-12', '2026-02-11'])
    ).toEqual(['2026-02-12', '2026-02-11']);
  });

  it('loads prompt state when both repository calls succeed', async () => {
    const result = await executeLoadCensusPromptDataController({
      currentDateString: '2026-02-13',
      getPreviousDay: vi.fn().mockResolvedValue(DataFactory.createMockDailyRecord('2026-02-12')),
      getAvailableDates: vi.fn().mockResolvedValue(['2026-02-12', '2026-02-13', '2026-02-10']),
    });

    expect(result).toEqual({
      previousRecordAvailable: true,
      previousRecordDate: '2026-02-12',
      availableDates: ['2026-02-12', '2026-02-10'],
    });
  });

  it('degrades gracefully when one or both async calls fail', async () => {
    const previousFails = await executeLoadCensusPromptDataController({
      currentDateString: '2026-02-13',
      getPreviousDay: vi.fn().mockRejectedValue(new Error('prev failed')),
      getAvailableDates: vi.fn().mockResolvedValue(['2026-02-12']),
    });
    expect(previousFails).toEqual({
      previousRecordAvailable: true,
      previousRecordDate: '2026-02-12',
      availableDates: ['2026-02-12'],
    });

    const datesFail = await executeLoadCensusPromptDataController({
      currentDateString: '2026-02-13',
      getPreviousDay: vi.fn().mockResolvedValue(DataFactory.createMockDailyRecord('2026-02-12')),
      getAvailableDates: vi.fn().mockRejectedValue(new Error('dates failed')),
    });
    expect(datesFail).toEqual({
      previousRecordAvailable: true,
      previousRecordDate: '2026-02-12',
      availableDates: [],
    });
  });
});
