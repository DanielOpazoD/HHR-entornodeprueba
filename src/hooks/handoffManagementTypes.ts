import type {
  MedicalHandoffActor,
  MedicalSpecialty,
} from '@/application/shared/dailyRecordMedicalContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export interface ConfirmMedicalSpecialtyNoChangesInput {
  specialty: MedicalSpecialty;
  actor: Partial<MedicalHandoffActor>;
  comment?: string;
  dateKey?: string;
}

export interface HandoffManagementActions {
  updateHandoffChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
  updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
  updateMedicalSpecialtyNote: (
    specialty: MedicalSpecialty,
    value: string,
    actor: Partial<MedicalHandoffActor>
  ) => Promise<void>;
  confirmMedicalSpecialtyNoChanges: (input: ConfirmMedicalSpecialtyNoChangesInput) => Promise<void>;
  updateHandoffStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    staffList: string[]
  ) => void;
  updateMedicalSignature: (doctorName: string, scope?: MedicalHandoffScope) => Promise<void>;
  updateMedicalHandoffDoctor: (doctorName: string) => Promise<void>;
  markMedicalHandoffAsSent: (doctorName?: string, scope?: MedicalHandoffScope) => Promise<void>;
  ensureMedicalHandoffSignatureLink: (
    scope?: MedicalHandoffScope
  ) => Promise<ApplicationOutcome<{ handoffUrl: string } | null>>;
  resetMedicalHandoffState: () => Promise<void>;
  sendMedicalHandoff: (templateContent: string, targetGroupId: string) => Promise<void>;
}
