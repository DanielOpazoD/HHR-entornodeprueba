import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePersistence } from '@/hooks/usePersistence';

const mocks = vi.hoisted(() => ({
  repository: {
    syncWithFirestoreDetailed: vi.fn(),
    getForDateWithMeta: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
  },
  defaultRead: vi.fn(),
  defaultSync: vi.fn(),
  defaultDelete: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('@/services/RepositoryContext', () => ({
  useRepositories: () => ({ dailyRecord: mocks.repository }),
}));
vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: { getForDateWithMeta: mocks.defaultRead },
  defaultDailyRecordSyncPort: { syncWithFirestoreDetailed: mocks.defaultSync },
  defaultDailyRecordWritePort: { delete: mocks.defaultDelete },
}));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.notify, warning: mocks.notify, error: mocks.notify }),
}));
vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logDailyRecordCreated: vi.fn() }),
}));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'reviewer@example.test',
}));
vi.mock('@/application/audit/writeAuditEventUseCaseLoader', () => ({
  loadExecuteWriteAuditEvent: async () => mocks.audit,
}));
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.getForDateWithMeta.mockResolvedValue({
    record: { date: '2026-07-16', beds: {} },
    compatibilityIntensity: 'none',
    migrationRulesApplied: [],
  });
  mocks.repository.initializeDay.mockResolvedValue({ date: '2026-07-17', beds: {} });
  mocks.audit.mockResolvedValue({ status: 'success', data: null, issues: [] });
});
const setup = () =>
  renderHook(() =>
    usePersistence({
      currentDateString: '2026-07-17',
      markLocalChange: vi.fn(),
      setRecord: vi.fn(),
    })
  );

it.each([undefined, '2026-07-15'])(
  'uses only the injected repository when copying %s',
  async source => {
    const { result } = setup();
    let created = false;
    await act(async () => {
      created = await result.current.createDay(true, source, { forceCopyScheduleOverride: true });
    });
    const expectedSource = source ?? '2026-07-16';
    expect(created).toBe(true);
    expect(mocks.repository.syncWithFirestoreDetailed).toHaveBeenCalledWith(expectedSource);
    expect(mocks.repository.getForDateWithMeta).toHaveBeenCalledWith(expectedSource, true);
    expect(mocks.repository.initializeDay).toHaveBeenCalledWith('2026-07-17', expectedSource);
    expect(mocks.defaultRead).not.toHaveBeenCalled();
    expect(mocks.defaultSync).not.toHaveBeenCalled();
  }
);
it('deletes through the injected repository only after successful audit', async () => {
  const { result } = setup();
  await act(async () => {
    await result.current.resetDay();
  });
  expect(mocks.repository.deleteDay).toHaveBeenCalledWith('2026-07-17');
  expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.repository.deleteDay.mock.invocationCallOrder[0]
  );
  expect(mocks.defaultDelete).not.toHaveBeenCalled();
});
it('keeps the audit failure closed for the injected repository', async () => {
  mocks.audit.mockResolvedValue({ status: 'failed', issues: [] });
  const { result } = setup();
  await act(async () => {
    await result.current.resetDay();
  });
  expect(mocks.repository.deleteDay).not.toHaveBeenCalled();
  expect(mocks.defaultDelete).not.toHaveBeenCalled();
});
