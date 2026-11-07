import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { dailyRecordSyncLogger } from '@/services/repositories/repositoryLoggers';

/**
 * Confirms with the server, outside the Firestore SDK, that a day the SDK reported missing really
 * is missing. A missing day offers to create it, and on 2026-11-07 the SDK's local cache said
 * «does not exist» for a day the server still had; its own server reads answered from that cache.
 *
 * Throws when the server has the day: the cache lost it, which is a failed read, not an empty day
 * (SAVE-01). When this check cannot answer, the SDK's answer stands, so starting a new day never
 * depends on it; the save transaction refuses to overwrite an existing day either way.
 */
export const confirmDailyRecordMissingOnServer = async (date: string): Promise<void> => {
  let fields: unknown;
  try {
    const ref = getRecordDocRef(date);
    const { readFirestoreDocumentFromServer } =
      await import('@/services/storage/firestore/firestoreServerDocumentRead');
    fields = await readFirestoreDocumentFromServer(ref.firestore, ref.path, ['date']);
  } catch (error) {
    // An answer for the previous person's session confirms nothing for the current one.
    if ((error as { code?: string } | null)?.code === 'cancelled') throw error;
    dailyRecordSyncLogger.warn(`Could not confirm with the server that ${date} is missing`, error);
    return;
  }
  if (fields === null) return;
  dailyRecordObservability.recordEvent('server_contradicted_missing_record', 'degraded', {
    date,
    runtimeState: 'blocked',
    issues: ['La copia local dijo que el día no existe, pero el servidor lo tiene.'],
  });
  throw new Error(`The local Firestore cache lost ${date}; the server still has it`);
};
