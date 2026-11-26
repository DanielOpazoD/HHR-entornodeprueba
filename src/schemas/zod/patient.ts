import * as z from 'zod/mini';
import { UpcChecklistSchema } from './upc';
import { BedType } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  emptyStringToUndefined,
  nullableOptional,
  nullishDefault,
  preprocess,
  resolveLegacyNameParts,
  StringSchema,
  OptionalStringSchema,
  NullableOptionalStringSchema,
  DefaultEmptyStringSchema,
} from './helpers';

const DefaultFalseSchema = z.prefault(z.boolean(), false);
const CudyrItemSchema = z.catch(z.number().check(z.minimum(0), z.maximum(4)), 0);

export const BedTypeSchema = z.nativeEnum(BedType) as z.ZodMiniType<BedType>;

const SpecialtyEnumSchema = z.nativeEnum(Specialty);
const SpecialtyValueSchema = z.union([
  SpecialtyEnumSchema,
  z.pipe(
    StringSchema,
    z.transform(value => value.trim())
  ),
]);
const RawSpecialtySchema = z.union([SpecialtyEnumSchema, StringSchema]);
const OptionalRawSpecialtySchema = nullableOptional(RawSpecialtySchema);
export const SpecialtySchema = preprocess(val => {
  // Migrate legacy values to the new combined specialty
  if (val === 'Ginecología' || val === 'Obstetricia') {
    return Specialty.GINECOBSTETRICIA;
  }
  return val;
}, SpecialtyValueSchema);

export const CudyrScoreSchema = z.object({
  changeClothes: CudyrItemSchema,
  mobilization: CudyrItemSchema,
  feeding: CudyrItemSchema,
  elimination: CudyrItemSchema,
  psychosocial: CudyrItemSchema,
  surveillance: CudyrItemSchema,
  vitalSigns: CudyrItemSchema,
  fluidBalance: CudyrItemSchema,
  oxygenTherapy: CudyrItemSchema,
  airway: CudyrItemSchema,
  proInterventions: CudyrItemSchema,
  skinCare: CudyrItemSchema,
  pharmacology: CudyrItemSchema,
  invasiveElements: CudyrItemSchema,
});

export const DeviceInfoSchema = z.object({
  installationDate: NullableOptionalStringSchema,
  removalDate: NullableOptionalStringSchema,
  note: NullableOptionalStringSchema,
});

const OptionalDeviceInfoSchema = nullableOptional(DeviceInfoSchema);

/**
 * Cierre clínico verificado en Eloísa mientras la cama sigue ocupada. `confirmed` en el alta médica
 * o en la de enfermería habilita el recordatorio de egreso pendiente en Gestión de Camas.
 */
const dischargeVerificationStateSchema = z.catch(
  z.enum(['confirmed', 'not-detected', 'unknown']),
  'unknown'
);

export const DischargeVerificationSchema = z.object({
  medicalEpicrisis: dischargeVerificationStateSchema,
  nursingEpicrisis: dischargeVerificationStateSchema,
  encounterId: NullableOptionalStringSchema,
  registeredAt: NullableOptionalStringSchema,
});

export const DeviceDetailsSchema = preprocess(
  val => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
    const record: Record<string, unknown> = { ...(val as Record<string, unknown>) };
    Object.keys(record).forEach(key => {
      if (record[key] === null || record[key] === undefined) delete record[key];
    });
    return record;
  },
  z.catchall(
    z.object({
      CUP: OptionalDeviceInfoSchema,
      CVC: OptionalDeviceInfoSchema,
      VMI: OptionalDeviceInfoSchema,
      'VVP#1': OptionalDeviceInfoSchema,
      'VVP#2': OptionalDeviceInfoSchema,
      'VVP#3': OptionalDeviceInfoSchema,
    }),
    DeviceInfoSchema
  )
);

export const ClinicalEventSchema = z.looseObject({
  id: StringSchema,
  name: StringSchema,
  date: StringSchema,
  note: NullableOptionalStringSchema,
  createdAt: StringSchema,
});

export const FhirResourceSchema = z.looseObject({
  resourceType: StringSchema,
  id: NullableOptionalStringSchema,
  meta: nullableOptional(
    z.object({
      profile: nullableOptional(z.array(StringSchema)),
    })
  ),
});

const MedicalHandoffAuditActorSchema = z.object({
  uid: StringSchema,
  displayName: StringSchema,
  email: StringSchema,
  role: NullableOptionalStringSchema,
});

const OptionalMedicalHandoffAuditActorSchema = nullableOptional(MedicalHandoffAuditActorSchema);

const MedicalHandoffAuditSchema = z.object({
  lastSpecialistUpdateAt: NullableOptionalStringSchema,
  lastSpecialistUpdateBy: OptionalMedicalHandoffAuditActorSchema,
  lastSpecialistUpdateSpecialty: OptionalRawSpecialtySchema,
  originalNoteAt: NullableOptionalStringSchema,
  originalNoteBy: OptionalMedicalHandoffAuditActorSchema,
  currentStatus: z.optional(z.enum(['updated_by_specialist', 'confirmed_current'])),
  currentStatusDate: NullableOptionalStringSchema,
  currentStatusAt: NullableOptionalStringSchema,
  currentStatusBy: OptionalMedicalHandoffAuditActorSchema,
  currentStatusSpecialty: OptionalRawSpecialtySchema,
});

const MedicalHandoffEntrySchema = z.object({
  id: StringSchema,
  specialty: RawSpecialtySchema,
  note: DefaultEmptyStringSchema,
  originalNoteAt: NullableOptionalStringSchema,
  originalNoteBy: OptionalMedicalHandoffAuditActorSchema,
  updatedAt: NullableOptionalStringSchema,
  updatedBy: OptionalMedicalHandoffAuditActorSchema,
  currentStatus: z.optional(z.enum(['updated_by_specialist', 'confirmed_current'])),
  currentStatusDate: NullableOptionalStringSchema,
  currentStatusAt: NullableOptionalStringSchema,
  currentStatusBy: OptionalMedicalHandoffAuditActorSchema,
});

const ClinicalSyncFactCheckpointSchema = z.object({
  identity: StringSchema,
  fingerprint: StringSchema,
  watermark: NullableOptionalStringSchema,
});

const ClinicalSyncSourceCheckpointSchema = z.object({
  watermark: NullableOptionalStringSchema,
  lastFullValidationAt: NullableOptionalStringSchema,
  lastFullValidationLookbackDays: nullableOptional(z.int().check(z.positive())),
  lastFullValidationAttemptAt: NullableOptionalStringSchema,
  lastFullValidationAttemptLookbackDays: nullableOptional(z.int().check(z.positive())),
  packedFacts: z.optional(z.array(StringSchema)),
  facts: z.optional(z.array(ClinicalSyncFactCheckpointSchema)),
});

export const ClinicalSyncCheckpointSchema = z.object({
  version: z.int(),
  fingerprintVersion: z.int(),
  sources: z.prefault(
    z.object({
      vitals: nullableOptional(ClinicalSyncSourceCheckpointSchema),
      scales: nullableOptional(ClinicalSyncSourceCheckpointSchema),
      staffing: nullableOptional(ClinicalSyncSourceCheckpointSchema),
    }),
    {}
  ),
});

import { PatientData } from '@/types/domain/patient';

export const PatientDataSchema: z.ZodMiniType<PatientData, unknown> = z.lazy(() =>
  z.pipe(
    z.looseObject({
      bedId: DefaultEmptyStringSchema,
      isBlocked: DefaultFalseSchema,
      blockedReason: NullableOptionalStringSchema,
      bedMode: z.prefault(z.enum(['Cama', 'Cuna']), 'Cama'),
      neonatalMaternalRut: z.catch(NullableOptionalStringSchema, undefined),
      neonatalPlacementDecision: z.catch(
        nullableOptional(
          z.object({
            clinicalEpisodeId: StringSchema.check(z.minLength(1)),
            kind: z.enum(['mother', 'independent']),
            bedId: StringSchema.check(z.minLength(1)),
            parentEpisodeId: OptionalStringSchema,
            effectiveAt: z.iso.datetime({ offset: true }),
            reviewedAt: z.iso.datetime({ offset: true }),
            reviewedBy: StringSchema,
            sourcePlacementKey: OptionalStringSchema,
            sourceService: OptionalStringSchema,
            sourceRun: OptionalStringSchema,
            sourceRunIsMaternal: z.optional(z.boolean()),
            maternalRut: OptionalStringSchema,
          })
        ),
        undefined
      ),
      hasCompanionCrib: DefaultFalseSchema,
      clinicalCrib: z.pipe(
        z.optional(z.nullable(z.lazy(() => PatientDataSchema))),
        z.transform(v => v ?? undefined)
      ),
      patientName: DefaultEmptyStringSchema,
      firstName: DefaultEmptyStringSchema,
      lastName: DefaultEmptyStringSchema,
      secondLastName: DefaultEmptyStringSchema,
      namePartsSource: z.catch(nullableOptional(z.literal('eloisa')), undefined),
      identityStatus: nullableOptional(z.enum(['provisional', 'official'])),
      rut: DefaultEmptyStringSchema,
      documentType: nullableOptional(emptyStringToUndefined(z.enum(['RUT', 'Pasaporte']))),
      documentManualOverride: nullableOptional(z.boolean()),
      age: DefaultEmptyStringSchema,
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
      diagnosisManualOverride: nullableOptional(z.boolean()),
      diagnosisManualOverrideBase: nullableOptional(
        z.object({
          pathology: DefaultEmptyStringSchema,
          cie10Code: NullableOptionalStringSchema,
        })
      ),
      pathology: DefaultEmptyStringSchema,
      snomedCode: NullableOptionalStringSchema,
      cie10Code: NullableOptionalStringSchema,
      cie10Description: NullableOptionalStringSchema,
      diagnosisComments: NullableOptionalStringSchema,
      treatingPhysicianId: NullableOptionalStringSchema,
      treatingPhysicianName: NullableOptionalStringSchema,
      dismissedTreatingPhysician: nullableOptional(
        z.object({
          episodeId: StringSchema.check(z.minLength(1)),
          practitionerId: NullableOptionalStringSchema,
          name: NullableOptionalStringSchema,
          displayName: NullableOptionalStringSchema,
        })
      ),
      specialty: z.prefault(SpecialtySchema, Specialty.EMPTY),
      specialtyAssignment: nullableOptional(
        z.object({
          schemaVersion: z.literal(3),
          episodeId: StringSchema,
          decisionId: StringSchema,
          recordDate: StringSchema,
          source: z.enum(['manual', 'rule', 'manual_ai']),
          actorUid: StringSchema,
          decidedAt: StringSchema,
          rule: nullableOptional(
            z.object({
              id: StringSchema,
              revision: z.number(),
              catalogRevision: z.number(),
            })
          ),
          ai: nullableOptional(
            z.object({
              requestId: StringSchema,
              model: StringSchema,
              promptVersion: StringSchema,
            })
          ),
        })
      ),
      ginecobstetriciaType: nullableOptional(
        emptyStringToUndefined(z.enum(['Obstétrica', 'Ginecológica']))
      ),
      secondarySpecialty: OptionalRawSpecialtySchema,
      status: z.prefault(z.nativeEnum(PatientStatus), PatientStatus.EMPTY),
      admissionDate: DefaultEmptyStringSchema,
      admissionTime: DefaultEmptyStringSchema,
      clinicalEpisodeId: NullableOptionalStringSchema,
      eloisaManualImportAudit: nullableOptional(
        z.object({
          method: z.literal('eloisa_manual_code'),
          importedBy: StringSchema,
          importedAt: StringSchema,
          capturedAt: StringSchema,
          formatVersion: z.union([z.literal(1), z.literal(2)]),
          encounterId: StringSchema,
          encounterRoute: z.optional(z.enum(['medical', 'nurse'])),
          integrity: z.literal('sha256_checksum'),
          sourceTrust: z.literal('user_confirmed_unverified'),
        })
      ),
      hasWristband: z.prefault(z.boolean(), true),
      devices: nullishDefault(z.array(StringSchema), () => []),
      deviceDetails: nullableOptional(DeviceDetailsSchema),
      surgicalComplication: DefaultFalseSchema,
      isUPC: DefaultFalseSchema,
      upcChecklist: z.catch(nullableOptional(UpcChecklistSchema), undefined),
      isIsolated: nullableOptional(z.boolean()),
      isolationType: NullableOptionalStringSchema,
      isolationMicroorganism: NullableOptionalStringSchema,
      dischargeVerification: z.catch(nullableOptional(DischargeVerificationSchema), undefined),
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
      clinicalCarryover: nullableOptional(
        z.object({
          sourceDate: StringSchema.check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
          clinicalEpisodeId: StringSchema.check(z.minLength(1)),
          vitalsPending: z.boolean(),
          devicesPending: z.boolean(),
        })
      ),
    }),
    z.transform(patient => {
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
  )
);
