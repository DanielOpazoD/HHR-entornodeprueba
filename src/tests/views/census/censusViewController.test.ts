import { describe, expect, it, vi } from 'vitest';
import {
  buildEmptyDayPromptProps,
  buildRegisterContentProps,
  resolveCensusViewBranch,
} from '@/features/census/controllers/censusViewController';

describe('censusViewController', () => {
  it('returns empty branch when record has no beds', () => {
    expect(resolveCensusViewBranch({ beds: null })).toBe('empty');
  });

  it('returns register branch when record exists', () => {
    expect(resolveCensusViewBranch({ beds: {} })).toBe('register');
  });

  it('builds empty day prompt props without reshaping values', () => {
    const onCreateDay = vi.fn();
    const result = buildEmptyDayPromptProps({
      selectedDay: 14,
      selectedMonth: 2,
      currentDateString: '2026-03-14',
      previousRecordAvailable: true,
      previousRecordDate: '2026-03-13',
      availableDates: ['2026-03-13'],
      onCreateDay,
      readOnly: false,
      allowAdminCopyOverride: true,
      emptyStateDiagnostic: {
        source: 'remote_missing',
        message: 'Firebase y la copia local no tienen registro para esta fecha.',
      },
    });

    expect(result).toEqual({
      selectedDay: 14,
      selectedMonth: 2,
      currentDateString: '2026-03-14',
      previousRecordAvailable: true,
      previousRecordDate: '2026-03-13',
      availableDates: ['2026-03-13'],
      onCreateDay,
      readOnly: false,
      allowAdminCopyOverride: true,
      emptyStateDiagnostic: {
        source: 'remote_missing',
        message: 'Firebase y la copia local no tienen registro para esta fecha.',
      },
    });
  });

  it('builds register content props without dropping fields', () => {
    const onCloseBedManagerModal = vi.fn();
    const result = buildRegisterContentProps({
      currentDateString: '2026-03-14',
      readOnly: true,
      beds: {},
      visibleBeds: [],
      marginStyle: { padding: '0 12px' },
      stats: null,
      showBedManagerModal: true,
      onCloseBedManagerModal,
    });

    expect(result).toEqual({
      currentDateString: '2026-03-14',
      readOnly: true,
      beds: {},
      visibleBeds: [],
      marginStyle: { padding: '0 12px' },
      stats: null,
      showBedManagerModal: true,
      onCloseBedManagerModal,
    });
  });
});
