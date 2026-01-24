/**
 * Sync Queue Service (Outbox Pattern)
 * 
 * Manages a queue of pending mutations to be synced with Firestore when online.
 * This ensures data consistency even if the user closes the app while offline
 * or if a write fails due to network instability.
 */

import { db } from '../infrastructure/db';
import { hospitalDB as indexedDB } from './indexedDBService';
import { DailyRecord } from '../../types';

export interface SyncTask {
    id?: number;
    type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT';
    payload: any;
    timestamp: number;
    retryCount: number;
    status: 'PENDING' | 'PROCESSING' | 'FAILED';
    error?: string;
}

const MAX_RETRIES = 5;

/**
 * Adds a task to the sync queue.
 */
export const queueSyncTask = async (
    type: SyncTask['type'],
    payload: any
): Promise<void> => {
    try {
        await indexedDB.syncQueue.add({
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'PENDING'
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
    const tasks = await indexedDB.syncQueue
        .where('status')
        .equals('PENDING')
        .sortBy('timestamp');

    if (tasks.length === 0) return;

    console.info(`[SyncQueue] Processing ${tasks.length} pending tasks...`);

    for (const task of tasks) {
        if (!task.id) continue;

        try {
            // Mark as processing
            await indexedDB.syncQueue.update(task.id, { status: 'PROCESSING' });

            // Execute task based on type
            switch (task.type) {
                case 'UPDATE_DAILY_RECORD':
                    await syncDailyRecord(task.payload);
                    break;
                // Add other cases here
            }

            // Task successful - remove from queue
            await indexedDB.syncQueue.delete(task.id);
            console.debug(`[SyncQueue] Task ${task.id} completed successfully.`);

        } catch (error: any) {
            console.error(`[SyncQueue] Task ${task.id} failed:`, error);

            const newRetryCount = task.retryCount + 1;

            if (newRetryCount >= MAX_RETRIES) {
                // Max retries reached - mark as failed (dead letter)
                await indexedDB.syncQueue.update(task.id, {
                    status: 'FAILED',
                    error: error.message,
                    retryCount: newRetryCount
                });
            } else {
                // Re-queue for retry (simple backoff could be added here)
                await indexedDB.syncQueue.update(task.id, {
                    status: 'PENDING',
                    retryCount: newRetryCount,
                    error: error.message
                });
            }
        }
    }
};

/**
 * Executes the Firestore write for a DailyRecord.
 */
async function syncDailyRecord(record: DailyRecord): Promise<void> {
    const docRef = db.collection('hospitals').doc('hanga_roa').collection('dailyRecords').doc(record.date);
    await docRef.set(record, { merge: true });
}

// Auto-start processing when coming online
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        console.info('[SyncQueue] Online detected, flushing queue...');
        processSyncQueue();
    });
}
