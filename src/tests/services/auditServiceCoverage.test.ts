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
  getAuditLogsInRange: vi.fn(),
}));

const { mockAuditUtils } = vi.hoisted(() => {
  const getCurrentUserEmail = vi.fn(() => 'tester@hospital.cl');
  return {
    mockAuditUtils: {
      getCurrentUserEmail,
      getCurrentUserDisplayName: vi.fn(),
      getCurrentUserUid: vi.fn(),
      getCurrentAuditSession: vi.fn(() => ({ uid: 'uid-tester', email: getCurrentUserEmail() })),
      getCachedIpAddress: vi.fn(),
      fetchAndCacheIpAddress: vi.fn(),
    },
  };
});

vi.mock('../../services/admin/utils/auditUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/admin/utils/auditUtils')>()),
  ...mockAuditUtils,
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

  it('reports Firestore failures without keeping a second copy on the device', async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error('Firestore Offline'));
    const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

    await auditService.logAuditEvent('tester@hospital.cl', 'PATIENT_MODIFIED', 'patient', 'R1', {
      patientName: 'Paciente',
    });

    expect(setDoc).toHaveBeenCalled();
    expect(spyConsole).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save audit log to Firestore'),
      expect.any(Error)
    );
    // Firestore's offline cache already queues the write; patient data is not duplicated locally.
    expect(mockSaveAuditLog).not.toHaveBeenCalled();
  });

  it('writes compact v2 events with the patient document', async () => {
    vi.mocked(setDoc).mockResolvedValue(undefined);

    await auditService.logAuditEvent(
      'tester@hospital.cl',
      'PATIENT_MODIFIED',
      'patient',
      'R1',
      { patientName: 'Paciente', note: 'x'.repeat(5_000), error: { stack: 'raw stack' } },
      '11.111.111-1'
    );

    const entry = vi.mocked(setDoc).mock.calls[0][1] as AuditLogEntry;
    expect(entry).toMatchObject({ schemaVersion: 2, patientIdentifier: '11.111.***-*' });
    expect(entry).not.toHaveProperty('summary');
    expect(entry.details.rut).toBe('11.111.111-1');
    expect(String(entry.details.note)).toHaveLength(1_000);
    expect(entry.details.error).toEqual({});
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

  it('records one read per patient inside the throttle window', async () => {
    vi.mocked(setDoc).mockResolvedValue(undefined);
    mockAuditUtils.getCurrentUserEmail.mockReturnValue('random.doctor@hospital.cl');
    const view = (bedId: string, rut: string) =>
      auditService.logThrottledViewEvent(
        'VIEW_PATIENT',
        bedId,
        { patientName: 'Patient', bedId, rut },
        '2024-01-01'
      );

    await view('B01', '11.111.111-1');
    await view('B01', '11.111.111-1');
    await view('B02', '22.222.222-2');

    expect(vi.mocked(setDoc)).toHaveBeenCalledTimes(2);
  });
});
