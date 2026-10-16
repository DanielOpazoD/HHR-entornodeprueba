import React, { memo } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { useCensusViewScreenModel } from '@/features/census/hooks/useCensusViewScreenModel';
import { DataFactory } from '@/tests/factories/DataFactory';
vi.mock('@/context', () => ({
  useAuth: () => ({ isAuthenticated: true, remoteSyncStatus: 'ready' }),
}));
vi.mock('@/features/census/hooks/useCensusViewRouteModel', () => ({
  useCensusViewRouteModel: () => ({
    branch: 'register',
    emptyDayPromptProps: null,
    registerContentProps: {},
  }),
}));
vi.mock('@/features/census/hooks/useCensusMigrationBootstrap', () => ({
  useCensusMigrationBootstrap: () => undefined,
}));
vi.mock('@/services/config/postDeployRecentRecordRefresh', () => ({
  readPostDeployRecentRecordRefreshMarker: () => null,
}));
const close = () => undefined;
const record = DataFactory.createMockDailyRecord('2026-10-15');
describe('census screen subscription boundary', () => {
  it('ignores record revisions but observes bootstrap changes with fresh parent JSX', () => {
    const renderCount = vi.fn();
    const Probe = memo(function Probe() {
      useCensusViewScreenModel({
        selectedDay: 15,
        selectedMonth: 9,
        currentDateString: record.date,
        showBedManagerModal: false,
        onCloseBedManagerModal: close,
        readOnly: false,
        allowAdminCopyOverride: false,
        accessProfile: 'default',
      });
      renderCount();
      return null;
    });
    const tree = (context: DailyRecordContextType) => (
      <DailyRecordProvider value={context}>
        <Probe />
      </DailyRecordProvider>
    );
    const base = {
      record,
      syncStatus: 'saved',
      bootstrapPhase: 'record_ready',
      lastSyncTime: null,
    } as DailyRecordContextType;
    const view = render(tree(base));
    for (let i = 1; i <= 20; i++)
      view.rerender(tree({ ...base, record: { ...record, lastUpdated: `revision-${i}` } }));
    expect(renderCount).toHaveBeenCalledTimes(1);
    view.rerender(tree({ ...base, bootstrapPhase: 'local_only' }));
    expect(renderCount).toHaveBeenCalledTimes(2);
  });
});
