import type { SyncTask } from './syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
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
const storageKey = (): string | null => {
  try {
    const owner = getStoredSessionOwnerKey();
    return owner?.startsWith('user:') ? `hhr.medicalHandoffDrafts.v1:${owner}` : null;
  } catch {
    return null;
  }
};

export const medicalHandoffDraftKey = (
  draft: Pick<MedicalHandoffDraft, 'documentType' | 'rut' | 'clinicalEpisodeId' | 'entryId'>
): string =>
  JSON.stringify([draft.documentType, draft.rut, draft.clinicalEpisodeId, draft.entryId]);

export const readMedicalHandoffDrafts = (): MedicalHandoffDraft[] => {
  const owner = storageKey();
  if (cachedOwner !== owner) {
    drafts = [];
    cachedRaw = undefined;
    cachedOwner = owner;
    storageFailed = false;
  }
  if (!owner) return drafts;
  try {
    const raw = localStorage.getItem(owner);
    if (raw !== cachedRaw && !storageFailed) {
      const parsed = draftSchema.array().safeParse(raw ? JSON.parse(raw) : []);
      drafts = parsed.success
        ? [
            ...new Map(
              parsed.data.map(draft => {
                const key = medicalHandoffDraftKey(draft);
                return [key, { ...draft, key }] as const;
              })
            ).values(),
          ]
        : [];
      cachedRaw = raw;
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
const persist = (): boolean => {
  const owner = storageKey();
  try {
    if (!owner) throw new Error('No authenticated draft owner');
    cachedRaw = JSON.stringify(drafts);
    if (drafts.length) localStorage.setItem(owner, cachedRaw);
    else localStorage.removeItem(owner);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  listeners.forEach(listener => listener());
  return !storageFailed;
};
export const writeMedicalHandoffDraft = (draft: MedicalHandoffDraft): boolean => {
  const current = readMedicalHandoffDrafts();
  const key = medicalHandoffDraftKey(draft);
  drafts = [...current.filter(item => item.key !== key), { ...draft, key }];
  return persist();
};
export const deleteMedicalHandoffDraft = (key: string, confirmedValue?: string): void => {
  const current = readMedicalHandoffDrafts();
  const next = current.filter(
    item => item.key !== key || (confirmedValue !== undefined && item.value !== confirmedValue)
  );
  if (next.length === current.length) return;
  drafts = next;
  persist();
};

export const preserveQueuedMedicalHandoffDrafts = (task: SyncTask): void => {
  const record = task.payload as DailyRecord;
  for (const path of task.syncContract?.changedPaths || []) {
    if (!/^beds\.[^.]+\.(?:clinicalCrib\.)?medicalHandoff(?:Note|Entries)$/.test(path)) continue;
    const [, bedId, field] = path.split('.');
    const bed = record.beds[bedId];
    const patient = field === 'clinicalCrib' ? bed?.clinicalCrib : bed;
    if (!patient) continue;
    const entries = path.endsWith('medicalHandoffEntries')
      ? (patient.medicalHandoffEntries || []).map(entry => ({
          entryId: entry.id,
          value: entry.note,
        }))
      : [{ entryId: 'primary-note', value: patient.medicalHandoffNote || '' }];
    for (const entry of entries) {
      const draft = {
        ...entry,
        key: '',
        date: record.date,
        patientName: patient.patientName,
        rut: patient.rut,
        documentType: patient.documentType || 'RUT',
        clinicalEpisodeId: patient.clinicalEpisodeId || buildLegacyClinicalEpisodeId(patient) || '',
      };
      if (!readMedicalHandoffDrafts().some(item => item.key === medicalHandoffDraftKey(draft)))
        writeMedicalHandoffDraft(draft);
    }
  }
};
