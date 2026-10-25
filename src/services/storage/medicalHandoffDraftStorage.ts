import { z } from 'zod';
import { getStoredSessionOwnerKey } from './sessionOwnerKey';

const draftSchema = z.object({
  key: z.string(),
  date: z.string(),
  patientName: z.string(),
  rut: z.string(),
  documentType: z.string(),
  clinicalEpisodeId: z.string(),
  entryId: z.string(),
  value: z.string(),
});
export type MedicalHandoffDraft = z.infer<typeof draftSchema>;
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedOwner: string | null | undefined;
let drafts: MedicalHandoffDraft[] = [];
let storageFailed = false;
// Pending clinical work is durable and owner-scoped, outside ephemeral hhr_ session keys.
const storageKey = () => {
  try {
    return `hhr.medicalHandoffDrafts.v1:${getStoredSessionOwnerKey() || 'local'}`;
  } catch {
    return 'hhr.medicalHandoffDrafts.v1:unavailable';
  }
};

export const readMedicalHandoffDrafts = (): MedicalHandoffDraft[] => {
  const owner = storageKey();
  if (cachedOwner !== owner) {
    drafts = [];
    cachedRaw = undefined;
    cachedOwner = owner;
    storageFailed = false;
  }
  try {
    const raw = localStorage.getItem(owner);
    if (cachedOwner !== owner || (raw !== cachedRaw && !storageFailed)) {
      const parsed = draftSchema.array().safeParse(raw ? JSON.parse(raw) : []);
      drafts = parsed.success ? parsed.data : [];
      cachedRaw = raw;
      cachedOwner = owner;
    }
  } catch {
    storageFailed = true;
  }
  return drafts;
};

export const subscribeMedicalHandoffDrafts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const writeMedicalHandoffDraft = (draft: MedicalHandoffDraft): boolean => {
  const current = readMedicalHandoffDrafts();
  drafts = [...current.filter(item => item.key !== draft.key), draft];
  try {
    cachedRaw = JSON.stringify(drafts);
    localStorage.setItem(storageKey(), cachedRaw);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  listeners.forEach(listener => listener());
  return !storageFailed;
};
