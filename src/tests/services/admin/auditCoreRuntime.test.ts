import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditCoreService } from '@/services/admin/auditCore';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/services/admin/adminLoggers', () => ({
  auditCoreLogger: loggerMocks,
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: vi.fn(() => 'doctor@hospital.cl'),
  getCurrentUserDisplayName: vi.fn(() => 'Doctor Account'),
  getCurrentUserUid: vi.fn(() => 'doctor-123'),
  getCachedIpAddress: vi.fn(() => '127.0.0.1'),
  fetchAndCacheIpAddress: vi.fn().mockResolvedValue('127.0.0.1'),
}));

vi.mock('@/services/admin/utils/auditSummaryGenerator', () => ({
  generateSummary: vi.fn((action: string) => `Summary for ${action}`),
}));

describe('auditCore runtime injection', () => {
  const setDoc = vi.fn();
  const getDocs = vi.fn();
  const saveAuditLog = vi.fn();
  const getIndexedLogs = vi.fn();
  const getIndexedLogsForDate = vi.fn();

  const service = createAuditCoreService(
    {
      setDoc,
      getDocs,
    },
    {
      saveAuditLog,
      getAuditLogs: getIndexedLogs,
      getAuditLogsForDate: getIndexedLogsForDate,
    }
  );

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    saveAuditLog.mockResolvedValue(undefined);
    setDoc.mockResolvedValue(undefined);
  });

  it('writes audit entries through the injected persistence dependencies', async () => {
    await service.logAuditEvent('doctor@hospital.cl', 'USER_LOGIN', 'user', 'doctor@hospital.cl', {
      event: 'login',
    });

    expect(saveAuditLog).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledWith(
      expect.stringContaining('/auditLogs'),
      expect.stringContaining('audit_'),
      expect.objectContaining({
        action: 'USER_LOGIN',
        userId: 'doctor@hospital.cl',
        summary: 'Summary for USER_LOGIN',
      })
    );
  });

  it('does not throttle direct VIEW writes inside the persistence core', async () => {
    await service.logAuditEvent('doctor@hospital.cl', 'VIEW_CUDYR', 'dailyRecord', '2026-05-01', {
      view: 'cudyr',
    });
    await service.logAuditEvent('doctor@hospital.cl', 'VIEW_CUDYR', 'dailyRecord', '2026-05-01', {
      view: 'cudyr',
    });

    expect(saveAuditLog).toHaveBeenCalledTimes(2);
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  it('downgrades remote permission-denied audit writes to a local-only warning', async () => {
    setDoc.mockRejectedValue({ code: 'permission-denied' });

    await service.logAuditEvent('doctor@hospital.cl', 'USER_LOGIN', 'user', 'doctor@hospital.cl', {
      event: 'login',
    });

    expect(saveAuditLog).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Audit log persisted locally only because Firestore rejected the remote append',
      expect.objectContaining({
        action: 'USER_LOGIN',
        code: 'permission-denied',
      })
    );
    expect(loggerMocks.error).not.toHaveBeenCalledWith(
      'Failed to save audit log to Firestore',
      expect.anything()
    );
  });

  it('keeps audit writes local-only when remote audit sync is disabled', async () => {
    const localOnlyService = createAuditCoreService(
      {
        setDoc,
        getDocs,
      },
      {
        saveAuditLog,
        getAuditLogs: getIndexedLogs,
        getAuditLogsForDate: getIndexedLogsForDate,
      },
      {
        shouldUseRemoteAuditSync: () => false,
      }
    );

    await localOnlyService.logAuditEvent(
      'doctor@hospital.cl',
      'USER_LOGIN',
      'user',
      'doctor@hospital.cl',
      {
        event: 'login',
      }
    );

    expect(saveAuditLog).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      'Audit log persisted locally only because Firestore rejected the remote append',
      expect.anything()
    );
  });

  it('falls back to injected local storage when firestore reads fail', async () => {
    const fallbackLogs = [{ id: 'local-1' } as AuditLogEntry];
    getDocs.mockRejectedValue(new Error('firestore down'));
    getIndexedLogs.mockResolvedValue(fallbackLogs);

    await expect(service.getAuditLogs(25)).resolves.toEqual(fallbackLogs);
    expect(getIndexedLogs).toHaveBeenCalledWith(25);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Failed to fetch audit logs from Firestore',
      expect.any(Error)
    );
  });

  it('does not apply a read limit when full historical audit logs are requested', async () => {
    getDocs.mockResolvedValue([]);

    await service.getAuditLogs();

    expect(getDocs).toHaveBeenCalledWith(
      expect.stringContaining('/auditLogs'),
      expect.not.objectContaining({ limit: expect.any(Number) })
    );
  });
});
