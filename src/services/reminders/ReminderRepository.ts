import {
  deleteDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  waitForPendingWrites,
  type Firestore,
} from 'firebase/firestore';
import { defaultReminderFirestoreRuntime } from '@/services/firebase-runtime/reminderRuntime';
import type { Reminder } from '@/types/reminders';
import {
  getReminderDocRef,
  getRemindersCollectionRef,
  normalizeReminderRecord,
} from './reminderShared';
import {
  isReminderPermissionDeniedError,
  resolveReminderOperationErrorKind,
  type ReminderOperationErrorKind,
} from './reminderErrorPolicy';
import { reminderObservability } from './reminderObservability';

const reminderRepositoryLogger = reminderObservability.logger;

const sortReminders = (items: Reminder[]): Reminder[] =>
  [...items].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });

export type ReminderRepositoryErrorKind = ReminderOperationErrorKind;
export type ReminderRepositorySubscriptionErrorKind =
  | ReminderRepositoryErrorKind
  | 'unconfirmed_cache'
  | 'invalid_record';

export type ReminderRepositoryMutationResult =
  | { status: 'success' }
  | { status: ReminderRepositoryErrorKind; error: unknown };

export type ReminderRepositoryListResult =
  | { status: 'success'; reminders: Reminder[] }
  | { status: ReminderRepositoryErrorKind; error: unknown; reminders: Reminder[] };

export interface ReminderRepositorySubscriptionOptions {
  onError?: (error: unknown, kind: ReminderRepositorySubscriptionErrorKind) => void;
  onCachedSnapshot?: (reminders: Reminder[]) => void;
}

export interface ReminderRepositoryDependencies {
  runtime?: typeof defaultReminderFirestoreRuntime;
}

const isLiveFirestoreInstance = (value: unknown): value is Firestore =>
  Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
  );

const parseReminderDocs = (
  docs: readonly { id: string; data: () => unknown }[]
): { reminders: Reminder[]; invalidCount: number } => {
  const reminders: Reminder[] = [];
  let invalidCount = 0;
  for (const docSnap of docs) {
    const rawData = docSnap.data();
    const record =
      rawData && typeof rawData === 'object' ? { id: docSnap.id, ...rawData } : rawData;
    const normalized = normalizeReminderRecord(record, docSnap.id);
    if (normalized) {
      reminders.push(normalized);
    } else {
      invalidCount += 1;
    }
  }
  return { reminders: sortReminders(reminders), invalidCount };
};

export const createReminderRepository = ({
  runtime = defaultReminderFirestoreRuntime,
}: ReminderRepositoryDependencies = {}) => ({
  subscribe(
    callback: (reminders: Reminder[]) => void,
    options: ReminderRepositorySubscriptionOptions = {}
  ): () => void {
    const remindersQuery = query(getRemindersCollectionRef(runtime), orderBy('createdAt', 'desc'));
    let active = true;
    let snapshotSeq = 0;
    let lastConfirmedIds = new Set<string>();

    const reportInvalidRecords = (invalidCount: number) => {
      reminderObservability.recordEvent('subscribe_reminders', 'degraded', {
        issues: ['Se encontraron avisos con formato inválido.'],
        context: { errorKind: 'invalid_record', invalidCount },
      });
      options.onError?.(new Error('Se encontraron avisos con formato inválido.'), 'invalid_record');
    };

    const reportUnconfirmedCache = () => {
      reminderObservability.recordEvent('subscribe_reminders', 'degraded', {
        issues: ['No fue posible confirmar los avisos desde el servidor.'],
        context: { errorKind: 'unconfirmed_cache' },
      });
      options.onError?.(
        new Error('No fue posible confirmar los avisos desde el servidor.'),
        'unconfirmed_cache'
      );
    };

    const unsubscribe = onSnapshot(
      remindersQuery,
      { includeMetadataChanges: true },
      snapshot => {
        if (!active) return;
        const seq = ++snapshotSeq;
        const hasMetadata = Boolean(snapshot.metadata);
        const fromCache = Boolean(snapshot.metadata?.fromCache);
        const hasPendingWrites = Boolean(
          snapshot.metadata?.hasPendingWrites ||
          snapshot.docs.some(docSnap => docSnap.metadata?.hasPendingWrites)
        );
        const { reminders, invalidCount } = parseReminderDocs(snapshot.docs);

        if (invalidCount > 0) {
          reportInvalidRecords(invalidCount);
          return;
        }

        if (fromCache) {
          if (reminders.length === 0) {
            reportUnconfirmedCache();
            return;
          }
          if (options.onCachedSnapshot) {
            options.onCachedSnapshot(reminders);
          } else {
            callback(reminders);
          }
          return;
        }

        const nextIds = new Set(reminders.map(item => item.id));
        const hasRemovedId = [...lastConfirmedIds].some(id => !nextIds.has(id));
        const needsServerSettlement = hasMetadata && isLiveFirestoreInstance(runtime.firestore);

        if (!needsServerSettlement) {
          lastConfirmedIds = nextIds;
          callback(reminders);
          return;
        }

        const verifyAgainstServer = hasPendingWrites || reminders.length === 0 || hasRemovedId;

        void (async () => {
          try {
            await waitForPendingWrites(runtime.firestore);
            if (!active || snapshotSeq !== seq) return;

            if (!verifyAgainstServer) {
              lastConfirmedIds = nextIds;
              callback(reminders);
              return;
            }

            const verified = await getDocsFromServer(remindersQuery);
            if (!active || snapshotSeq !== seq) return;
            if (
              verified.metadata?.fromCache ||
              verified.metadata?.hasPendingWrites ||
              verified.docs.some(docSnap => docSnap.metadata?.hasPendingWrites)
            ) {
              reportUnconfirmedCache();
              return;
            }

            const parsedVerified = parseReminderDocs(verified.docs);
            if (parsedVerified.invalidCount > 0) {
              reportInvalidRecords(parsedVerified.invalidCount);
              return;
            }

            lastConfirmedIds = new Set(parsedVerified.reminders.map(item => item.id));
            callback(parsedVerified.reminders);
          } catch (error) {
            if (!active || snapshotSeq !== seq) return;
            const kind = resolveReminderOperationErrorKind(error);
            reminderRepositoryLogger.error('Error confirming reminder snapshot from server', error);
            reminderObservability.recordEvent('subscribe_reminders', 'degraded', {
              issues: ['No fue posible confirmar los avisos desde el servidor.'],
              context: { errorKind: kind },
            });
            options.onError?.(error, kind);
          }
        })();
      },
      error => {
        if (!active) return;
        snapshotSeq += 1;
        reminderRepositoryLogger.error('Error subscribing reminders', error);
        const permissionDenied = isReminderPermissionDeniedError(error);
        // A session that just ended loses this listener as well: logged, but nobody gets mailed.
        reminderObservability.recordEvent('subscribe_reminders', 'degraded', {
          issues: ['No fue posible suscribirse a los avisos.'],
          context: { errorKind: permissionDenied ? 'permission_denied' : 'unknown' },
        });
        options.onError?.(error, permissionDenied ? 'permission_denied' : 'unknown');
      }
    );

    return () => {
      active = false;
      snapshotSeq += 1;
      unsubscribe();
    };
  },

  async list(): Promise<Reminder[]> {
    const result = await this.listWithResult();
    if (result.status !== 'success') {
      throw result.error;
    }
    return result.reminders;
  },

  async listWithResult(): Promise<ReminderRepositoryListResult> {
    try {
      const snapshot = await getDocs(
        query(getRemindersCollectionRef(runtime), orderBy('createdAt', 'desc'))
      );
      const { reminders, invalidCount } = parseReminderDocs(snapshot.docs);
      if (invalidCount > 0) {
        throw new Error('Se encontraron avisos con formato inválido.');
      }
      return {
        status: 'success',
        reminders,
      };
    } catch (error) {
      reminderRepositoryLogger.error('Error listing reminders', error);
      reminderObservability.recordEvent('list_reminders', 'failed', {
        issues: ['No fue posible cargar los avisos.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return {
        status: resolveReminderOperationErrorKind(error),
        error,
        reminders: [],
      };
    }
  },

  async getById(reminderId: string): Promise<Reminder | null> {
    const snapshot = await getDoc(getReminderDocRef(reminderId, runtime));
    if (!snapshot.exists()) return null;
    return normalizeReminderRecord({ id: snapshot.id, ...snapshot.data() }, snapshot.id);
  },

  async create(reminder: Reminder): Promise<void> {
    const result = await this.createWithResult(reminder);
    if (result.status !== 'success') {
      throw result.error;
    }
  },

  async update(reminderId: string, patch: Partial<Reminder>): Promise<void> {
    const result = await this.updateWithResult(reminderId, patch);
    if (result.status !== 'success') {
      throw result.error;
    }
  },

  async remove(reminderId: string): Promise<void> {
    const result = await this.removeWithResult(reminderId);
    if (result.status !== 'success') {
      throw result.error;
    }
  },

  async createWithResult(reminder: Reminder): Promise<ReminderRepositoryMutationResult> {
    try {
      await setDoc(getReminderDocRef(reminder.id, runtime), reminder);
      reminderRepositoryLogger.info('Created reminder', {
        reminderId: reminder.id,
        type: reminder.type,
        priority: reminder.priority,
      });
      return { status: 'success' };
    } catch (error) {
      reminderRepositoryLogger.error('Error creating reminder', error);
      reminderObservability.recordEvent('create_reminder', 'failed', {
        issues: ['No fue posible crear el aviso.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return { status: resolveReminderOperationErrorKind(error), error };
    }
  },

  async updateWithResult(
    reminderId: string,
    patch: Partial<Reminder>
  ): Promise<ReminderRepositoryMutationResult> {
    try {
      await updateDoc(getReminderDocRef(reminderId, runtime), patch);
      reminderRepositoryLogger.info('Updated reminder', {
        reminderId,
        fields: Object.keys(patch),
      });
      return { status: 'success' };
    } catch (error) {
      reminderRepositoryLogger.error('Error updating reminder', error);
      reminderObservability.recordEvent('update_reminder', 'failed', {
        issues: ['No fue posible actualizar el aviso.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return { status: resolveReminderOperationErrorKind(error), error };
    }
  },

  async removeWithResult(reminderId: string): Promise<ReminderRepositoryMutationResult> {
    try {
      await deleteDoc(getReminderDocRef(reminderId, runtime));
      reminderRepositoryLogger.info('Removed reminder', { reminderId });
      return { status: 'success' };
    } catch (error) {
      reminderRepositoryLogger.error('Error removing reminder', error);
      reminderObservability.recordEvent('remove_reminder', 'failed', {
        issues: ['No fue posible eliminar el aviso.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return { status: resolveReminderOperationErrorKind(error), error };
    }
  },
});

export const ReminderRepository = createReminderRepository();
