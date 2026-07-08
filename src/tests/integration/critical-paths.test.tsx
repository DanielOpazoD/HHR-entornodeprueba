/**
 * Critical Paths Integration Tests
 *
 * Tests the full application flow for mission-critical operations:
 * 1. Patient Admission (Ingreso)
 * 2. Patient Discharge (Alta)
 * 3. Daily Census Save (Guardado)
 * 4. Handoff Signature (Firma)
 *
 * key distinction: Uses REAL useDailyRecord hook logic with MOCKED Repository layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { AuditProvider } from '@/context/AuditContext';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { DataFactory } from '../factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { wireStatefulDailyRecordRepoMock } from '@/tests/utils/dailyRecordRepositoryMockUtils';

// ============================================================================
// MOCKS (Repository Layer)
// ============================================================================

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    subscribe: vi.fn(() => {
      return () => {};
    }),
    subscribeDetailed: vi.fn(() => {
      return () => {};
    }),
    syncWithFirestore: vi.fn().mockResolvedValue(null),
    syncWithFirestoreDetailed: vi.fn().mockResolvedValue(null),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: mockDailyRecordRepositoryPort,
  defaultDailyRecordWritePort: {
    updatePartial: mockDailyRecordRepositoryPort.updatePartialDetailed,
    save: mockDailyRecordRepositoryPort.saveDetailed,
    delete: mockDailyRecordRepositoryPort.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordRepositoryPort.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: mockDailyRecordRepositoryPort,
}));

vi.mock('@/firebaseConfig', () => ({
  auth: {
    onAuthStateChanged: vi.fn(cb => {
      cb({ uid: 'test-user-123', email: 'hospitalizados@hospitalhangaroa.cl' });
      return () => {};
    }),
  },
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn() })),
    })),
  },
}));

// Mock firebase/auth to override global setup and force correct email
vi.mock('firebase/auth', async importOriginal => {
  const actual = (await importOriginal()) as typeof import('firebase/auth');
  return {
    ...actual,
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn((auth, callback) => {
      // Return user with static role email
      callback({
        uid: 'test-user-123',
        email: 'hospitalizados@hospitalhangaroa.cl',
        displayName: 'Test User',
        getIdToken: () => Promise.resolve('token'),
      });
      return () => {};
    }),
  };
});

// Mock firebase/firestore to prevent errors during Auth checks
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
  };
});

vi.mock('@/services/utils/errorService', () => ({
  logFirebaseError: vi.fn(),
  // Mock getUserFriendlyErrorMessage to return a simple string
  getUserFriendlyErrorMessage: (_err: unknown) => 'Error simulado',
}));

vi.mock('@/services/admin/auditService', () => ({
  logPatientAdmission: vi.fn(),
  logPatientDischarge: vi.fn(),
  logMedicalHandoffModified: vi.fn(),
  logEvent: vi.fn(),
  logDebouncedEvent: vi.fn(),
  logUserLogin: vi.fn(),
}));

// ============================================================================
// TEST SETUP w/ REAL LOGIC
// ============================================================================

// ============================================================================
// TEST SETUP w/ REAL LOGIC
// ============================================================================

const createIntegrationWrapper = () => {
  const { wrapper } = createQueryClientTestWrapper({
    wrapChildren: children => (
      <UIProvider>
        <AuthProvider>
          <AuditProvider>
            {/* We don't provide DailyRecordContext here because we verify the hook directly */}
            {children}
          </AuditProvider>
        </AuthProvider>
      </UIProvider>
    ),
  });
  return wrapper;
};

// ============================================================================
// TESTS
// ============================================================================

describe('Critical Integration Paths', () => {
  // State for the mock repository
  let currentRecord: DailyRecord | null = null;
  const mockDate = '2025-01-04';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Initialize State
    currentRecord = DataFactory.createMockDailyRecord(mockDate, {
      beds: {
        'bed-1': DataFactory.createMockPatient('bed-1'),
      },
    });

    wireStatefulDailyRecordRepoMock(mockDailyRecordRepositoryPort, {
      getCurrentRecord: () => currentRecord,
      setCurrentRecord: record => {
        currentRecord = record;
      },
    });
  });

  it('FLOW 1: Patient Admission (Ingreso)', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), {
      wrapper: createIntegrationWrapper(),
    });

    await act(async () => {
      await result.current.createDay(false);
    });

    await waitFor(() => expect(result.current.record).not.toBeNull());

    // 1. Simulate Input: Admit Patient to Bed 1
    await act(async () => {
      result.current.updatePatientMultiple('bed-1', {
        patientName: 'Juan Perez',
        rut: '12.345.678-9',
        age: '45',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.GRAVE,
        pathology: 'Apendicitis',
        admissionDate: '2025-01-04',
      });
    });

    // 2. Verify State Update (Optimistic)
    await waitFor(() => {
      const bed = result.current.record?.beds['bed-1'];
      expect(bed?.patientName).toBe('Juan Perez');
      expect(bed?.specialty).toBe(Specialty.CIRUGIA);
    });

    // 3. Verify Repository Update (Persistence)
    expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
  });

  it('FLOW 2: Patient Discharge (Alta)', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), {
      wrapper: createIntegrationWrapper(),
    });

    await act(async () => {
      await result.current.createDay(false);
    });

    await act(async () => {
      result.current.updatePatientMultiple('bed-1', {
        patientName: 'Maria Silva',
        rut: '11.111.111-1',
      });
    });

    await waitFor(() =>
      expect(result.current.record?.beds['bed-1'].patientName).toBe('Maria Silva')
    );
    vi.mocked(mockDailyRecordRepositoryPort.updatePartialDetailed).mockClear();

    // 1. Execute Discharge
    await act(async () => {
      await result.current.addDischarge(
        'bed-1',
        'Vivo',
        undefined,
        'Domicilio',
        undefined,
        '12:00'
      );
    });

    // 2. Verify Bed Cleared
    await waitFor(() => {
      expect(result.current.record?.beds['bed-1'].patientName).toBe('');
      expect(result.current.record?.discharges).toHaveLength(1);
    });

    // 3. Verify Discharge Record Created
    expect(result.current.record?.discharges[0].patientName).toBe('Maria Silva');

    // 4. Verify Persistence through one atomic patch
    expect(mockDailyRecordRepositoryPort.saveDetailed).not.toHaveBeenCalled();
    expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      expect.objectContaining({
        discharges: expect.arrayContaining([
          expect.objectContaining({
            bedId: 'bed-1',
            patientName: 'Maria Silva',
          }),
        ]),
        'beds.bed-1': expect.objectContaining({
          bedId: 'bed-1',
          patientName: '',
          rut: '',
        }),
      }),
      expect.objectContaining({
        baseRecord: expect.objectContaining({
          date: mockDate,
          beds: expect.objectContaining({
            'bed-1': expect.objectContaining({
              patientName: 'Maria Silva',
              rut: '11.111.111-1',
            }),
          }),
        }),
      })
    );
  });

  it('FLOW 3: Census Modify & Save', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), {
      wrapper: createIntegrationWrapper(),
    });
    await act(async () => {
      await result.current.createDay(false);
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    // 1. Modify multiple fields (Simulating dragging/typing in Census)
    await act(async () => {
      result.current.updatePatient('bed-1', 'pathology', 'Fiebre');
    });

    // 2. Verify State Update (Optimistic)
    await waitFor(() => {
      expect(result.current.record?.beds['bed-1'].pathology).toBe('Fiebre');
    });

    // 3. Expect Partial Update
    expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
  });

  it('FLOW 4: Medical Handoff Signature', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), {
      wrapper: createIntegrationWrapper(),
    });
    await act(async () => {
      await result.current.createDay(false);
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    // 1. Sign
    await act(async () => {
      await result.current.updateMedicalSignature('Dr. House');
    });

    // 2. Verify State
    await waitFor(() => {
      expect(result.current.record?.medicalSignature?.doctorName).toBe('Dr. House');
    });

    // 3. Verify Async Persistence (now uses patchRecord / updatePartialDetailed)
    expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
  });
});
