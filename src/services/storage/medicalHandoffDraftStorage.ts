import { z } from 'zod';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SpecialistHandoffSyncPayload } from './syncQueueTypes';
import {
  buildSpecialistHandoffIdentity,
  type SpecialistHandoffIdentity,
} from './firestore/specialistMedicalHandoffIdentity';
import { getStoredSessionOwnerKey } from './sessionOwnerKey';

/**
 * Unconfirmed medical handoff text, one localStorage key per draft and editing session.
 *
 * A session writes only its own slot, so no tab, reload or later session ever overwrites another
 * one's text. Anyone deletes a slot only while it still holds the exact text being confirmed by
 * the server or discarded by the user. A failed write stays in memory, marked as not durable.
 */
const PREFIX = 'hhr.medicalHandoffDraft.v2:';
const LEGACY_PREFIX = 'hhr.medicalHandoffDrafts.v1:';

const draftSchema = z.object({
  date: z.string(),
  documentType: z.string(),
  rut: z.string(),
  patientName: z.string(),
  clinicalEpisodeId: z.string(),
  entryId: z.string(),
  value: z.string(),
});
const entriesSchema = z.array(z.object({ id: z.string(), note: z.string() }));

export type MedicalHandoffDraftInput = z.infer<typeof draftSchema>;
export interface MedicalHandoffDraft extends MedicalHandoffDraftInput {
  /** Same note across tabs and sessions: user bucket, date, patient, episode and entry. */
  key: string;
  /** Storage key of this copy; written only by the session that created it. */
  slot: string;
  durable: boolean;
}
type DraftOccupant = SpecialistHandoffIdentity & { entries?: unknown };

const pageId = Math.random().toString(36).slice(2);
let writerSequence = 0;
let version = 0;
let snapshot: { version: number; owner: string | null; drafts: MedicalHandoffDraft[] } | null =
  null;
const pending = new Map<string, MedicalHandoffDraft>();
const editors = new Map<string, number>();
const listeners = new Set<() => void>();
const migratedOwners = new Set<string>();

const changed = () => {
  version += 1;
  listeners.forEach(listener => listener());
};
const currentOwner = (): string | null => {
  try {
    const owner = getStoredSessionOwnerKey();
    return owner?.startsWith('user:') ? owner : null;
  } catch {
    return null;
  }
};
const ownerPrefix = (owner: string | null) => `${PREFIX}${owner ?? ''}:`;

export const medicalHandoffDraftKey = (draft: Omit<MedicalHandoffDraftInput, 'value'>): string =>
  JSON.stringify([
    draft.date,
    draft.documentType,
    draft.rut,
    draft.patientName,
    draft.clinicalEpisodeId,
    draft.entryId,
  ]);

/** A new writer per editing session; its slots are never written by anyone else. */
export const createMedicalHandoffDraftWriter = (): string => `${pageId}.${(writerSequence += 1)}`;

const persist = (owner: string | null, slot: string, draft: MedicalHandoffDraftInput): boolean => {
  if (!owner) return false;
  try {
    localStorage.setItem(slot, JSON.stringify(draftSchema.parse(draft)));
    return true;
  } catch {
    return false;
  }
};

const parseSlot = (slot: string): MedicalHandoffDraft | null => {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(localStorage.getItem(slot) ?? 'null'));
    return parsed.success
      ? { ...parsed.data, key: medicalHandoffDraftKey(parsed.data), slot, durable: true }
      : null;
  } catch {
    return null;
  }
};

/** Retry pending copies; text typed without a session is adopted once an owner signs in. */
const flushPending = (owner: string | null) => {
  for (const [slot, draft] of [...pending]) {
    let target = slot;
    if (owner && slot.startsWith(ownerPrefix(null))) {
      target = ownerPrefix(owner) + slot.slice(ownerPrefix(null).length);
      pending.delete(slot);
      pending.set(target, { ...draft, slot: target });
    }
    if (target.startsWith(ownerPrefix(owner)) && persist(owner, target, draft))
      pending.delete(target);
  }
};

const migrateLegacyDrafts = (owner: string) => {
  if (migratedOwners.has(owner)) return;
  migratedOwners.add(owner);
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + owner);
    const parsed = draftSchema.array().safeParse(JSON.parse(raw ?? 'null'));
    if (!parsed.success) return;
    const migrated = parsed.data.every(draft =>
      persist(owner, `${ownerPrefix(owner)}v1:${medicalHandoffDraftKey(draft)}`, draft)
    );
    if (migrated) localStorage.removeItem(LEGACY_PREFIX + owner);
  } catch {
    // Unreadable legacy data stays where it is; nothing is deleted on a failed migration.
  }
};

export const readMedicalHandoffDrafts = (): MedicalHandoffDraft[] => {
  const owner = currentOwner();
  if (owner) {
    migrateLegacyDrafts(owner);
    if ([...pending.keys()].some(slot => slot.startsWith(ownerPrefix(null)))) {
      flushPending(owner);
      version += 1;
    }
  }
  if (snapshot?.version === version && snapshot.owner === owner) return snapshot.drafts;
  const drafts = new Map<string, MedicalHandoffDraft>();
  if (owner) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const slot = localStorage.key(index);
      const draft = slot?.startsWith(ownerPrefix(owner)) ? parseSlot(slot) : null;
      if (draft) drafts.set(draft.slot, draft);
    }
  }
  for (const [slot, draft] of pending) {
    if (slot.startsWith(ownerPrefix(owner))) drafts.set(slot, draft);
  }
  snapshot = { version, owner, drafts: [...drafts.values()] };
  return snapshot.drafts;
};

export const subscribeMedicalHandoffDrafts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (!event.key || event.key.startsWith(PREFIX)) changed();
  });
}

/** Returns whether this copy is durable; a failed copy stays in memory and is retried. */
export const writeMedicalHandoffDraft = (
  writer: string,
  draft: MedicalHandoffDraftInput
): boolean => {
  const owner = currentOwner();
  const key = medicalHandoffDraftKey(draft);
  const slot = `${ownerPrefix(owner)}${writer}:${key}`;
  const durable = persist(owner, slot, draft);
  if (durable) pending.delete(slot);
  else pending.set(slot, { ...draft, key, slot, durable: false });
  flushPending(owner);
  changed();
  return durable;
};

/** A slot has one writer, so a pending copy is newer than whatever that slot holds on disk. */
const removeIfUnchanged = (slot: string, value: string): boolean => {
  const newest = pending.get(slot) ?? parseSlot(slot);
  if (newest?.value !== value) return false;
  pending.delete(slot);
  try {
    localStorage.removeItem(slot);
    return true;
  } catch {
    return !parseSlot(slot);
  }
};

/** Explicit user discard of the copy shown; another session's newer text is never removed. */
export const discardMedicalHandoffDraft = (draft: MedicalHandoffDraft): boolean => {
  const removed = removeIfUnchanged(draft.slot, draft.value);
  changed();
  return removed;
};

const occupantEntries = (occupant: DraftOccupant) => {
  const parsed = entriesSchema.safeParse(occupant.entries);
  return parsed.success ? parsed.data : [];
};

/** The server confirmed these exact entries for these patients: drop every copy of that text. */
export const confirmMedicalHandoffDrafts = (date: string, occupants: DraftOccupant[]): void => {
  const confirmed = new Map<string, string>();
  for (const occupant of occupants) {
    for (const entry of occupantEntries(occupant)) {
      confirmed.set(
        medicalHandoffDraftKey({ date, ...identityOf(occupant), entryId: entry.id }),
        entry.note
      );
    }
  }
  const removed = readMedicalHandoffDrafts().filter(
    draft => confirmed.get(draft.key) === draft.value && removeIfUnchanged(draft.slot, draft.value)
  );
  if (removed.length) changed();
};

const identityOf = (identity: SpecialistHandoffIdentity): SpecialistHandoffIdentity => ({
  documentType: identity.documentType,
  rut: identity.rut,
  patientName: identity.patientName,
  clinicalEpisodeId: identity.clinicalEpisodeId,
});

const payloadOccupants = ({ patch, expectedOccupants }: SpecialistHandoffSyncPayload) =>
  expectedOccupants.map(occupant => ({
    ...identityOf(occupant),
    entries:
      patch[
        `beds.${occupant.bedId}${occupant.target === 'clinicalCrib' ? '.clinicalCrib' : ''}.medicalHandoffEntries`
      ],
  }));

export const confirmSpecialistHandoffDrafts = (payload: SpecialistHandoffSyncPayload): void =>
  confirmMedicalHandoffDrafts(payload.date, payloadOccupants(payload));

/** Server-confirmed day record (ACK): drop copies whose exact text it now holds. */
export const confirmMedicalHandoffDraftsFromRecord = (record: DailyRecord): void =>
  confirmMedicalHandoffDrafts(
    record.date,
    Object.values(record.beds ?? {})
      .flatMap(bed => (bed?.clinicalCrib ? [bed, bed.clinicalCrib] : [bed]))
      .filter(patient => patient?.patientName?.trim())
      .map(patient => ({
        ...buildSpecialistHandoffIdentity(patient),
        entries: patient.medicalHandoffEntries,
      }))
  );

/**
 * A queued note the server refused (other occupant, closed day). Its text is published as drafts
 * only for a patient with no draft that day; the editor already kept the user's own copies.
 */
export const publishSpecialistHandoffConflict = (
  payload: SpecialistHandoffSyncPayload
): boolean => {
  const writer = createMedicalHandoffDraftWriter();
  const drafts = readMedicalHandoffDrafts();
  let durable = true;
  for (const occupant of payloadOccupants(payload)) {
    const identityKey = medicalHandoffDraftKey({ date: payload.date, ...occupant, entryId: '' });
    if (drafts.some(draft => medicalHandoffDraftKey({ ...draft, entryId: '' }) === identityKey))
      continue;
    for (const entry of occupantEntries(occupant)) {
      if (!entry.note.trim()) continue;
      durable =
        writeMedicalHandoffDraft(writer, {
          date: payload.date,
          ...identityOf(occupant),
          entryId: entry.id,
          value: entry.note,
        }) && durable;
    }
  }
  return durable;
};

/** Editors on screen; the review panel lists only the drafts none of them shows. */
export const registerMedicalHandoffEditor = (key: string) => {
  editors.set(key, (editors.get(key) ?? 0) + 1);
  changed();
  return () => {
    const count = (editors.get(key) ?? 1) - 1;
    if (count > 0) editors.set(key, count);
    else editors.delete(key);
    changed();
  };
};
export const hasMountedMedicalHandoffEditor = (key: string): boolean => editors.has(key);
