import type { PatientIdentityStatus } from './patientIdentity';
import type { Specialty, PatientStatus } from './patientClassification';
import type { ClinicalEvent } from './clinicalEvents';
import type { CudyrScore } from './cudyr';
import type { DeviceInstance, DeviceDetails } from './devices';
import type { PatientEvaluationScores } from './evaluationScores';
import type { PatientVitalSigns } from './vitalSigns';
import type { FhirResource } from './fhir';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

export interface MedicalHandoffAuditActor {
  uid: string;
  displayName: string;
  email: string;
  role?: string;
}

export interface MedicalHandoffAudit {
  lastSpecialistUpdateAt?: string;
  lastSpecialistUpdateBy?: MedicalHandoffAuditActor;
  lastSpecialistUpdateSpecialty?: Specialty | string;
  originalNoteAt?: string;
  originalNoteBy?: MedicalHandoffAuditActor;
  currentStatus?: 'updated_by_specialist' | 'confirmed_current';
  currentStatusDate?: string;
  currentStatusAt?: string;
  currentStatusBy?: MedicalHandoffAuditActor;
  currentStatusSpecialty?: Specialty | string;
}

export interface MedicalHandoffEntry {
  id: string;
  specialty: Specialty | string;
  note: string;
  originalNoteAt?: string;
  originalNoteBy?: MedicalHandoffAuditActor;
  updatedAt?: string;
  updatedBy?: MedicalHandoffAuditActor;
  currentStatus?: 'updated_by_specialist' | 'confirmed_current';
  currentStatusDate?: string;
  currentStatusAt?: string;
  currentStatusBy?: MedicalHandoffAuditActor;
}

export type GinecobstetriciaType = 'Obstétrica' | 'Ginecológica';
export type DeliveryRoute = 'Vaginal' | 'Cesárea';
export type CesareanLabor = 'Sin TdP' | 'Con TdP';

export interface PatientData {
  bedId: string;
  isBlocked: boolean;
  blockedReason?: string;
  bedName?: string;

  // Dynamic Furniture Configuration
  bedMode: 'Cama' | 'Cuna'; // Defines if the physical spot is set up as a Bed or a Crib (Census relevant)
  hasCompanionCrib: boolean; // Defines if there is an EXTRA crib for a healthy RN (Resource relevant)

  // Nested Patient Data for Clinical Crib (Sick Newborn sharing room with Mother)
  clinicalCrib?: PatientData;

  patientName: string;
  firstName?: string;
  lastName?: string;
  secondLastName?: string;
  identityStatus?: PatientIdentityStatus;
  rut: string;
  documentType?: 'RUT' | 'Pasaporte'; // Switcher
  age: string;
  birthDate?: string;
  biologicalSex?: 'Masculino' | 'Femenino' | 'Indeterminado';
  insurance?: 'Fonasa' | 'Isapre' | 'Particular';

  // Demographics Update
  admissionOrigin?: 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
  admissionOriginDetails?: string; // For 'Otro'
  origin?: 'Residente' | 'Turista Nacional' | 'Turista Extranjero'; // Now labeled "Condición de permanencia"

  isRapanui?: boolean;
  pathology: string;
  snomedCode?: string; // Standardized SNOMED CT code
  cie10Code?: string; // Standardized CIE-10 code
  cie10Description?: string; // Official CIE-10 description recorded at selection
  diagnosisComments?: string; // New field for sub-diagnosis details (e.g. surgical dates)
  specialty: Specialty | string;
  ginecobstetriciaType?: GinecobstetriciaType;
  /** Optional secondary specialty for co-managed patients. Not used for statistics. */
  secondarySpecialty?: Specialty | string;
  status: PatientStatus;
  admissionDate: string;
  admissionTime?: string;
  hasWristband: boolean;
  devices: string[];
  deviceDetails?: DeviceDetails; // Dates/notas for tracked devices (CUP, CVC, VMI, VVP)
  surgicalComplication: boolean;
  isUPC: boolean;
  /** Structured UPC checklist with UCI/UTI criteria and derived classification. */
  upcChecklist?: UpcChecklistRecord;
  location?: string;
  /** Optional first day the patient was observed in census; used for admission audits. */
  firstSeenDate?: string;
  /** Stable episode identifier. Optional during legacy tuple-to-ID migration. */
  clinicalEpisodeId?: string;

  // CUDYR Data
  cudyr?: CudyrScore;

  // Handoff / Nursing Evolution (Shift-based)
  handoffNote?: string; // Legacy/fallback
  handoffNoteDayShift?: string; // Turno Largo (8:00-20:00)
  handoffNoteNightShift?: string; // Turno Noche (20:00-08:00)

  // Medical Handoff
  medicalHandoffNote?: string;
  medicalHandoffAudit?: MedicalHandoffAudit;
  medicalHandoffEntries?: MedicalHandoffEntry[];

  // Clinical Events (procedures, surgeries, cultures, etc.)
  clinicalEvents?: ClinicalEvent[];

  /**
   * Detailed history of individual device instances.
   * Allows tracking multiple same-type devices (e.g., 2+ VVPs) with separate timelines.
   */
  deviceInstanceHistory?: DeviceInstance[];

  /**
   * Nursing evaluation scales (Braden UPP + Downton falls) synced from Ficha Médico.
   * Risk level / planned care / reapplication due-date are derived at display time from the total
   * and the patient's age (see `@/domain/evaluationScales/bradenRisk`).
   */
  evaluationScores?: PatientEvaluationScores;

  /** Latest vital signs (PA, FC, SatO₂, T°, FR, EVA) synced from Ficha Médico. */
  vitalSigns?: PatientVitalSigns;

  /**
   * Vital-signs history synced from Ficha Médico (most-recent-first, on or before the census day),
   * so the census can show several days of measurements. Bounded to the most recent readings.
   */
  vitalSignsHistory?: PatientVitalSigns[];

  // Obstetric delivery tracking (Ginecobstetricia only)
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string; // ISO date string
  deliveryCesareanLabor?: CesareanLabor;

  // HL7 FHIR Core-CL Resource (Optional for dual-mode sync)
  fhir_resource?: FhirResource;
}
