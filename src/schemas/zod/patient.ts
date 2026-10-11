import { z } from 'zod';
import { UpcChecklistSchema } from './upc';
import { BedType } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  emptyStringToUndefined,
  nullableOptional,
  nullishDefault,
  resolveLegacyNameParts,
} from './helpers';

// Zod schemas are immutable; reuse these identical field validators across the patient contract.
const OptionalStringSchema = z.string().optional();
const NullableOptionalStringSchema = nullableOptional(z.string());

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
  installationDate: NullableOptionalStringSchema,
  removalDate: NullableOptionalStringSchema,
  note: NullableOptionalStringSchema,
});

/**
 * Cierre clínico verificado en Eloísa mientras la cama sigue ocupada. `confirmed` en el alta médica
 * o en la de enfermería habilita el recordatorio de egreso pendiente en Gestión de Camas.
 */
const dischargeVerificationStateSchema = z
  .enum(['confirmed', 'not-detected', 'unknown'])
  .catch('unknown');

export const DischargeVerificationSchema = z.object({
  medicalEpicrisis: dischargeVerificationStateSchema,
  nursingEpicrisis: dischargeVerificationStateSchema,
  encounterId: NullableOptionalStringSchema,
  registeredAt: NullableOptionalStringSchema,
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
    note: NullableOptionalStringSchema,
    createdAt: z.string(),
  })
  .passthrough();

export const FhirResourceSchema = z
  .object({
    resourceType: z.string(),
    id: NullableOptionalStringSchema,
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
  role: NullableOptionalStringSchema,
});

const MedicalHandoffAuditSchema = z.object({
  lastSpecialistUpdateAt: NullableOptionalStringSchema,
  lastSpecialistUpdateBy: nullableOptional(MedicalHandoffAuditActorSchema),
  lastSpecialistUpdateSpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
  originalNoteAt: NullableOptionalStringSchema,
  originalNoteBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatus: z.enum(['updated_by_specialist', 'confirmed_current']).optional(),
  currentStatusDate: NullableOptionalStringSchema,
  currentStatusAt: NullableOptionalStringSchema,
  currentStatusBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatusSpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
});

const MedicalHandoffEntrySchema = z.object({
  id: z.string(),
  specialty: z.union([z.nativeEnum(Specialty), z.string()]),
  note: z.string().default(''),
  originalNoteAt: NullableOptionalStringSchema,
  originalNoteBy: nullableOptional(MedicalHandoffAuditActorSchema),
  updatedAt: NullableOptionalStringSchema,
  updatedBy: nullableOptional(MedicalHandoffAuditActorSchema),
  currentStatus: z.enum(['updated_by_specialist', 'confirmed_current']).optional(),
  currentStatusDate: NullableOptionalStringSchema,
  currentStatusAt: NullableOptionalStringSchema,
  currentStatusBy: nullableOptional(MedicalHandoffAuditActorSchema),
});

const ClinicalSyncFactCheckpointSchema = z.object({
  identity: z.string(),
  fingerprint: z.string(),
  watermark: NullableOptionalStringSchema,
});

const ClinicalSyncSourceCheckpointSchema = z.object({
  watermark: NullableOptionalStringSchema,
  lastFullValidationAt: NullableOptionalStringSchema,
  lastFullValidationLookbackDays: nullableOptional(z.number().int().positive()),
  lastFullValidationAttemptAt: NullableOptionalStringSchema,
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
      blockedReason: NullableOptionalStringSchema,
      bedMode: z.enum(['Cama', 'Cuna']).default('Cama'),
      neonatalMaternalRut: NullableOptionalStringSchema.catch(undefined),
      neonatalPlacementDecision: nullableOptional(
        z.object({
          clinicalEpisodeId: z.string().min(1),
          kind: z.enum(['mother', 'independent']),
          bedId: z.string().min(1),
          parentEpisodeId: OptionalStringSchema,
          effectiveAt: z.string().datetime({ offset: true }),
          reviewedAt: z.string().datetime({ offset: true }),
          reviewedBy: z.string(),
          sourcePlacementKey: OptionalStringSchema,
          sourceService: OptionalStringSchema,
          sourceRun: OptionalStringSchema,
          sourceRunIsMaternal: z.boolean().optional(),
          maternalRut: OptionalStringSchema,
        })
      ).catch(undefined),
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
      birthDate: NullableOptionalStringSchema,
      biologicalSex: nullableOptional(
        emptyStringToUndefined(z.enum(['Masculino', 'Femenino', 'Indeterminado']))
      ),
      insurance: nullableOptional(
        emptyStringToUndefined(z.enum(['Fonasa', 'Isapre', 'Particular']))
      ),
      admissionOrigin: nullableOptional(
        emptyStringToUndefined(z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro']))
      ),
      admissionOriginDetails: NullableOptionalStringSchema,
      origin: nullableOptional(
        emptyStringToUndefined(z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero']))
      ),
      isRapanui: nullableOptional(z.boolean()),
      pathology: z.string().default(''),
      snomedCode: NullableOptionalStringSchema,
      cie10Code: NullableOptionalStringSchema,
      cie10Description: NullableOptionalStringSchema,
      diagnosisComments: NullableOptionalStringSchema,
      treatingPhysicianId: NullableOptionalStringSchema,
      treatingPhysicianName: NullableOptionalStringSchema,
      dismissedTreatingPhysician: nullableOptional(
        z.object({
          episodeId: z.string().min(1),
          practitionerId: NullableOptionalStringSchema,
          name: NullableOptionalStringSchema,
          displayName: NullableOptionalStringSchema,
        })
      ),
      specialty: SpecialtySchema.default(Specialty.EMPTY),
      specialtyAssignment: nullableOptional(
        z.object({
          schemaVersion: z.literal(3),
          episodeId: z.string(),
          decisionId: z.string(),
          recordDate: z.string(),
          source: z.enum(['manual', 'rule', 'manual_ai']),
          actorUid: z.string(),
          decidedAt: z.string(),
          rule: nullableOptional(
            z.object({
              id: z.string(),
              revision: z.number(),
              catalogRevision: z.number(),
            })
          ),
          ai: nullableOptional(
            z.object({
              requestId: z.string(),
              model: z.string(),
              promptVersion: z.string(),
            })
          ),
        })
      ),
      ginecobstetriciaType: nullableOptional(
        emptyStringToUndefined(z.enum(['Obstétrica', 'Ginecológica']))
      ),
      secondarySpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
      status: z.nativeEnum(PatientStatus).default(PatientStatus.EMPTY),
      admissionDate: z.string().default(''),
      admissionTime: z.string().default(''),
      clinicalEpisodeId: NullableOptionalStringSchema,
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
      upcChecklist: nullableOptional(UpcChecklistSchema).catch(undefined),
      isIsolated: nullableOptional(z.boolean()),
      isolationType: NullableOptionalStringSchema,
      isolationMicroorganism: NullableOptionalStringSchema,
      dischargeVerification: nullableOptional(DischargeVerificationSchema).catch(undefined),
      location: NullableOptionalStringSchema,
      cudyr: nullableOptional(CudyrScoreSchema),
      handoffNote: NullableOptionalStringSchema,
      handoffNoteDayShift: NullableOptionalStringSchema,
      handoffNoteNightShift: NullableOptionalStringSchema,
      medicalHandoffNote: NullableOptionalStringSchema,
      medicalHandoffAudit: nullableOptional(MedicalHandoffAuditSchema),
      medicalHandoffEntries: nullableOptional(z.array(MedicalHandoffEntrySchema)),
      deliveryRoute: nullableOptional(emptyStringToUndefined(z.enum(['Vaginal', 'Cesárea']))),
      deliveryDate: NullableOptionalStringSchema,
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
