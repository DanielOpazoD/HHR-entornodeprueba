import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as firestore from 'firebase/firestore';
import type { AuditLogEntry } from '@/types/auditLogTypes';

// Force unmock because it's globally mocked in setup.ts
vi.unmock('../../services/admin/auditService');

// Mock Firebase Config BEFORE importing the service
vi.mock('../../firebaseConfig', () => ({
  db: { type: 'mock-db' },
  auth: {
    currentUser: { email: 'tester@hospital.cl' },
  },
}));

// Mock Firestore
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  class MockTimestamp {
    constructor(
      public seconds: number,
      public nanoseconds: number
    ) {}
    static now() {
      return new MockTimestamp(1735689600, 0);
    }
    toDate() {
      return {
        toISOString: () => '2025-01-01T00:00:00.000Z',
      } as unknown as Date;
    }
  }
  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    where: vi.fn(),
    Timestamp: MockTimestamp,
  };
});

const mockSaveAuditLog = vi.fn();
const mockGetAuditLogs = vi.fn();
const mockGetAuditLogsForDate = vi.fn();

vi.mock('../../services/storage/indexeddb/indexedDbAuditLogService', () => ({
  saveAuditLog: (log: AuditLogEntry) => mockSaveAuditLog(log),
  getAuditLogs: (limit: number) => mockGetAuditLogs(limit),
  getAuditLogsForDate: (date: string) => mockGetAuditLogsForDate(date),
  getAuditLogsInRange: vi.fn().mockResolvedValue([]),
}));

// Mock audit utils
vi.mock('../../services/admin/utils/auditUtils', async importOriginal => {
  const getCurrentUserEmail = vi.fn(() => 'tester@hospital.cl');
  return {
    ...(await importOriginal<typeof import('@/services/admin/utils/auditUtils')>()),
    getCurrentUserEmail,
    getCurrentUserDisplayName: vi.fn(() => 'Tester Account'),
    getCurrentUserUid: vi.fn(() => 'uid-123'),
    getCurrentAuditSession: vi.fn(() => ({
      uid: 'uid-123',
      email: getCurrentUserEmail(),
      displayName: 'Tester Account',
    })),
    getCachedIpAddress: vi.fn(() => '127.0.0.1'),
    fetchAndCacheIpAddress: vi.fn().mockResolvedValue('127.0.0.1'),
  };
});

// Now import the service
import {
  logThrottledViewEvent,
  getAuditLogs,
  getAuditLogsForDate,
} from '@/services/admin/auditService';
import { defaultAuditPort } from '@/application/ports/auditPort';
import * as auditUtils from '@/services/admin/utils/auditUtils';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

describe('AuditService', () => {
  const mockPatientRut = '12345678-9';
  const mockDate = '2025-01-01';

  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  describe('Logging Helpers', () => {
    it('should log patient admission with masked RUT', async () => {
      await defaultAuditPort.logPatientAdmission(
        'R1',
        'Patient A',
        mockPatientRut,
        'Diag',
        mockDate
      );
      const entry = vi.mocked(firestore.setDoc).mock.calls[0][1] as AuditLogEntry;
      expect(entry.patientIdentifier).toBe('12345***-*');
      expect(entry.details.rut).toBe(mockPatientRut);
      // With Firestore available the device keeps no second copy of patient data.
      expect(mockSaveAuditLog).not.toHaveBeenCalled();
    });

    it('should log patient discharge', async () => {
      await defaultAuditPort.logPatientDischarge(
        'R1',
        'Patient A',
        mockPatientRut,
        'ALTA_DOMICILIO',
        mockDate
      );
      expect((vi.mocked(firestore.setDoc).mock.calls[0][1] as AuditLogEntry).action).toBe(
        'PATIENT_DISCHARGED'
      );
    });

    it('should log patient transfer', async () => {
      await defaultAuditPort.logPatientTransfer(
        'R1',
        'Patient A',
        mockPatientRut,
        'OTRO_HOSPITAL',
        mockDate
      );
      expect((vi.mocked(firestore.setDoc).mock.calls[0][1] as AuditLogEntry).action).toBe(
        'PATIENT_TRANSFERRED'
      );
    });
  });

  describe('Throttling & Filtering', () => {
    it('should throttle frequent VIEW events', async () => {
      // First call should log
      await logThrottledViewEvent('VIEW_PATIENT', 'R1', { name: 'X' }, mockDate);
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);

      // Second call immediately after should NOT log
      await logThrottledViewEvent('VIEW_PATIENT', 'R1', { name: 'X' }, mockDate);
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    it('should NOT log view events for institutional shared accounts', async () => {
      vi.mocked(auditUtils.getCurrentUserEmail).mockReturnValue(
        'hospitalizados@hospitalhangaroa.cl'
      );
      await logThrottledViewEvent('VIEW_PATIENT', 'R1', { name: 'X' }, mockDate);
      expect(firestore.setDoc).not.toHaveBeenCalled();
    });
  });

  describe('Retrieval', () => {
    it('should fetch recent logs from Firestore and preserve Timestamp payloads', async () => {
      const Timestamp = (await import('firebase/firestore')).Timestamp;
      vi.mocked(firestore.getDocs).mockResolvedValue({
        docs: [
          {
            id: 'log1',
            data: () => ({
              action: 'LOGIN',
              timestamp: Timestamp.now(),
            }),
          },
        ],
      } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

      const logs = await getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('LOGIN');
    });

    it('should fetch logs for specific date and fallback to IDB on error', async () => {
      const consoleSpies = suppressConsole(['error']);
      vi.mocked(firestore.getDocs).mockRejectedValue(new Error('Firestore down'));
      mockGetAuditLogsForDate.mockResolvedValue([{ id: 'idb-1' }]);

      try {
        const logs = await getAuditLogsForDate(mockDate);
        expect(logs[0].id).toBe('idb-1');
        expect(mockGetAuditLogsForDate).toHaveBeenCalledWith(mockDate);
      } finally {
        restoreConsole(consoleSpies);
      }
    });
  });
});
