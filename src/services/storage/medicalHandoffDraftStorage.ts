import { z } from 'zod';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SpecialistHandoffSyncPayload } from './syncQueueTypes';
import {
  buildSpecialistHandoffIdentity,
  type SpecialistHandoffIdentity,
} from './firestore/specialistMedicalHandoffIdentity';
import { getStoredSessionOwnerKey, SESSION_OWNER_KEY } from './sessionOwnerKey';

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
/** Text typed with no session: the user last signed in on this tab when it was typed, if any. */
const heldFor = new Map<string, string | null>();
const editors = new Map<string, number>();
const listeners = new Set<() => void>();
const ownerResets = new Set<() => void>();
/** An old shared list is still waiting to be copied; another tab's storage change may allow it. */
let legacyPending = false;
let observedOwner: string | null | undefined;
let lastKnownOwner: string | null = null;
let discardedForeignDraft = false;

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

/**
 * A patient's single note is one entry: the empty-note editor writes it as `primary-note`, and a
 * stored note alone is shown and published as `legacy-primary`. They never coexist.
 */
const draftEntryId = (entryId: string) => (entryId === 'legacy-primary' ? 'primary-note' : entryId);

export const medicalHandoffDraftKey = (draft: Omit<MedicalHandoffDraftInput, 'value'>): string =>
  JSON.stringify([
    draft.date,
    draft.documentType,
    draft.rut,
    draft.patientName,
    draft.clinicalEpisodeId,
    draftEntryId(draft.entryId),
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

/**
 * Nothing typed under one identity survives in memory into another one or past a logout. Text
 * typed with no session goes back only to the user last signed in on this tab; anyone else gets
 * a notice without patient data, never the text.
 */
const syncOwner = (): string | null => {
  const owner = currentOwner();
  if (observedOwner !== undefined && owner !== observedOwner) {
    discardedForeignDraft = false;
    for (const [slot, draft] of [...pending]) {
      const ownerless = slot.startsWith(ownerPrefix(null));
      if (ownerless && !owner) continue;
      const held = heldFor.get(slot);
      pending.delete(slot);
      heldFor.delete(slot);
      if (!ownerless) continue;
      if (!owner || held !== owner) {
        discardedForeignDraft = true;
        continue;
      }
      const target = ownerPrefix(owner) + slot.slice(ownerPrefix(null).length);
      if (!persist(owner, target, draft)) pending.set(target, { ...draft, slot: target });
    }
    ownerResets.forEach(reset => reset());
    version += 1;
  }
  observedOwner = owner;
  if (owner) lastKnownOwner = owner;
  return owner;
};

/** The signed-in owner, after applying any change since the last call. */
export const getMedicalHandoffDraftOwner: () => string | null = syncOwner;
export const hasDiscardedForeignMedicalHandoffDraft = (): boolean => discardedForeignDraft;
/** Editors drop their in-memory sessions whenever the signed-in owner changes. */
export const registerMedicalHandoffOwnerReset = (reset: () => void) => {
  ownerResets.add(reset);
};

/** Retry this owner's copies that could not be written yet. */
const flushPending = (owner: string | null) => {
  if (!owner) return;
  for (const [slot, draft] of [...pending]) {
    if (slot.startsWith(ownerPrefix(owner)) && persist(owner, slot, draft)) pending.delete(slot);
  }
};

/**
 * Copies the old shared list into one slot per draft, on every read until it is gone. The list is
 * removed only while it still holds exactly what was copied. A list another tab saved meanwhile
 * stays, and that tab's storage change copies it again, as does any later read; a failed copy
 * leaves everything in place. Subscribers hear of the copy after the read, never during a render.
 */
const migrateLegacyDrafts = (owner: string) => {
  const legacyKey = LEGACY_PREFIX + owner;
  legacyPending = false;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) return;
    for (const draft of draftSchema.array().parse(JSON.parse(raw)))
      localStorage.setItem(
        `${ownerPrefix(owner)}v1:${medicalHandoffDraftKey(draft)}`,
        JSON.stringify(draft)
      );
    if (localStorage.getItem(legacyKey) === raw) {
      localStorage.removeItem(legacyKey);
      version += 1;
      return queueMicrotask(changed);
    }
  } catch {
    // Nothing is deleted on a failed copy; the old list stays where it is.
  }
  legacyPending = true;
};

export const readMedicalHandoffDrafts = (): MedicalHandoffDraft[] => {
  const owner = syncOwner();
  if (owner) migrateLegacyDrafts(owner);
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
    if (!event.key || event.key.startsWith(PREFIX) || event.key === SESSION_OWNER_KEY)
      return changed();
    // Another tab may have freed the space old drafts were waiting for, or saved a newer list.
    if (legacyPending) readMedicalHandoffDrafts();
  });
}

/** Returns whether this copy is durable; a failed copy stays in memory and is retried. */
export const writeMedicalHandoffDraft = (
  writer: string,
  draft: MedicalHandoffDraftInput
): boolean => {
  const owner = syncOwner();
  const key = medicalHandoffDraftKey(draft);
  const slot = `${ownerPrefix(owner)}${writer}:${key}`;
  const durable = persist(owner, slot, draft);
  if (durable) pending.delete(slot);
  else pending.set(slot, { ...draft, key, slot, durable: false });
  if (!owner) heldFor.set(slot, lastKnownOwner);
  flushPending(owner);
  changed();
  return durable;
};

/** A slot has one writer, so a pending copy is newer than whatever that slot holds on disk. */
const removeIfUnchanged = (slot: string, value: string): boolean => {
  const newest = pending.get(slot) ?? parseSlot(slot);
  if (newest?.value !== value) return false;
  pending.delete(slot);
  heldFor.delete(slot);
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

/** Drafts carry the editor's entry id: the entry ids, or `legacy-primary` for a note alone. */
const payloadOccupants = ({ patch, expectedOccupants }: SpecialistHandoffSyncPayload) =>
  expectedOccupants.map(occupant => {
    const path = `beds.${occupant.bedId}${occupant.target === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
    const note = patch[`${path}.medicalHandoffNote`];
    return {
      ...identityOf(occupant),
      entries:
        patch[`${path}.medicalHandoffEntries`] ??
        (typeof note === 'string' ? [{ id: 'legacy-primary', note }] : undefined),
    };
  });

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

/** Test helper: forget this page's in-memory drafts and sessions, as a reload would. */
export const resetMedicalHandoffDraftMemoryForTests = (): void => {
  pending.clear();
  heldFor.clear();
  editors.clear();
  legacyPending = false;
  observedOwner = undefined;
  lastKnownOwner = null;
  discardedForeignDraft = false;
  ownerResets.forEach(reset => reset());
  changed();
};
