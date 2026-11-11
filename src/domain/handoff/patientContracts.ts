import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import type { MedicalHandoffAudit, MedicalHandoffEntry, PatientData } from '@/types/domain/patient';

import type { DeviceDetails } from '@/types/domain/devices';

import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

export { PatientStatus, Specialty };

export interface HandoffPatientContract {
  bedId: string;
  isBlocked: boolean;
  blockedReason?: string;
  bedMode: PatientData['bedMode'];
  hasCompanionCrib: boolean;
  clinicalCrib?: HandoffPatientContract;
  patientName: string;
  rut: string;
  age: string;
  birthDate?: string;
  pathology: string;
  treatingPhysicianId?: PatientData['treatingPhysicianId'];
  treatingPhysicianName?: string;
  specialty: PatientData['specialty'];
  secondarySpecialty?: PatientData['secondarySpecialty'];
  status: PatientStatus;
  admissionDate: string;
  admissionTime?: string;
  clinicalEpisodeId?: string;
  hasWristband: boolean;
  devices: string[];
  deviceDetails?: DeviceDetails;
  surgicalComplication: boolean;
  isUPC: boolean;
  upcChecklist?: PatientData['upcChecklist'];
  handoffNote?: string;
  handoffNoteDayShift?: string;
  handoffNoteNightShift?: string;
  medicalHandoffNote?: string;
  medicalHandoffAudit?: MedicalHandoffAudit;
  medicalHandoffEntries?: MedicalHandoffEntry[];
  clinicalEvents?: ClinicalEvent[];
}
