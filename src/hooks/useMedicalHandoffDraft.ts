import { useSyncExternalStore } from 'react';
import {
  readMedicalHandoffDrafts,
  subscribeMedicalHandoffDrafts,
} from '@/services/storage/medicalHandoffDraftStorage';
export {
  writeMedicalHandoffDraft,
  deleteMedicalHandoffDraft,
  medicalHandoffDraftKey,
} from '@/services/storage/medicalHandoffDraftStorage';
export type { MedicalHandoffDraft } from '@/services/storage/medicalHandoffDraftStorage';
export const useMedicalHandoffDrafts = () =>
  useSyncExternalStore(subscribeMedicalHandoffDrafts, readMedicalHandoffDrafts);

const restorers = new Map<string, () => void>();
export const registerMedicalHandoffDraftRestore = (key: string, restore: () => void) => {
  restorers.set(key, restore);
  return () => {
    if (restorers.get(key) === restore) restorers.delete(key);
  };
};
export const restoreMedicalHandoffDraft = (key: string): boolean => {
  const restore = restorers.get(key);
  restore?.();
  return Boolean(restore);
};
