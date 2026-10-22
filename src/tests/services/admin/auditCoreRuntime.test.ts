import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditCoreService } from '@/services/admin/auditCore';
import {
  enqueueAuditConnectionEntry,
  markAuditConnectionEntrySent,
  readAuditConnectionOutbox,
  type AuditConnectionOutboxStorage,
} from '@/services/admin/auditSession/auditConnectionOutbox';
import { AUDIT_CONNECTION_STORAGE_KEY } from '@/services/admin/auditSession/auditConnectionTracker';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

const auditUtilsMocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(() => 'doctor@hospital.cl'),
  getCurrentUserDisplayName: vi.fn(() => 'Doctor Account'),
  getCurrentUserUid: vi.fn<() => string | undefined>(() => 'doctor-123'),
  getCachedIpAddress: vi.fn(() => '127.0.0.1'),
  fetchAndCacheIpAddress: vi.fn().mockResolvedValue('127.0.0.1'),
}));

vi.mock('@/services/admin/adminLoggers', () => ({
  auditCoreLogger: loggerMocks,
}));

vi.mock('@/services/admin/utils/auditUtils', () => auditUtilsMocks);

const memoryStorage = (): AuditConnectionOutboxStorage => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
};

const CHROME_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('auditCore runtime injection', () => {
  const setDoc = vi.fn();
  const getDocs = vi.fn();
  const getDoc = vi.fn();
  const saveAuditLog = vi.fn();
  const getIndexedLogs = vi.fn();
  const getIndexedLogsForDate = vi.fn();
  const getIndexedLogsInRange = vi.fn();
  let storage: AuditConnectionOutboxStorage;

  const localStore = () => ({
    saveAuditLog,
    getAuditLogs: getIndexedLogs,
    getAuditLogsForDate: getIndexedLogsForDate,
    getAuditLogsInRange: getIndexedLogsInRange,
  });
  const device = () => ({
    connectionStorage: () => storage,
    userAgent: () => CHROME_ON_WINDOWS,
  });
  const remoteService = () =>
    createAuditCoreService(
      { setDoc, getDocs, getDoc },
      localStore(),
      { shouldUseRemoteAuditSync: () => true },
      device()
    );

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    storage = memoryStorage();
    auditUtilsMocks.getCurrentUserUid.mockReturnValue('doctor-123');
    saveAuditLog.mockResolvedValue(undefined);
    setDoc.mockResolvedValue(undefined);
  });

  it('writes compact v2 events stamped with the open connection and the device', async () => {
    storage.setItem(
      AUDIT_CONNECTION_STORAGE_KEY,
      JSON.stringify({
        id: 'conn-1',
        uid: 'doctor-123',
        email: 'doctor@hospital.cl',
        startedAt: 1,
        lastSeenAt: 2,
      })
    );

    await remoteService().logAuditEvent(
      'doctor@hospital.cl',
      'PATIENT_MODIFIED',
      'patient',
      'R1',
      { patientName: 'Paciente', changes: { age: { old: 40, new: 41 } } },
      '11.111.111-1',
      '2026-10-22'
    );

    expect(saveAuditLog).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledWith(
      expect.stringContaining('/auditLogs'),
      expect.stringContaining('audit_'),
      expect.objectContaining({
        schemaVersion: 2,
        action: 'PATIENT_MODIFIED',
        userId: 'doctor@hospital.cl',
        userUid: 'doctor-123',
        sessionId: 'conn-1',
        device: 'Chrome · Windows',
        recordDate: '2026-10-22',
        details: expect.objectContaining({ rut: '11.111.111-1' }),
      })
    );
  });

  it('downgrades remote permission-denied writes to a warning', async () => {
    setDoc.mockRejectedValue({ code: 'permission-denied' });

    await remoteService().logAuditEvent('doctor@hospital.cl', 'VIEW_CUDYR', 'dailyRecord', 'd', {
      view: 'cudyr',
    });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Firestore rejected the audit append',
      expect.objectContaining({ action: 'VIEW_CUDYR', code: 'permission-denied' })
    );
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('keeps audit writes local-only when remote audit sync is disabled', async () => {
    const localOnlyService = createAuditCoreService(
      { setDoc, getDocs, getDoc },
      localStore(),
      { shouldUseRemoteAuditSync: () => false },
      device()
    );

    await localOnlyService.logAuditEvent('doctor@hospital.cl', 'VIEW_CUDYR', 'dailyRecord', 'd', {
      view: 'cudyr',
    });

    expect(saveAuditLog).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('queries one period by timestamp range and reports remote failures', async () => {
    getDocs.mockResolvedValueOnce([]);
    const range = {
      fromIso: '2026-10-22T05:00:00.000Z',
      toIso: '2026-10-23T05:00:00.000Z',
      limit: 3000,
    };

    await remoteService().getAuditLogsInRange(range);
    expect(getDocs).toHaveBeenCalledWith(expect.stringContaining('/auditLogs'), {
      where: [
        { field: 'timestamp', operator: '>=', value: range.fromIso },
        { field: 'timestamp', operator: '<', value: range.toIso },
      ],
      orderBy: [{ field: 'timestamp', direction: 'desc' }],
      limit: 3000,
    });

    getDocs.mockRejectedValueOnce(new Error('firestore down'));
    await expect(remoteService().getAuditLogsInRange(range)).rejects.toThrow('firestore down');
    expect(getIndexedLogsInRange).not.toHaveBeenCalled();
  });

  const queued = (sessionId: string, kind: 'start' | 'end') => {
    const record = {
      id: sessionId,
      uid: 'doctor-123',
      email: 'doctor@hospital.cl',
      name: 'Doctor Account',
      startedAt: Date.parse('2026-10-22T13:00:00.000Z'),
      lastSeenAt: Date.parse('2026-10-22T14:00:00.000Z'),
    };
    return buildAuditConnectionEntry(
      kind === 'start'
        ? { kind, record, start: 'sign_in' }
        : { kind, record, reason: 'manual', endedAt: record.lastSeenAt }
    );
  };

  it('delivers queued connection events once, even when flushes overlap', async () => {
    enqueueAuditConnectionEntry(storage, queued('a', 'end'));
    enqueueAuditConnectionEntry(storage, queued('b', 'start'));

    const service = remoteService();
    await Promise.all([service.flushAuditConnectionOutbox(), service.flushAuditConnectionOutbox()]);

    // Oldest first: the 13:00 start before the 14:00 end.
    expect(setDoc.mock.calls.map(call => call[1])).toEqual(['conn_b_start', 'conn_a_end']);
    expect(readAuditConnectionOutbox(storage)).toEqual([]);
  });

  it('keeps a refused event for the next sign-in unless an earlier write may have landed', async () => {
    setDoc.mockRejectedValue({ code: 'permission-denied' });
    enqueueAuditConnectionEntry(storage, queued('revoked', 'end'));

    // Access revoked while still signed in: the end is refused, not delivered.
    await remoteService().flushAuditConnectionOutbox();
    expect(readAuditConnectionOutbox(storage)).toEqual([
      { entry: expect.objectContaining({ id: 'conn_revoked_end' }), rejections: 1 },
    ]);

    // A page that closed mid-write leaves `sentAt`: the refusal now means "already stored".
    markAuditConnectionEntrySent(storage, 'conn_revoked_end', 1);
    await remoteService().flushAuditConnectionOutbox();
    expect(readAuditConnectionOutbox(storage)).toEqual([]);
  });

  it('falls back to injected local storage when firestore reads fail', async () => {
    const fallbackLogs = [{ id: 'local-1' } as AuditLogEntry];
    getDocs.mockRejectedValue(new Error('firestore down'));
    getIndexedLogs.mockResolvedValue(fallbackLogs);

    await expect(remoteService().getAuditLogs(25)).resolves.toEqual(fallbackLogs);
    expect(getIndexedLogs).toHaveBeenCalledWith(25);
  });

  it('fetches date-scoped audit logs without a composite index and sorts them client-side', async () => {
    const older = { id: 'older', timestamp: '2026-07-03T10:00:00.000Z' } as AuditLogEntry;
    const newer = { id: 'newer', timestamp: '2026-07-03T12:00:00.000Z' } as AuditLogEntry;
    getDocs.mockResolvedValue([older, newer]);

    await expect(remoteService().getAuditLogsForDate('2026-07-03')).resolves.toEqual([
      newer,
      older,
    ]);
    expect(getDocs).toHaveBeenCalledWith(
      expect.stringContaining('/auditLogs'),
      expect.objectContaining({
        where: [{ field: 'recordDate', operator: '==', value: '2026-07-03' }],
      })
    );
  });
});
