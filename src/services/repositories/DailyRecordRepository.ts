/**
 * Daily Record Repository
 * Provides a unified interface for accessing and persisting daily records.
 * Abstracts localStorage and Firestore operations.
 * Supports demo mode with isolated storage.
 */

import { DailyRecord } from '@/types';
import { DailyRecordPatch } from '@/types';
import { deleteRecord as deleteFromIndexedDB, deleteDemoRecord } from '../storage/indexedDBService';
import {
  deleteRecordFromFirestore,
  getRecordFromFirestore,
  moveRecordToTrash,
} from '../storage/firestoreService';
// import {
//     getActiveHospitalId
// } from '@/constants/firestorePaths';

// ============================================================================
// Configuration (imported from repositoryConfig)
// ============================================================================

export {
  setFirestoreEnabled,
  isFirestoreEnabled,
  setDemoModeActive,
  isDemoModeActive,
} from './repositoryConfig';
import { isFirestoreEnabled, isDemoModeActive } from './repositoryConfig';

// Re-export from dedicated modules
export { CatalogRepository } from './CatalogRepository';
export { migrateLegacyData } from './dataMigration';
import {
  getAvailableDates as getAvailableDatesFromReadService,
  getForDate as getForDateFromReadService,
  getPreviousDay as getPreviousDayFromReadService,
} from './dailyRecordRepositoryReadService';
import {
  save as saveFromWriteService,
  updatePartial as updatePartialFromWriteService,
} from './dailyRecordRepositoryWriteService';
import {
  subscribe as subscribeFromSyncService,
  syncWithFirestore as syncWithFirestoreFromSyncService,
} from './dailyRecordRepositorySyncService';
import {
  copyPatientToDate as copyPatientToDateFromInitializationService,
  initializeDay as initializeDayFromInitializationService,
} from './dailyRecordRepositoryInitializationService';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IDailyRecordRepository {
  getForDate(date: string): Promise<DailyRecord | null>;
  getPreviousDay(date: string): Promise<DailyRecord | null>;
  save(record: DailyRecord, expectedLastUpdated?: string): Promise<void>;
  subscribe(
    date: string,
    callback: (r: DailyRecord | null, hasPendingWrites: boolean) => void
  ): () => void;
  initializeDay(date: string, copyFromDate?: string): Promise<DailyRecord>;
  deleteDay(date: string): Promise<void>;
  getAllDates(): Promise<string[]>;
  updatePartial(date: string, patches: DailyRecordPatch): Promise<void>;
  copyPatientToDate(
    sourceDate: string,
    sourceBedId: string,
    targetDate: string,
    targetBedId: string
  ): Promise<void>;
}

// ============================================================================
// Repository Implementation
// ============================================================================

export const getForDate = getForDateFromReadService;
export const getPreviousDay = getPreviousDayFromReadService;
export const getAvailableDates = getAvailableDatesFromReadService;

export const save = saveFromWriteService;
export const updatePartial = updatePartialFromWriteService;
export const subscribe = subscribeFromSyncService;
export const syncWithFirestore = syncWithFirestoreFromSyncService;

export const initializeDay = initializeDayFromInitializationService;

/**
 * Deletes a daily record from both local and remote storage.
 */
export const deleteDay = async (date: string): Promise<void> => {
  if (isDemoModeActive()) {
    await deleteDemoRecord(date);
  } else {
    // 1. Local Delete (IndexedDB)
    await deleteFromIndexedDB(date);

    // 2. Soft Delete in Firestore (Move to trash)
    if (isFirestoreEnabled()) {
      try {
        const record = await getRecordFromFirestore(date);
        if (record) {
          // Create a snapshot in the deletedRecords collection
          // Note: This requires a new helper in firestoreService or direct access
          // For now, I'll use saveRecordToFirestore with a custom path if possible,
          // or just implement moveRecordToTrash in firestoreService.
          await moveRecordToTrash(record);
        }
        await deleteRecordFromFirestore(date);
      } catch (error) {
        console.error('Failed to soft-delete from Firestore:', error);
        // Fallback to hard delete if move fails? No, better to keep it and report error.
      }
    }
  }
};

export const copyPatientToDate = copyPatientToDateFromInitializationService;

// ============================================================================
// Repository Object Export (Alternative API)
// ============================================================================

export const DailyRecordRepository: IDailyRecordRepository & {
  syncWithFirestore: typeof syncWithFirestore;
} = {
  getForDate,
  getPreviousDay,
  save,
  subscribe,
  initializeDay,
  deleteDay,
  updatePartial,
  copyPatientToDate,
  syncWithFirestore,
  getAllDates: getAvailableDates,
};
