import {
  PATIENT_IDENTITY_FIELDS,
  type PatientIdentityReview,
} from '@/types/domain/patientIdentity';
import { identityReviewTitle } from '@/shared/census/patientIdentityReview';

// In the order of PATIENT_IDENTITY_FIELDS.
const FIELD_LABELS = [
  'tipo de documento',
  'RUT o pasaporte',
  'episodio',
  'estado',
  'nombre',
  'nombres',
  'primer apellido',
  'segundo apellido',
  'fecha de ingreso',
  'hora',
] as const satisfies { length: (typeof PATIENT_IDENTITY_FIELDS)['length'] };

/** The review as the census shows it: where it sits and which fields wait for a repair. */
export const describeIdentityReview = (
  review: Pick<PatientIdentityReview, 'bedId' | 'slot' | 'fields'>
): string =>
  `${identityReviewTitle(review)}: ` +
  `${review.fields.map(field => FIELD_LABELS[PATIENT_IDENTITY_FIELDS.indexOf(field)]).join(', ')}.`;
