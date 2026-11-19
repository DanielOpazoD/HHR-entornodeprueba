import type { CollectionReference, DocumentReference } from 'firebase/firestore';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { ReminderReadReceiptSchema, ReminderSchema } from '@/schemas/reminderSchemas';
import {
  defaultReminderFirestoreRuntime,
  type ReminderFirestoreRuntime,
} from '@/services/firebase-runtime/reminderRuntime';
import type { Reminder, ReminderReadReceipt } from '@/types/reminders';

export const REMINDER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const getRemindersCollectionRef = (
  runtime: ReminderFirestoreRuntime = defaultReminderFirestoreRuntime
): CollectionReference =>
  runtime.collection(
    runtime.firestore,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.REMINDERS
  );

export const getReminderDocRef = (
  reminderId: string,
  runtime: ReminderFirestoreRuntime = defaultReminderFirestoreRuntime
): DocumentReference => runtime.doc(getRemindersCollectionRef(runtime), reminderId);

export const getReminderReadReceiptsCollectionRef = (
  reminderId: string,
  runtime: ReminderFirestoreRuntime = defaultReminderFirestoreRuntime
): CollectionReference =>
  runtime.collection(getReminderDocRef(reminderId, runtime), 'readReceipts');

export const buildReminderReadReceiptId = (
  userId: string,
  shift: ReminderReadReceipt['shift'],
  dateKey: string
) => `${userId}__${dateKey}__${shift}`;

export const getReminderReadReceiptDocRef = (
  reminderId: string,
  receiptId: string,
  runtime: ReminderFirestoreRuntime = defaultReminderFirestoreRuntime
): DocumentReference =>
  runtime.doc(getReminderReadReceiptsCollectionRef(reminderId, runtime), receiptId);

export const normalizeReminderRecord = (record: unknown, fallbackId?: string): Reminder | null => {
  const parsed = ReminderSchema.safeParse(record);
  if (parsed.success) return parsed.data;
  if (!record || typeof record !== 'object') return null;
  const raw = record as Record<string, unknown>;
  const withFallbackId = fallbackId ? { ...raw, id: raw.id || fallbackId } : raw;
  const retried = ReminderSchema.safeParse(withFallbackId);
  return retried.success ? retried.data : null;
};

export const normalizeReminderReadReceipt = (record: unknown): ReminderReadReceipt | null => {
  const parsed = ReminderReadReceiptSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
};
