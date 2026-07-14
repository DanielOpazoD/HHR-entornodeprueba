import type { BedType } from './base';
import type { Specialty, PatientStatus } from './patientClassification';
import type { PatientData } from './patient';
import type { ClinicalEvent } from './clinicalEvents';
import type { CudyrScore } from './cudyr';
import type { DeviceDetails, DeviceInstance } from './devices';
import type { PatientEvaluationScores } from './evaluationScores';
import type { PatientVitalSigns } from './vitalSigns';
import type { FhirResource } from './fhir';
import type { CMAData, DischargeData, TransferData } from './movements';
import type {
  MedicalHandoffBySpecialty,
  MedicalSignature,
  MedicalSignatureByScope,
  MedicalSignatureScope,
  MedicalSignatureTimestampByScope,
} from './dailyRecordMedicalHandoff';
import type { DailyRecordStaffingDetailsV1 } from './dailyRecordStaffingDetails';
import type { RayenSyncEvent, RayenSyncMeta } from './rayenSync';

type PatientFieldPath = `beds.${string}.${keyof PatientData}`;
type PatientCudyrPath = `beds.${string}.cudyr.${keyof CudyrScore}`;
type PatientClinicalCribPath = `beds.${string}.clinicalCrib.${keyof PatientData}`;
type PatientDeviceDetailsPath = `beds.${string}.deviceDetails.${string}`;

type TopLevelValueMap = {
  date: string;
  lastUpdated: string;
  nurses: string[] | undefined;
  nurseName: string | undefined;
  nursesDayShift: string[] | undefined;
  nursesNightShift: string[] | undefined;
  tensDayShift: string[] | undefined;
  tensNightShift: string[] | undefined;
  staffingDetailsV1: DailyRecordStaffingDetailsV1 | undefined;
  activeExtraBeds: string[];
  discharges: DischargeData[];
  transfers: TransferData[];
  cma: CMAData[];
  beds: Record<string, PatientData>;
  handoffNovedadesDayShift: string | undefined;
  handoffNovedadesNightShift: string | undefined;
  medicalHandoffNovedades: string | undefined;
  medicalHandoffBySpecialty: MedicalHandoffBySpecialty | undefined;
  medicalHandoffDoctor: string | undefined;
  medicalHandoffSentAt: string | undefined;
  medicalHandoffSentAtByScope: MedicalSignatureTimestampByScope | undefined;
  medicalSignatureLinkTokenByScope: Partial<Record<MedicalSignatureScope, string>> | undefined;
  medicalSignature: MedicalSignature | undefined;
  medicalSignatureByScope: MedicalSignatureByScope | undefined;
  cudyrLocked: boolean | undefined;
  cudyrLockedAt: string | undefined;
  cudyrLockedBy: string | undefined;
  cudyrUpdatedAt: string | undefined;
  bedTypeOverrides: Record<string, BedType>;
  rayenSync: RayenSyncMeta | undefined;
  rayenSyncHistory: RayenSyncEvent[] | undefined;
};

type TopLevelPath = keyof TopLevelValueMap;

type HandoffDayChecklistPath = `handoffDayChecklist.${string}`;
type HandoffNightChecklistPath = `handoffNightChecklist.${string}`;
type HandoffStaffPath =
  | `handoffDayDelivers`
  | `handoffDayReceives`
  | `handoffNightDelivers`
  | `handoffNightReceives`;
type MedicalSignaturePath =
  | `medicalSignature`
  | `medicalSignature.${string}`
  | `medicalSignatureByScope`
  | `medicalSignatureByScope.${string}`
  | `medicalSignatureByScope.${string}.${string}`
  | `medicalHandoffSentAtByScope`
  | `medicalHandoffSentAtByScope.${string}`
  | `medicalSignatureLinkTokenByScope`
  | `medicalSignatureLinkTokenByScope.${string}`;

export type DailyRecordPatchPath =
  | TopLevelPath
  | PatientFieldPath
  | PatientCudyrPath
  | PatientClinicalCribPath
  | PatientDeviceDetailsPath
  | HandoffDayChecklistPath
  | HandoffNightChecklistPath
  | HandoffStaffPath
  | MedicalSignaturePath;

export type DailyRecordPatch = {
  [K in DailyRecordPatchPath]?: K extends TopLevelPath
    ? K extends 'bedTypeOverrides'
      ? Record<string, BedType>
      : TopLevelValueMap[K]
    : K extends PatientCudyrPath
      ? number
      : K extends HandoffDayChecklistPath | HandoffNightChecklistPath
        ? boolean | string
        : K extends HandoffStaffPath
          ? string[]
          :
              | string
              | number
              | boolean
              | string[]
              | PatientData
              | CudyrScore
              | DeviceDetails
              | PatientEvaluationScores
              | PatientVitalSigns
              | PatientVitalSigns[]
              | PatientStatus
              | Specialty
              | ClinicalEvent[]
              | DeviceInstance[]
              | FhirResource
              | Record<string, unknown>
              | null
              | undefined;
} & {
  [key: string]: unknown;
};
