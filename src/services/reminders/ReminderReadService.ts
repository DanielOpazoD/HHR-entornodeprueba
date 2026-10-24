import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';
import { getDoc, getDocs, setDoc } from 'firebase/firestore';
import { defaultReminderFirestoreRuntime } from '@/services/firebase-runtime/reminderRuntime';
import type { ReminderReadReceipt, ReminderShift } from '@/types/reminders';
import {
  buildReminderReadReceiptId,
  getReminderReadReceiptDocRef,
  getReminderReadReceiptsCollectionRef,
  normalizeReminderReadReceipt,
} from './reminderShared';
import {
  resolveReminderOperationErrorKind,
  type ReminderOperationErrorKind,
} from './reminderErrorPolicy';
import { reminderObservability } from './reminderObservability';

const reminderReadLogger = reminderObservability.logger;

export type ReminderReadLookupStatus = 'read' | 'unread' | 'unavailable';

export interface ReminderReadLookupResult {
  status: ReminderReadLookupStatus;
}

export type ReminderReadMutationResult =
  | { status: 'success' }
  | { status: ReminderOperationErrorKind; error: unknown };

export type ReminderReadReceiptsResult =
  | { status: 'success'; receipts: ReminderReadReceipt[] }
  | { status: ReminderOperationErrorKind; error: unknown; receipts: ReminderReadReceipt[] };

export interface ReminderReadServiceDependencies {
  runtime?: typeof defaultReminderFirestoreRuntime;
}

export const createReminderReadService = ({
  runtime = defaultReminderFirestoreRuntime,
}: ReminderReadServiceDependencies = {}) => ({
  async markAsRead(reminderId: string, receipt: ReminderReadReceipt): Promise<void> {
    const result = await this.markAsReadWithResult(reminderId, receipt);
    if (result.status !== 'success') {
      throw result.error;
    }
  },

  async markAsReadWithResult(
    reminderId: string,
    receipt: ReminderReadReceipt
  ): Promise<ReminderReadMutationResult> {
    const receiptId = buildReminderReadReceiptId(
      receipt.userId,
      receipt.shift,
      receipt.dateKey ?? readClinicalTimestamp(receipt.readAt)?.iso ?? ''
    );
    try {
      await setDoc(getReminderReadReceiptDocRef(reminderId, receiptId, runtime), receipt);
      reminderReadLogger.info('Stored reminder read receipt', {
        reminderId,
        receiptId,
        shift: receipt.shift,
        dateKey: receipt.dateKey,
      });
      return { status: 'success' };
    } catch (error) {
      reminderReadLogger.error('Error storing reminder read receipt', error);
      reminderObservability.recordEvent('mark_reminder_read', 'failed', {
        issues: ['No fue posible registrar la lectura del aviso.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return { status: resolveReminderOperationErrorKind(error), error };
    }
  },

  async getUserShiftReadState(
    reminderId: string,
    userId: string,
    shift: ReminderShift,
    dateKey: string
  ): Promise<ReminderReadLookupResult> {
    try {
      const snapshot = await getDoc(
        getReminderReadReceiptDocRef(
          reminderId,
          buildReminderReadReceiptId(userId, shift, dateKey),
          runtime
        )
      );
      return { status: snapshot.exists() ? 'read' : 'unread' };
    } catch (error) {
      reminderReadLogger.warn('Error checking reminder read receipt', error);
      reminderObservability.recordEvent('check_reminder_read', 'degraded', {
        issues: ['No fue posible verificar si el aviso fue leido.'],
      });
      return { status: 'unavailable' };
    }
  },

  async hasUserReadForShiftWindow(
    reminderId: string,
    userId: string,
    shift: ReminderShift,
    dateKey: string
  ): Promise<boolean> {
    const result = await this.getUserShiftReadState(reminderId, userId, shift, dateKey);
    return result.status === 'read';
  },

  async getReadReceipts(reminderId: string): Promise<ReminderReadReceipt[]> {
    const result = await this.getReadReceiptsWithResult(reminderId);
    return result.receipts;
  },

  async getReadReceiptsWithResult(reminderId: string): Promise<ReminderReadReceiptsResult> {
    try {
      const snapshot = await getDocs(getReminderReadReceiptsCollectionRef(reminderId, runtime));
      return {
        status: 'success',
        receipts: snapshot.docs
          .map(docSnap => normalizeReminderReadReceipt(docSnap.data()))
          .filter((item): item is ReminderReadReceipt => Boolean(item))
          .sort((left, right) => right.readAt.localeCompare(left.readAt)),
      };
    } catch (error) {
      reminderReadLogger.error('Error loading reminder receipts', error);
      reminderObservability.recordEvent('list_reminder_receipts', 'failed', {
        issues: ['No fue posible cargar el detalle de lecturas del aviso.'],
        context: { errorKind: resolveReminderOperationErrorKind(error) },
      });
      return {
        status: resolveReminderOperationErrorKind(error),
        error,
        receipts: [],
      };
    }
  },

  buildReceipt(input: {
    userId: string;
    userName: string;
    shift: ReminderShift;
    dateKey: string;
  }): ReminderReadReceipt {
    return {
      userId: input.userId,
      userName: input.userName,
      shift: input.shift,
      dateKey: input.dateKey,
      readAt: new Date().toISOString(),
    };
  },
});

export const ReminderReadService = createReminderReadService();
