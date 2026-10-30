import * as z from 'zod';
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
  lineageId: StringSchema.min(1),
  classifiedAt: StringSchema.min(1),
  classifiedBy: NullableOptionalStringSchema,
};

export const MovementProvenanceSchema: z.ZodType<MovementProvenance, unknown> =
  z.discriminatedUnion('source', [
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('manual'),
    }),
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('gestion_camas'),
      syncRunId: StringSchema.min(1),
    }),
    z.object({
      ...MovementProvenanceSharedSchema,
      source: z.literal('reclassified'),
      syncRunId: NullableOptionalStringSchema,
      previousMovementId: StringSchema.min(1),
      previousClassification: z.enum(['discharge', 'transfer', 'cma']),
    }),
  ]);

const MovementEpisodeFieldsSchema = {
  clinicalEpisodeId: NullableOptionalStringSchema,
  movementProvenance: nullableOptional(MovementProvenanceSchema),
};

export const DischargeDataSchema: z.ZodType<DischargeData, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: StringSchema,
    movementDate: NullableOptionalStringSchema,
    admissionDate: NullableOptionalStringSchema,
    bedName: DefaultEmptyStringSchema,
    bedId: DefaultEmptyStringSchema,
    bedType: DefaultEmptyStringSchema,
    patientName: DefaultEmptyStringSchema,
    rut: DefaultEmptyStringSchema,
    diagnosis: DefaultEmptyStringSchema,
    specialty: NullableOptionalStringSchema,
    time: DefaultEmptyStringSchema,
    status: z.enum(['Vivo', 'Fallecido']).prefault('Vivo'),
    dischargeType: nullableOptional(z.enum(['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra'])),
    dischargeTypeOther: NullableOptionalStringSchema,
    age: NullableOptionalStringSchema,
    insurance: NullableOptionalStringSchema,
    origin: NullableOptionalStringSchema,
    isRapanui: OptionalBooleanSchema,
    originalData: OptionalPatientDataSchema,
    isNested: OptionalBooleanSchema,
    ieehData: nullableOptional(IeehDataSchema),
  })
  .passthrough();

export const TransferDataSchema: z.ZodType<TransferData, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: StringSchema,
    movementDate: NullableOptionalStringSchema,
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
  })
  .passthrough();

export const CMADataSchema: z.ZodType<CMAData, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: StringSchema,
    bedName: DefaultEmptyStringSchema,
    patientName: DefaultEmptyStringSchema,
    rut: DefaultEmptyStringSchema,
    age: DefaultEmptyStringSchema,
    diagnosis: DefaultEmptyStringSchema,
    specialty: z
      .union([z.nativeEnum(Specialty), StringSchema.transform(value => value.trim())])
      .prefault(Specialty.EMPTY),
    interventionType: z
      .enum(['Cirugía Mayor Ambulatoria', 'Procedimiento Médico Ambulatorio'])
      .prefault('Cirugía Mayor Ambulatoria'),
    dischargeTime: NullableOptionalStringSchema,
    enteredBy: NullableOptionalStringSchema,
    timestamp: NullableOptionalStringSchema,
    originalBedId: NullableOptionalStringSchema,
    originalData: OptionalPatientDataSchema,
  })
  .passthrough();
