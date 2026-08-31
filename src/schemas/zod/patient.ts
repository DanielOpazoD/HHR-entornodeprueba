import { z } from 'zod';
import { BedType } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  emptyStringToUndefined,
  nullableOptional,
  nullishDefault,
  resolveLegacyNameParts,
} from './helpers';

export const BedTypeSchema = z.nativeEnum(BedType) as z.ZodType<BedType>;
export const PatientStatusSchema = z.nativeEnum(PatientStatus);

const SpecialtyEnumSchema = z.nativeEnum(Specialty);
const SpecialtyValueSchema = z.union([
  SpecialtyEnumSchema,
  z.string().transform(value => value.trim()),
]);
export const SpecialtySchema = z.preprocess(val => {
  // Migrate legacy values to the new combined specialty
  if (val === 'Ginecología' || val === 'Obstetricia') {
    return Specialty.GINECOBSTETRICIA;
  }
  return val;
}, SpecialtyValueSchema);

export const CudyrScoreSchema = z.object({
  changeClothes: z.number().min(0).max(4).catch(0),
  mobilization: z.number().min(0).max(4).catch(0),
  feeding: z.number().min(0).max(4).catch(0),
  elimination: z.number().min(0).max(4).catch(0),
  psychosocial: z.number().min(0).max(4).catch(0),
  surveillance: z.number().min(0).max(4).catch(0),
  vitalSigns: z.number().min(0).max(4).catch(0),
  fluidBalance: z.number().min(0).max(4).catch(0),
  oxygenTherapy: z.number().min(0).max(4).catch(0),
  airway: z.number().min(0).max(4).catch(0),
  proInterventions: z.number().min(0).max(4).catch(0),
  skinCare: z.number().min(0).max(4).catch(0),
  pharmacology: z.number().min(0).max(4).catch(0),
  invasiveElements: z.number().min(0).max(4).catch(0),
});

export const DeviceInfoSchema = z.object({
  installationDate: nullableOptional(z.string()),
  removalDate: nullableOptional(z.string()),
  note: nullableOptional(z.string()),
});

export const DeviceDetailsSchema = z.preprocess(
  val => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
    const record: Record<string, unknown> = { ...(val as Record<string, unknown>) };
    Object.keys(record).forEach(key => {
      if (record[key] === null || record[key] === undefined) delete record[key];
    });
    return record;
  },
  z
    .object({
      CUP: nullableOptional(DeviceInfoSchema),
      CVC: nullableOptional(DeviceInfoSchema),
      VMI: nullableOptional(DeviceInfoSchema),
      'VVP#1': nullableOptional(DeviceInfoSchema),
      'VVP#2': nullableOptional(DeviceInfoSchema),
      'VVP#3': nullableOptional(DeviceInfoSchema),
    })
    .catchall(DeviceInfoSchema)
);

export const ClinicalEventSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    date: z.string(),
    note: nullableOptional(z.string()),
    createdAt: z.string(),
  })
  .passthrough();

export const FhirResourceSchema = z
  .object({
    resourceType: z.string(),
    id: nullableOptional(z.string()),
    meta: nullableOptional(
      z.object({
        profile: nullableOptional(z.array(z.string())),
      })
    ),
  })
  .passthrough();

const MedicalHandoffAuditActorSchema = z.object({
  uid: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: nullableOptional(z.string()),
});

const MedicalHandoffAuditSchema = z.object({
  lastSpecialistUpdateAt: nullableOptional(z.string()),
  lastSpecialistUpdateBy: nullableOptional(MedicalHandoffAuditActorSchema),
  lastSpecialistUpdateSpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
  originalNoteAt: nullableOptional(z.string()),
  originalNoteBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatus: z.enum(['updated_by_specialist', 'confirmed_current']).optional(),
  currentStatusDate: nullableOptional(z.string()),
  currentStatusAt: nullableOptional(z.string()),
  currentStatusBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatusSpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
});

const MedicalHandoffEntrySchema = z.object({
  id: z.string(),
  specialty: z.union([z.nativeEnum(Specialty), z.string()]),
  note: z.string().default(''),
  originalNoteAt: nullableOptional(z.string()),
  originalNoteBy: nullableOptional(MedicalHandoffAuditActorSchema),
  updatedAt: nullableOptional(z.string()),
  updatedBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatus: z.enum(['updated_by_specialist', 'confirmed_current']).optional(),
  currentStatusDate: nullableOptional(z.string()),
  currentStatusAt: nullableOptional(z.string()),
  currentStatusBy: nullableOptional(MedicalHandoffAuditActorSchema),
});

const ClinicalSyncFactCheckpointSchema = z.object({
  identity: z.string(),
  fingerprint: z.string(),
  watermark: nullableOptional(z.string()),
});

const ClinicalSyncSourceCheckpointSchema = z.object({
  watermark: nullableOptional(z.string()),
  lastFullValidationAt: nullableOptional(z.string()),
  lastFullValidationLookbackDays: nullableOptional(z.number().int().positive()),
  lastFullValidationAttemptAt: nullableOptional(z.string()),
  lastFullValidationAttemptLookbackDays: nullableOptional(z.number().int().positive()),
  packedFacts: z.array(z.string()).optional(),
  facts: z.array(ClinicalSyncFactCheckpointSchema).optional(),
});

const ClinicalSyncCheckpointSchema = z.object({
  version: z.number().int(),
  fingerprintVersion: z.number().int(),
  sources: z
    .object({
      vitals: nullableOptional(ClinicalSyncSourceCheckpointSchema),
      scales: nullableOptional(ClinicalSyncSourceCheckpointSchema),
      staffing: nullableOptional(ClinicalSyncSourceCheckpointSchema),
    })
    .default({}),
});

import { PatientData } from '@/types/domain/patient';

export const PatientDataSchema: z.ZodType<PatientData, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      bedId: z.string().default(''),
      isBlocked: z.boolean().default(false),
      blockedReason: nullableOptional(z.string()),
      bedMode: z.enum(['Cama', 'Cuna']).default('Cama'),
      hasCompanionCrib: z.boolean().default(false),
      clinicalCrib: z
        .lazy(() => PatientDataSchema)
        .nullable()
        .optional()
        .transform(v => v ?? undefined),
      patientName: z.string().default(''),
      firstName: z.string().default(''),
      lastName: z.string().default(''),
      secondLastName: z.string().default(''),
      identityStatus: nullableOptional(z.enum(['provisional', 'official'])),
      rut: z.string().default(''),
      documentType: nullableOptional(emptyStringToUndefined(z.enum(['RUT', 'Pasaporte']))),
      age: z.string().default(''),
      birthDate: nullableOptional(z.string()),
      biologicalSex: nullableOptional(
        emptyStringToUndefined(z.enum(['Masculino', 'Femenino', 'Indeterminado']))
      ),
      insurance: nullableOptional(
        emptyStringToUndefined(z.enum(['Fonasa', 'Isapre', 'Particular']))
      ),
      admissionOrigin: nullableOptional(
        emptyStringToUndefined(z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro']))
      ),
      admissionOriginDetails: nullableOptional(z.string()),
      origin: nullableOptional(
        emptyStringToUndefined(z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero']))
      ),
      isRapanui: nullableOptional(z.boolean()),
      pathology: z.string().default(''),
      snomedCode: nullableOptional(z.string()),
      cie10Code: nullableOptional(z.string()),
      cie10Description: nullableOptional(z.string()),
      diagnosisComments: nullableOptional(z.string()),
      treatingPhysicianId: nullableOptional(z.string()),
      treatingPhysicianName: nullableOptional(z.string()),
      specialty: SpecialtySchema.default(Specialty.EMPTY),
      ginecobstetriciaType: nullableOptional(
        emptyStringToUndefined(z.enum(['Obstétrica', 'Ginecológica']))
      ),
      secondarySpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
      status: z.nativeEnum(PatientStatus).default(PatientStatus.EMPTY),
      admissionDate: z.string().default(''),
      admissionTime: z.string().default(''),
      clinicalEpisodeId: nullableOptional(z.string()),
      eloisaManualImportAudit: nullableOptional(
        z.object({
          method: z.literal('eloisa_manual_code'),
          importedBy: z.string(),
          importedAt: z.string(),
          capturedAt: z.string(),
          formatVersion: z.union([z.literal(1), z.literal(2)]),
          encounterId: z.string(),
          encounterRoute: z.enum(['medical', 'nurse']).optional(),
          integrity: z.literal('sha256_checksum'),
          sourceTrust: z.literal('user_confirmed_unverified'),
        })
      ),
      hasWristband: z.boolean().default(true),
      devices: nullishDefault(z.array(z.string()), () => []),
      deviceDetails: nullableOptional(DeviceDetailsSchema),
      surgicalComplication: z.boolean().default(false),
      isUPC: z.boolean().default(false),
      isIsolated: nullableOptional(z.boolean()),
      isolationType: nullableOptional(z.string()),
      isolationMicroorganism: nullableOptional(z.string()),
      location: nullableOptional(z.string()),
      cudyr: nullableOptional(CudyrScoreSchema),
      handoffNote: nullableOptional(z.string()),
      handoffNoteDayShift: nullableOptional(z.string()),
      handoffNoteNightShift: nullableOptional(z.string()),
      medicalHandoffNote: nullableOptional(z.string()),
      medicalHandoffAudit: nullableOptional(MedicalHandoffAuditSchema),
      medicalHandoffEntries: nullableOptional(z.array(MedicalHandoffEntrySchema)),
      deliveryRoute: nullableOptional(emptyStringToUndefined(z.enum(['Vaginal', 'Cesárea']))),
      deliveryDate: nullableOptional(z.string()),
      deliveryCesareanLabor: nullableOptional(
        emptyStringToUndefined(z.enum(['Sin TdP', 'Con TdP']))
      ),
      clinicalEvents: nullishDefault(z.array(ClinicalEventSchema), () => []),
      fhir_resource: nullableOptional(FhirResourceSchema),
      clinicalSyncCheckpoint: nullableOptional(ClinicalSyncCheckpointSchema),
    })
    .passthrough()
    .transform(patient => {
      const inferredIdentityStatus =
        patient.identityStatus ??
        (patient.bedMode === 'Cuna' && !patient.rut?.trim() ? 'provisional' : 'official');

      const hasNameParts = Boolean(
        patient.firstName?.trim() || patient.lastName?.trim() || patient.secondLastName?.trim()
      );

      if (hasNameParts || !patient.patientName?.trim()) {
        return {
          ...patient,
          identityStatus: inferredIdentityStatus,
        };
      }

      return {
        ...patient,
        identityStatus: inferredIdentityStatus,
        ...resolveLegacyNameParts(patient.patientName),
      };
    })
);
