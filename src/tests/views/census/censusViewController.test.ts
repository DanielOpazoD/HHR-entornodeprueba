// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildEmptyDayPromptProps,
  buildRegisterContentProps,
  resolveCensusDayView,
  resolveCensusViewBranch,
} from '@/features/census/controllers/censusViewController';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';

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
      onCreateDay,
      readOnly: false,
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
      onCreateDay,
      readOnly: false,
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

  describe('the census day view', () => {
    const registerContentProps = buildRegisterContentProps({
      currentDateString: '2026-03-14',
      readOnly: false,
      beds: {},
      visibleBeds: [],
      marginStyle: {},
      stats: null,
      showBedManagerModal: false,
      onCloseBedManagerModal: vi.fn(),
    });
    const emptyDayPromptProps = buildEmptyDayPromptProps({
      selectedDay: 14,
      selectedMonth: 2,
      currentDateString: '2026-03-14',
      previousRecordAvailable: true,
      previousRecordDate: '2026-03-13',
      onCreateDay: vi.fn(),
      readOnly: false,
    });

    // What main painted before the closed state (af579367f), measured for every combination.
    // Columns: remote runtime ready or local_only | remote runtime still bootstrapping.
    const withoutRecord: Record<DailyRecordBootstrapPhase, [string, string]> = {
      local_only: ['loading', 'loading'],
      remote_runtime_bootstrapping: ['loading', 'loading'],
      // #1624: a cached miss keeps the day loading; it is not a failed check.
      remote_record_bootstrapping: ['loading', 'loading'],
      remote_record_timeout: ['readFailed', 'readFailed'],
      record_ready: ['loading', 'loading'],
      confirmed_empty: ['confirmedEmpty', 'loading'],
    };
    const remoteStatuses: RemoteSyncRuntimeStatus[] = ['ready', 'local_only', 'bootstrapping'];
    const rows = remoteStatuses.flatMap(remoteSyncStatus =>
      (Object.keys(withoutRecord) as DailyRecordBootstrapPhase[]).map(
        bootstrapPhase => [remoteSyncStatus, bootstrapPhase] as const
      )
    );

    it.each(rows)(
      'without a record, remote %s and phase %s',
      (remoteSyncStatus, bootstrapPhase) => {
        const view = resolveCensusDayView({
          registerContentProps: null,
          emptyDayPromptProps,
          remoteSyncStatus,
          bootstrapPhase,
        });
        expect(view.kind).toBe(
          withoutRecord[bootstrapPhase][remoteSyncStatus === 'bootstrapping' ? 1 : 0]
        );
        if (view.kind === 'confirmedEmpty')
          expect(view.emptyDayPromptProps).toBe(emptyDayPromptProps);
      }
    );

    it.each(rows)('with a record, remote %s and phase %s', (remoteSyncStatus, bootstrapPhase) => {
      expect(
        resolveCensusDayView({
          registerContentProps,
          emptyDayPromptProps: null,
          remoteSyncStatus,
          bootstrapPhase,
        })
      ).toEqual({ kind: 'register', registerContentProps });
    });
  });
});
