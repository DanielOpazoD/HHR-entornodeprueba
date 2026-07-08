// Internal barrel for prescription-feature consumers.
export {
  parsePrescriptionRecord,
  prescriptionRecordSchema,
  safeParsePrescriptionRecord,
} from '@/schemas/prescriptionSchemas';
export {
  PRESCRIPTION_TYPES,
  PRESCRIPTION_TYPE_LABELS,
  PRESCRIPTION_RETENTION_DAYS,
  type PrescriptionRecord,
  type PrescriptionType,
  type PrescriptionImageMeta,
  type PrescriptionUploaderRef,
} from '@/types/prescriptionTypes';
