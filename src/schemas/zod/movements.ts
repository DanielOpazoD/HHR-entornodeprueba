import { z } from 'zod';
import { Specialty } from '@/types/domain/patientClassification';
import { DischargeData, TransferData, CMAData, MovementProvenance } from '@/types/domain/movements';
import { nullableOptional } from './helpers';
import { PatientDataSchema } from './patient';

export const IeehDataSchema = z.object({
  diagnosticoPrincipal: nullableOptional(z.string()),
  cie10Code: nullableOptional(z.string()),
  condicionEgreso: nullableOptional(z.string()),
  intervencionQuirurgica: nullableOptional(z.string()),
  intervencionQuirurgDescrip: nullableOptional(z.string()),
  procedimiento: nullableOptional(z.string()),
  procedimientoDescrip: nullableOptional(z.string()),
  tratanteApellido1: nullableOptional(z.string()),
  tratanteApellido2: nullableOptional(z.string()),
  tratanteNombre: nullableOptional(z.string()),
  tratanteRut: nullableOptional(z.string()),
});

const MovementTombstoneFieldsSchema = {
  deletedAt: nullableOptional(z.string()),
  deletedBy: nullableOptional(z.string()),
  deletedReason: nullableOptional(z.string()),
};

export const MovementProvenanceSchema: z.ZodType<MovementProvenance, z.ZodTypeDef, unknown> =
  z.object({
    source: z.enum(['manual', 'gestion_camas', 'reclassified']),
    lineageId: z.string().min(1),
    classifiedAt: z.string().min(1),
    classifiedBy: nullableOptional(z.string()),
    syncRunId: nullableOptional(z.string()),
    previousMovementId: nullableOptional(z.string()),
    previousClassification: nullableOptional(z.enum(['discharge', 'transfer', 'cma'])),
  });

const MovementEpisodeFieldsSchema = {
  clinicalEpisodeId: nullableOptional(z.string()),
  movementProvenance: nullableOptional(MovementProvenanceSchema),
};

export const DischargeDataSchema: z.ZodType<DischargeData, z.ZodTypeDef, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: z.string(),
    movementDate: nullableOptional(z.string()),
    admissionDate: nullableOptional(z.string()),
    bedName: z.string().default(''),
    bedId: z.string().default(''),
    bedType: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    diagnosis: z.string().default(''),
    specialty: nullableOptional(z.string()),
    time: z.string().default(''),
    status: z.enum(['Vivo', 'Fallecido']).default('Vivo'),
    dischargeType: nullableOptional(z.enum(['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra'])),
    dischargeTypeOther: nullableOptional(z.string()),
    age: nullableOptional(z.string()),
    insurance: nullableOptional(z.string()),
    origin: nullableOptional(z.string()),
    isRapanui: nullableOptional(z.boolean()),
    originalData: nullableOptional(PatientDataSchema),
    isNested: nullableOptional(z.boolean()),
    ieehData: nullableOptional(IeehDataSchema),
  })
  .passthrough();

export const TransferDataSchema: z.ZodType<TransferData, z.ZodTypeDef, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: z.string(),
    movementDate: nullableOptional(z.string()),
    admissionDate: nullableOptional(z.string()),
    bedName: z.string().default(''),
    bedId: z.string().default(''),
    bedType: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    diagnosis: z.string().default(''),
    specialty: nullableOptional(z.string()),
    time: z.string().default(''),
    evacuationMethod: z.string().default(''),
    receivingCenter: z.string().default(''),
    receivingCenterOther: nullableOptional(z.string()),
    transferEscort: nullableOptional(z.string()),
    age: nullableOptional(z.string()),
    insurance: nullableOptional(z.string()),
    origin: nullableOptional(z.string()),
    isRapanui: nullableOptional(z.boolean()),
    originalData: nullableOptional(PatientDataSchema),
    isNested: nullableOptional(z.boolean()),
  })
  .passthrough();

export const CMADataSchema: z.ZodType<CMAData, z.ZodTypeDef, unknown> = z
  .object({
    ...MovementTombstoneFieldsSchema,
    ...MovementEpisodeFieldsSchema,
    id: z.string(),
    bedName: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    age: z.string().default(''),
    diagnosis: z.string().default(''),
    specialty: z
      .union([z.nativeEnum(Specialty), z.string().transform(value => value.trim())])
      .default(Specialty.EMPTY),
    interventionType: z
      .enum(['Cirugía Mayor Ambulatoria', 'Procedimiento Médico Ambulatorio'])
      .default('Cirugía Mayor Ambulatoria'),
    dischargeTime: nullableOptional(z.string()),
    enteredBy: nullableOptional(z.string()),
    timestamp: nullableOptional(z.string()),
    originalBedId: nullableOptional(z.string()),
    originalData: nullableOptional(PatientDataSchema),
  })
  .passthrough();
