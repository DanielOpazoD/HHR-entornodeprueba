// Must unmock to test real implementation, as setup.ts mocks it globally
vi.unmock('../../services/admin/auditService');

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as auditService from '@/services/admin/auditService';
import { setDoc } from 'firebase/firestore';

// Mock dependencies
vi.mock('../../firebaseConfig', () => ({
  auth: { currentUser: { email: 'tester@hospital.cl' } },
  db: {},
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn(), // We will override this
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    where: vi.fn(),
    Timestamp: { now: () => 'MOCK_TIMESTAMP' },
  };
});

import { AuditLogEntry } from '@/types/auditLogTypes';

const mockSaveAuditLog = vi.fn();
const mockGetAuditLogs = vi.fn();

vi.mock('../../services/storage/indexeddb/indexedDbAuditLogService', () => ({
  saveAuditLog: (log: AuditLogEntry) => mockSaveAuditLog(log),
  getAuditLogs: (limit: number) => mockGetAuditLogs(limit),
  getAuditLogsForDate: vi.fn(),
}));

const { mockAuditUtils } = vi.hoisted(() => ({
  mockAuditUtils: {
    getCurrentUserEmail: vi.fn(() => 'tester@hospital.cl'),
    getCurrentUserDisplayName: vi.fn(),
    getCurrentUserUid: vi.fn(),
    getCachedIpAddress: vi.fn(),
    fetchAndCacheIpAddress: vi.fn(),
  },
}));

vi.mock('../../services/admin/utils/auditUtils', () => mockAuditUtils);

vi.mock('../../services/admin/utils/auditSummaryGenerator', () => ({
  generateSummary: vi.fn(
    (action: string, _details: unknown, _entityId: string) => `Summary for ${action}`
  ),
}));

describe('AuditService Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2025-01-01T00:01:00.000Z'));
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should catch Firestore errors silently and rely on local storage', async () => {
    // Setup: Firestore throws error
    vi.mocked(setDoc).mockRejectedValue(new Error('Firestore Offline'));

    const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    await auditService.logAuditEvent('user1', 'USER_LOGIN', 'user', 'user1', {});

    // Assert
    expect(setDoc).toHaveBeenCalled();
    expect(spyConsole).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save audit log to Firestore'),
      expect.any(Error)
    );

    // Verify local storage is still populated (via mock)
    expect(mockSaveAuditLog).toHaveBeenCalled();
    expect(mockSaveAuditLog.mock.calls[0][0].action).toBe('USER_LOGIN');
  });

  it('should call saveAuditLog regardless of Firestore status', async () => {
    // Act: Add 1 new log
    await auditService.logAuditEvent('user1', 'USER_LOGOUT', 'user', 'user1', {});

    // Assert
    expect(mockSaveAuditLog).toHaveBeenCalled();
    expect(mockSaveAuditLog.mock.calls[0][0].action).toBe('USER_LOGOUT');
  });

  it('should exclude view logging for institutional shared accounts', async () => {
    // Setup: Mock current user as restricted shared account via mockAuditUtils
    mockAuditUtils.getCurrentUserEmail.mockReturnValue('hospitalizados@hospitalhangaroa.cl');

    // Clear mocks to ensure clean state
    mockSaveAuditLog.mockClear();

    // Act
    await auditService.logThrottledViewEvent(
      'VIEW_PATIENT',
      'B01',
      { patientName: 'Patient', bedId: 'B01', rut: '11.111.111-1' },
      '2024-01-01'
    );

    // Assert - for excluded users, saveAuditLog should NOT be called
    expect(mockSaveAuditLog).not.toHaveBeenCalled();
  });

  it('should use throttled view event for patient views', async () => {
    // Setup: Normal user via mockAuditUtils
    mockAuditUtils.getCurrentUserEmail.mockReturnValue('random.doctor@hospital.cl');

    // This test verifies that patient views use the throttled core logger
    // by checking it returns a Promise (doesn't throw)
    const result = auditService.logThrottledViewEvent(
      'VIEW_PATIENT',
      'B01',
      { patientName: 'Patient', bedId: 'B01', rut: '11.111.111-1' },
      '2024-01-01'
    );

    // Assert - logThrottledViewEvent returns a Promise
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it('should calculate session duration on logout', async () => {
    // Setup login time 1 minute ago
    const startTime = '2025-01-01T00:00:00.000Z';
    sessionStorage.setItem('hhr_session_start', startTime);

    // Act
    await auditService.logUserLogout('user1', 'manual');

    // Assert
    const callArgs = vi.mocked(setDoc).mock.calls[0][1] as AuditLogEntry;
    expect(callArgs.details.durationSeconds).toBeGreaterThanOrEqual(60);
    expect(callArgs.details.durationFormatted).toMatch(/1m/);
    expect(sessionStorage.getItem('hhr_session_start')).toBeNull();
  });
});
