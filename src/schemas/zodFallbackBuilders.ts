import type { ZodIssue } from 'zod';
import type { PatientData } from '@/types/domain/patient';
import {
  PATIENT_IDENTITY_FIELDS,
  type PatientIdentityField,
  type PatientIdentityReview,
} from '@/types/domain/patientIdentity';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import {
  isIdentityReview,
  isPatientIdentityField,
  isPlainObject,
  PatientIdentityRepairRequiredError,
} from '@/shared/census/patientIdentityReview';

/**
 * What a salvage does with an identity field it cannot read. `quarantine`, for stored data, keeps
 * the day readable: the patient carries an identity review and the field shows nothing, never a
 * guess or a conversion. `reject`, for a write, throws instead of storing it.
 */
export type UnreadableIdentityPolicy = 'reject' | 'quarantine';

export interface FallbackPatientDataOptions {
  unreadableIdentity?: UnreadableIdentityPolicy;
  slot?: PatientIdentityReview['slot'];
  /** The patient as storage holds it, before legacy normalization; `data` otherwise. */
  raw?: unknown;
}

export const buildFallbackPatientDataReport = (
  data: unknown,
  bedId: string,
  { unreadableIdentity = 'quarantine', slot = 'bed', raw = data }: FallbackPatientDataOptions = {}
): { patient: PatientData; droppedListItems: number } => {
  const candidate: Record<string, unknown> = {
    ...createEmptyPatient(bedId),
    ...(data && typeof data === 'object' ? data : {}),
    bedId,
  };
  const previousReview = isIdentityReview(candidate.identityReview)
    ? candidate.identityReview
    : undefined;
  const reviewed = new Set<PatientIdentityField>(previousReview?.fields);

  let droppedListItems = 0;
  let clinicalCrib: PatientData | undefined;
  if (candidate.clinicalCrib && typeof candidate.clinicalCrib === 'object') {
    // The newborn is another patient: salvaged, and reviewed, on its own.
    const crib = buildFallbackPatientDataReport(candidate.clinicalCrib, bedId, {
      unreadableIdentity,
      slot: 'clinicalCrib',
      raw: (raw as { clinicalCrib?: unknown } | null | undefined)?.clinicalCrib,
    });
    clinicalCrib = crib.patient;
    candidate.clinicalCrib = clinicalCrib;
    droppedListItems += crib.droppedListItems;
  }

  const parsed = PatientDataSchema.safeParse(candidate);
  if (!parsed.success) {
    const defaults: Record<string, unknown> = { ...createEmptyPatient(bedId) };
    const issuesByField = new Map<string, ZodIssue[]>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string') {
        const issues = issuesByField.get(field) ?? [];
        issues.push(issue);
        issuesByField.set(field, issues);
      }
    }
    if (unreadableIdentity === 'reject' && [...issuesByField.keys()].some(isPatientIdentityField)) {
      throw new PatientIdentityRepairRequiredError({ bedId, slot });
    }
    for (const [field, issues] of issuesByField) {
      if (isPatientIdentityField(field)) {
        // A choice outside its options (a document type, an identity status) gets no default.
        candidate[field] =
          field === 'documentType' || field === 'identityStatus' ? undefined : defaults[field];
        reviewed.add(field);
        continue;
      }
      const list = candidate[field];
      if (Array.isArray(list) && issues.every(issue => typeof issue.path[1] === 'number')) {
        const invalidIndexes = new Set(issues.map(issue => issue.path[1]));
        candidate[field] = list.filter((_, index) => !invalidIndexes.has(index));
        droppedListItems += invalidIndexes.size;
      } else {
        candidate[field] = defaults[field];
      }
    }
  }

  const { identityReview: _previousReview, ...patient } = parsed.success
    ? parsed.data
    : PatientDataSchema.parse(candidate);
  const fields = [...reviewed];
  // The identity exactly as storage holds it, before any normalization: nulls included.
  const source = isPlainObject(raw) ? raw : {};
  const stored = Object.fromEntries(
    PATIENT_IDENTITY_FIELDS.filter(field => Object.hasOwn(source, field)).map(field => [
      field,
      source[field],
    ])
  );
  return {
    patient: {
      ...patient,
      ...(clinicalCrib ? { clinicalCrib } : {}),
      isUPC: resolveEffectiveUpcState({
        bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      }).isUpc,
      ...(fields.length
        ? {
            identityReview: {
              bedId,
              slot,
              fields,
              stored: { ...stored, ...previousReview?.stored },
            },
          }
        : {}),
    },
    droppedListItems,
  };
};

export const buildFallbackPatientData = (
  data: unknown,
  bedId: string,
  options: FallbackPatientDataOptions = {}
): PatientData => buildFallbackPatientDataReport(data, bedId, options).patient;
