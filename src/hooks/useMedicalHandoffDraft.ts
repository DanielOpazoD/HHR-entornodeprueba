import { useSyncExternalStore } from 'react';
import {
  readMedicalHandoffDrafts,
  subscribeMedicalHandoffDrafts,
} from '@/services/storage/medicalHandoffDraftStorage';
export {
  createMedicalHandoffDraftWriter,
  discardMedicalHandoffDraft,
  hasMountedMedicalHandoffEditor,
  medicalHandoffDraftKey,
  registerMedicalHandoffEditor,
  writeMedicalHandoffDraft,
} from '@/services/storage/medicalHandoffDraftStorage';
export type { MedicalHandoffDraft } from '@/services/storage/medicalHandoffDraftStorage';
export {
  buildSpecialistHandoffIdentity,
  specialistHandoffIdentityKey,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';

export const useMedicalHandoffDrafts = () =>
  useSyncExternalStore(subscribeMedicalHandoffDrafts, readMedicalHandoffDrafts);
