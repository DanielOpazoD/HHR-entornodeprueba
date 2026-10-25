import { useSyncExternalStore } from 'react';
import {
  readMedicalHandoffDrafts,
  subscribeMedicalHandoffDrafts,
} from '@/services/storage/medicalHandoffDraftStorage';
export { writeMedicalHandoffDraft } from '@/services/storage/medicalHandoffDraftStorage';
export type { MedicalHandoffDraft } from '@/services/storage/medicalHandoffDraftStorage';
export const useMedicalHandoffDrafts = () =>
  useSyncExternalStore(subscribeMedicalHandoffDrafts, readMedicalHandoffDrafts);
