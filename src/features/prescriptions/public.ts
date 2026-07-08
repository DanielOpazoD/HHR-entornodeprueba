// Public API for code outside the prescriptions feature.
// Internal consumers should import from `./internal` or local modules directly.
export {
  PRESCRIPTION_TYPES,
  PRESCRIPTION_TYPE_LABELS,
  PRESCRIPTION_RETENTION_DAYS,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
export { PrescriptionUploadView } from '@/features/prescriptions/components/PrescriptionUploadView';
export { PrescriptionVisorView } from '@/features/prescriptions/components/PrescriptionVisorView';
export { PrescriptionAdminView } from '@/features/prescriptions/components/PrescriptionAdminView';
