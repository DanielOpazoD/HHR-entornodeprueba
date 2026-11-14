import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hospitalDB, ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import {
  getAuditLogs,
  getAuditLogsForDate,
  getAuditLogsInRange,
} from '@/services/storage/indexeddb/indexedDbAuditLogService';
import { createAuditCoreService } from '@/services/admin/auditCore';
import { defaultAuditPort } from '@/application/ports/auditPort';
import { saveAuditLog } from '@/services/storage/indexeddb/indexedDbAuditLogService';
import { executeFetchAuditLogs } from '@/application/audit/fetchAuditLogsUseCase';
import { AuditView } from '@/features/admin/components/AuditView';
import { useConflictVersionRecovery } from '@/hooks/clinical-conflicts/useConflictVersionRecovery';
import { defaultDailyRecordConflictRecoveryPort } from '@/application/ports/dailyRecordConflictRecoveryPort';
import type { AuditLogEntry } from '@/types/auditLogTypes';

vi.unmock('@/services/admin/auditService');
vi.unmock('../services/admin/auditService');

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => false }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: 'admin' }) }));
vi.mock('@/context/AuditContext', () => ({ useAuditContext: () => ({ logEvent: vi.fn() }) }));
vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn() }),
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/features/admin/components/internal/audit/ExportKeysPanel', () => ({
  ExportKeysPanel: () => null,
}));

const date = '2026-07-01';
const range = {
  fromIso: '2026-07-01T00:00:00.000Z',
  toIso: '2026-07-02T00:00:00.000Z',
  limit: 100,
};
const entry: AuditLogEntry = {
  id: 'synthetic-event',
  timestamp: new Date().toISOString(),
  userId: 'synthetic@hospital.test',
  action: 'PATIENT_DIAGNOSIS_CHANGED',
  entityType: 'patient',
  entityId: 'synthetic-episode',
  recordDate: date,
  details: { patientName: 'Paciente Sintético', changes: { diagnosis: { old: 'A', new: 'B' } } },
};
const failRead = () =>
  vi
    .spyOn(Object.getPrototypeOf(hospitalDB.auditLogs.toCollection()), 'toArray')
    .mockRejectedValue(new Error('synthetic IndexedDB read failure'));

beforeEach(async () => {
  await ensureDbReady();
  await hospitalDB.auditLogs.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('audit local read failures', () => {
  it.each([
    ['general', () => getAuditLogs()],
    ['date', () => getAuditLogsForDate(date)],
    ['range', () => getAuditLogsInRange(range)],
  ] as const)('%s rejects a failed read of a populated real Dexie table', async (_name, read) => {
    await hospitalDB.auditLogs.put(entry);
    failRead();
    await expect(read()).rejects.toThrow('synthetic IndexedDB read failure');
  });
  it('keeps truly empty periods empty', async () => {
    expect(await getAuditLogs()).toEqual([]);
    expect(await getAuditLogsForDate(date)).toEqual([]);
    expect(await getAuditLogsInRange(range)).toEqual([]);
  });
  it('reports a failed general query through the existing outcome', async () => {
    failRead();
    expect(await executeFetchAuditLogs()).toMatchObject({ status: 'failed' });
  });
  it('reports failure when remote and real local reads both fail', async () => {
    const service = createAuditCoreService(
      {
        getDocs: vi.fn().mockRejectedValue(new Error('synthetic remote failure')),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
      },
      { saveAuditLog, getAuditLogs, getAuditLogsForDate, getAuditLogsInRange },
      { shouldUseRemoteAuditSync: () => true }
    );
    failRead();
    expect(
      await executeFetchAuditLogs(
        {},
        { auditPort: { ...defaultAuditPort, fetchLogs: service.getAuditLogs } }
      )
    ).toMatchObject({ status: 'failed' });
    await expect(service.getAuditLogsForDate(date)).rejects.toThrow(
      'synthetic IndexedDB read failure'
    );
  });
  it('does not declare no activity or enable export when the initial read fails', async () => {
    failRead();
    render(<AuditView />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Sin actividad para este período y filtros.')).toBeNull();
    expect(screen.getByRole('button', { name: /Exportar/i })).toBeDisabled();
  });
  it('keeps displayed events after refresh failure and disables their export', async () => {
    await hospitalDB.auditLogs.put(entry);
    render(<AuditView />);
    await screen.findByText('Paciente Sintético');
    failRead();
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));
    await screen.findByRole('alert');
    expect(screen.getByText('Paciente Sintético')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/i })).toBeDisabled();
  });
  it('keeps snapshots and reports unavailable auxiliary audit evidence', async () => {
    failRead();
    const snapshot = {
      id: 'synthetic-snapshot',
      origin: 'remote_premerge' as const,
      record: {
        date,
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        activeExtraBeds: [],
        lastUpdated: entry.timestamp,
      },
    };
    const { result } = renderHook(() =>
      useConflictVersionRecovery({
        date,
        port: {
          ...defaultDailyRecordConflictRecoveryPort,
          listConflictVersionSnapshots: async () => [snapshot],
        },
      })
    );
    act(() => result.current.open());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshots).toEqual([snapshot]);
    expect(result.current.snapshotRecovery).toMatchObject({
      status: 'failed',
      unavailableReason: 'unknown',
    });
  });
});
