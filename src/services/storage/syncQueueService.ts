/**
 * Sync Queue Service (Outbox Pattern)
 * 
 * Manages a queue of pending mutations to be synced with Firestore when online.
 * This ensures data consistency even if the user closes the app while offline
 * or if a write fails due to network instability.
 */

import { db } from '../infrastructure/db';
import { hospitalDB as indexedDB } from './indexedDBService';
import { DailyRecord } from '@/types';
import { getDailyRecordsPath } from '@/constants/firestorePaths';
import { logError } from '@/services/utils/errorService';

export interface SyncTask {
    id?: number;
    type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT';
    payload: unknown;
    timestamp: number;
    retryCount: number;
    nextAttemptAt?: number;
    status: 'PENDING' | 'PROCESSING' | 'FAILED';
    error?: string;
    key?: string;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
let isProcessing = false;

const computeBackoffMs = (attempt: number): number => {
    const jitter = Math.random() * 500;
    const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
    return delay + jitter;
};

const getTaskKey = (type: SyncTask['type'], payload: unknown): string | undefined => {
    if (type === 'UPDATE_DAILY_RECORD') {
        const record = payload as DailyRecord;
        return record?.date ? `daily:${record.date}` : undefined;
    }
    return undefined;
};

export const getSyncQueueStats = async (): Promise<{ pending: number; failed: number }> => {
    try {
        const pending = await indexedDB.syncQueue.where('status').equals('PENDING').count();
        const failed = await indexedDB.syncQueue.where('status').equals('FAILED').count();
        return { pending, failed };
    } catch (error) {
        console.warn('[SyncQueue] Failed to read queue stats:', error);
        return { pending: 0, failed: 0 };
    }
};

/**
 * Adds a task to the sync queue.
 */
export const queueSyncTask = async (
    type: SyncTask['type'],
    payload: unknown
): Promise<void> => {
    try {
        const key = getTaskKey(type, payload);
        const now = Date.now();

        if (key) {
            const existing = await indexedDB.syncQueue
                .where('type')
                .equals(type)
                .toArray();

            const match = existing.find(task =>
                task.key === key && task.status !== 'FAILED'
            );

            if (match?.id) {
                await indexedDB.syncQueue.update(match.id, {
                    payload,
                    timestamp: now,
                    status: 'PENDING',
                    nextAttemptAt: 0,
                    error: undefined
                });
                if (navigator.onLine) {
                    processSyncQueue();
                }
                return;
            }
        }

        await indexedDB.syncQueue.add({
            type,
            payload,
            timestamp: now,
            retryCount: 0,
            status: 'PENDING',
            nextAttemptAt: 0,
            key
        });

        // Trigger processing immediately if online
        if (navigator.onLine) {
            processSyncQueue();
        }
    } catch (error) {
        console.error('[SyncQueue] Failed to queue task:', error);
    }
};

/**
 * Processes pending tasks in the queue.
 */
export const processSyncQueue = async (): Promise<void> => {
    if (isProcessing) return;
    isProcessing = true;

    const now = Date.now();
    const tasks = await indexedDB.syncQueue
        .where('status')
        .equals('PENDING')
        .sortBy('timestamp');

    const readyTasks = tasks.filter(task => (task.nextAttemptAt || 0) <= now);
    if (readyTasks.length === 0) {
        isProcessing = false;
        return;
    }

    console.warn(`[SyncQueue] Processing ${readyTasks.length} pending tasks...`);

    try {
        for (const task of readyTasks) {
            if (!task.id) continue;

            try {
                // Mark as processing
                await indexedDB.syncQueue.update(task.id, { status: 'PROCESSING' });

                // Execute task based on type
                switch (task.type) {
                    case 'UPDATE_DAILY_RECORD':
                        await syncDailyRecord(task.payload as DailyRecord);
                        break;
                    // Add other cases here
                }

                // Task successful - remove from queue
                await indexedDB.syncQueue.delete(task.id);
                console.warn(`[SyncQueue] Task ${task.id} completed successfully.`);

            } catch (error) {
                console.error(`[SyncQueue] Task ${task.id} failed:`, error);

                const newRetryCount = task.retryCount + 1;

                if (newRetryCount >= MAX_RETRIES) {
                    // Max retries reached - mark as failed (dead letter)
                    await indexedDB.syncQueue.update(task.id, {
                        status: 'FAILED',
                        error: error instanceof Error ? error.message : String(error),
                        retryCount: newRetryCount
                    });
                    logError('Sync task permanently failed', error instanceof Error ? error : undefined, {
                        taskId: task.id,
                        type: task.type,
                        key: task.key,
                        retryCount: newRetryCount
                    });
                } else {
                    const delay = computeBackoffMs(newRetryCount);
                    await indexedDB.syncQueue.update(task.id, {
                        status: 'PENDING',
                        retryCount: newRetryCount,
                        error: error instanceof Error ? error.message : String(error),
                        nextAttemptAt: Date.now() + delay
                    });
                }
            }
        }
    } finally {
        isProcessing = false;
    }
};

/**
 * Executes the Firestore write for a DailyRecord.
 */
async function syncDailyRecord(record: DailyRecord): Promise<void> {
    const path = getDailyRecordsPath();
    await db.setDoc(path, record.date, record, { merge: true });
}

// Auto-start processing when coming online
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        console.warn('[SyncQueue] Online detected, flushing queue...');
        processSyncQueue();
    });
}
