import * as z from 'zod/mini';
import { Specialty } from '@/types/domain/patientClassification';
import { DischargeData, TransferData, CMAData, MovementProvenance } from '@/types/domain/movements';
import {
  nullableOptional,
  StringSchema,
  NullableOptionalStringSchema,
  DefaultEmptyStringSchema,
} from './helpers';
import { PatientDataSchema } from './patient';

const OptionalBooleanSchema = nullableOptional(z.boolean());
const OptionalPatientDataSchema = nullableOptional(PatientDataSchema);

export const IeehDataSchema = z.object({
  diagnosticoPrincipal: NullableOptionalStringSchema,
  cie10Code: NullableOptionalStringSchema,
  condicionEgreso: NullableOptionalStringSchema,
  intervencionQuirurgica: NullableOptionalStringSchema,
  intervencionQuirurgDescrip: NullableOptionalStringSchema,
  procedimiento: NullableOptionalStringSchema,
  procedimientoDescrip: NullableOptionalStringSchema,
  tratanteApellido1: NullableOptionalStringSchema,
  tratanteApellido2: NullableOptionalStringSchema,
  tratanteNombre: NullableOptionalStringSchema,
  tratanteRut: NullableOptionalStringSchema,
});

const MovementTombstoneFieldsSchema = {
  deletedAt: NullableOptionalStringSchema,
  deletedBy: NullableOptionalStringSchema,
  deletedReason: NullableOptionalStringSchema,
};

const MovementProvenanceSharedSchema = {
  lineageId: StringSchema.check(z.minLength(1)),
  classifiedAt: StringSchema.check(z.minLength(1)),
  classifiedBy: NullableOptionalStringSchema,
};

export const MovementProvenanceSchema: z.ZodMiniType<MovementProvenance, unknown> =
  z.discriminatedUnion('source', [
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('manual'),
    }),
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('gestion_camas'),
      syncRunId: StringSchema.check(z.minLength(1)),
    }),
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('reclassified'),
      syncRunId: NullableOptionalStringSchema,
      previousMovementId: StringSchema.check(z.minLength(1)),
      previousClassification: z.enum(['discharge', 'transfer', 'cma']),
    }),
  ]);

const MovementEpisodeFieldsSchema = {
  clinicalEpisodeId: NullableOptionalStringSchema,
  movementProvenance: nullableOptional(MovementProvenanceSchema),
};

export const DischargeDataSchema: z.ZodMiniType<DischargeData, unknown> = z.looseObject({
  ...MovementTombstoneFieldsSchema,
  ...MovementEpisodeFieldsSchema,
  id: StringSchema,
  movementDate: NullableOptionalStringSchema,
  movementDateSource: nullableOptional(z.literal('official')),
  admissionDate: NullableOptionalStringSchema,
  bedName: DefaultEmptyStringSchema,
  bedId: DefaultEmptyStringSchema,
  bedType: DefaultEmptyStringSchema,
  patientName: DefaultEmptyStringSchema,
  rut: DefaultEmptyStringSchema,
  diagnosis: DefaultEmptyStringSchema,
  specialty: NullableOptionalStringSchema,
  time: DefaultEmptyStringSchema,
  status: z.prefault(z.enum(['Vivo', 'Fallecido']), 'Vivo'),
  dischargeType: nullableOptional(z.enum(['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra'])),
  dischargeTypeOther: NullableOptionalStringSchema,
  age: NullableOptionalStringSchema,
  insurance: NullableOptionalStringSchema,
  origin: NullableOptionalStringSchema,
  isRapanui: OptionalBooleanSchema,
  originalData: OptionalPatientDataSchema,
  isNested: OptionalBooleanSchema,
  ieehData: nullableOptional(IeehDataSchema),
});

export const TransferDataSchema: z.ZodMiniType<TransferData, unknown> = z.looseObject({
  ...MovementTombstoneFieldsSchema,
  ...MovementEpisodeFieldsSchema,
  id: StringSchema,
  movementDate: NullableOptionalStringSchema,
  movementDateSource: nullableOptional(z.literal('official')),
  admissionDate: NullableOptionalStringSchema,
  bedName: DefaultEmptyStringSchema,
  bedId: DefaultEmptyStringSchema,
  bedType: DefaultEmptyStringSchema,
  patientName: DefaultEmptyStringSchema,
  rut: DefaultEmptyStringSchema,
  diagnosis: DefaultEmptyStringSchema,
  specialty: NullableOptionalStringSchema,
  time: DefaultEmptyStringSchema,
  evacuationMethod: DefaultEmptyStringSchema,
  receivingCenter: DefaultEmptyStringSchema,
  receivingCenterOther: NullableOptionalStringSchema,
  transferEscort: NullableOptionalStringSchema,
  age: NullableOptionalStringSchema,
  insurance: NullableOptionalStringSchema,
  origin: NullableOptionalStringSchema,
  isRapanui: OptionalBooleanSchema,
  originalData: OptionalPatientDataSchema,
  isNested: OptionalBooleanSchema,
});

export const CMADataSchema: z.ZodMiniType<CMAData, unknown> = z.looseObject({
  ...MovementTombstoneFieldsSchema,
  ...MovementEpisodeFieldsSchema,
  id: StringSchema,
  bedName: DefaultEmptyStringSchema,
  patientName: DefaultEmptyStringSchema,
  rut: DefaultEmptyStringSchema,
  age: DefaultEmptyStringSchema,
  diagnosis: DefaultEmptyStringSchema,
  specialty: z.prefault(
    z.union([
      z.nativeEnum(Specialty),
      z.pipe(
        StringSchema,
        z.transform(value => value.trim())
      ),
    ]),
    Specialty.EMPTY
  ),
  interventionType: z.prefault(
    z.enum(['Cirugía Mayor Ambulatoria', 'Procedimiento Médico Ambulatorio']),
    'Cirugía Mayor Ambulatoria'
  ),
  dischargeTime: NullableOptionalStringSchema,
  enteredBy: NullableOptionalStringSchema,
  timestamp: NullableOptionalStringSchema,
  originalBedId: NullableOptionalStringSchema,
  originalData: OptionalPatientDataSchema,
});
