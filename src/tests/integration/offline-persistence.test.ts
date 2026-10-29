import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { save as saveRecord } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import * as firestoreService from '@/services/storage/firestore';
// We want real implementation for integration test, but mocked firestore
vi.unmock('@/services/repositories/dailyRecordRepositoryReadService');
vi.unmock('@/services/repositories/dailyRecordRepositoryInitializationService');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

// Mock Firestore service
vi.mock('@/services/storage/firestore', () => ({
  saveRecordToFirestore: vi.fn(),
  subscribeToRecord: vi.fn(() => vi.fn()),
  getRecordFromFirestore: vi.fn(),
  getRecordFromFirestoreDetailed: vi.fn(),
  deleteRecordFromFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));

describe('Offline Persistence Integration', () => {
  const mockDate = '2024-12-25';
  const mockRecord: DailyRecord = {
    date: mockDate,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2024-12-25T00:00:00.000Z',
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
  };

  beforeEach(() => {
    vi.resetAllMocks(); // More thorough than clearAllMocks
    localStorage.clear();
    setFirestoreEnabled(true);
    vi.mocked(firestoreService.getRecordFromFirestoreDetailed).mockImplementation(async date => {
      try {
        const record = await firestoreService.getRecordFromFirestore(date);
        return record
          ? {
              serverConfirmed: false,
              status: 'resolved',
              record,
            }
          : {
              serverConfirmed: false,
              status: 'missing',
              record: null,
            };
      } catch (error) {
        return {
          serverConfirmed: false,
          status: 'failed',
          record: null,
          error,
        };
      }
    });
  });

  it('should save to localStorage even if Firestore fails', async () => {
    vi.mocked(firestoreService.saveRecordToFirestore).mockRejectedValueOnce(
      new Error('Network Failure')
    );

    try {
      await saveRecord(mockRecord);
    } catch (_e) {
      // expected
    }

    const localData = await getForDate(mockDate);
    expect(localData).not.toBeNull();
    expect(localData?.date).toBe(mockDate);
  });

  it('should not call Firestore if disabled', async () => {
    setFirestoreEnabled(false);
    await saveRecord(mockRecord);
    expect(firestoreService.saveRecordToFirestore).not.toHaveBeenCalled();
  });

  it('should initialize day from local storage if firestore fails', async () => {
    // Setup local storage with a previous day
    const prevDate = '2024-12-24';
    const prevRecord = { ...mockRecord, date: prevDate };
    await saveRecord(prevRecord);

    // Mock Firestore failure for GET
    vi.mocked(firestoreService.getRecordFromFirestore).mockRejectedValue(new Error('Timeout'));

    const newRecord = await initializeDay('2024-12-25', prevDate);

    expect(newRecord.date).toBe('2024-12-25');
    expect(await getForDate('2024-12-25')).not.toBeNull();
  });
});
