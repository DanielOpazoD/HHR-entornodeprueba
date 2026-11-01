import {
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
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

export type ReminderRepositoryMutationResult =
  | { status: 'success' }
  | { status: ReminderRepositoryErrorKind; error: unknown };

export type ReminderRepositoryListResult =
  | { status: 'success'; reminders: Reminder[] }
  | { status: ReminderRepositoryErrorKind; error: unknown; reminders: Reminder[] };

export interface ReminderRepositorySubscriptionOptions {
  onError?: (error: unknown, kind: ReminderRepositoryErrorKind) => void;
}

export interface ReminderRepositoryDependencies {
  runtime?: typeof defaultReminderFirestoreRuntime;
}

export const createReminderRepository = ({
  runtime = defaultReminderFirestoreRuntime,
}: ReminderRepositoryDependencies = {}) => ({
  subscribe(
    callback: (reminders: Reminder[]) => void,
    options: ReminderRepositorySubscriptionOptions = {}
  ): () => void {
    const remindersQuery = query(getRemindersCollectionRef(runtime), orderBy('createdAt', 'desc'));

    return onSnapshot(
      remindersQuery,
      snapshot => {
        const reminders = snapshot.docs
          .map(docSnap =>
            normalizeReminderRecord({ id: docSnap.id, ...docSnap.data() }, docSnap.id)
          )
          .filter((item): item is Reminder => Boolean(item));
        callback(sortReminders(reminders));
      },
      error => {
        reminderRepositoryLogger.error('Error subscribing reminders', error);
        const permissionDenied = isReminderPermissionDeniedError(error);
        // A session that just ended loses this listener as well: logged, but nobody gets mailed.
        reminderObservability.recordEvent(
          'subscribe_reminders',
          permissionDenied ? 'degraded' : 'failed',
          {
            issues: ['No fue posible suscribirse a los avisos.'],
            context: { errorKind: permissionDenied ? 'permission_denied' : 'unknown' },
          }
        );
        options.onError?.(error, permissionDenied ? 'permission_denied' : 'unknown');
        callback([]);
      }
    );
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
      return {
        status: 'success',
        reminders: sortReminders(
          snapshot.docs
            .map(docSnap =>
              normalizeReminderRecord({ id: docSnap.id, ...docSnap.data() }, docSnap.id)
            )
            .filter((item): item is Reminder => Boolean(item))
        ),
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
