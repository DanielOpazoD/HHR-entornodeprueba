import type { ZodIssue } from 'zod';
import type { PatientData } from '@/types/domain/patient';
import type { PatientIdentityField, PatientIdentityReview } from '@/types/domain/patientIdentity';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import {
  isIdentityReview,
  isPatientIdentityField,
  PatientIdentityRepairRequiredError,
} from '@/shared/census/patientIdentityReview';

/**
 * What a salvage does with an identity field it cannot read. `quarantine`, for stored data, keeps
 * the day readable: the patient carries an identity review, and the field holds the stored value as
 * text when that loses nothing, else nothing. A choice outside its options (a document type, an
 * identity status) is never guessed. `reject`, for a write, throws instead of storing it.
 */
export type UnreadableIdentityPolicy = 'reject' | 'quarantine';

export interface FallbackPatientDataOptions {
  unreadableIdentity?: UnreadableIdentityPolicy;
  slot?: PatientIdentityReview['slot'];
}

const readableIdentityValue = (
  field: PatientIdentityField,
  stored: unknown,
  emptyValue: unknown
): unknown => {
  if (field === 'documentType' || field === 'identityStatus') return undefined;
  return typeof stored === 'number' || typeof stored === 'boolean' ? String(stored) : emptyValue;
};

export const buildFallbackPatientDataReport = (
  data: unknown,
  bedId: string,
  { unreadableIdentity = 'quarantine', slot = 'bed' }: FallbackPatientDataOptions = {}
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
  const stored: Partial<Record<PatientIdentityField, unknown>> = { ...previousReview?.stored };

  let droppedListItems = 0;
  let clinicalCrib: PatientData | undefined;
  if (candidate.clinicalCrib && typeof candidate.clinicalCrib === 'object') {
    // The newborn is another patient: salvaged, and reviewed, on its own.
    const crib = buildFallbackPatientDataReport(candidate.clinicalCrib, bedId, {
      unreadableIdentity,
      slot: 'clinicalCrib',
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
    const unreadable = [...issuesByField.keys()].filter(isPatientIdentityField);
    if (unreadable.length && unreadableIdentity === 'reject') {
      throw new PatientIdentityRepairRequiredError({ bedId, slot, fields: unreadable });
    }
    for (const [field, issues] of issuesByField) {
      if (isPatientIdentityField(field)) {
        stored[field] = candidate[field];
        candidate[field] = readableIdentityValue(field, candidate[field], defaults[field]);
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
  return {
    patient: {
      ...patient,
      ...(clinicalCrib ? { clinicalCrib } : {}),
      isUPC: resolveEffectiveUpcState({
        bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      }).isUpc,
      ...(fields.length ? { identityReview: { bedId, slot, fields, stored } } : {}),
    },
    droppedListItems,
  };
};

export const buildFallbackPatientData = (
  data: unknown,
  bedId: string,
  options: FallbackPatientDataOptions = {}
): PatientData => buildFallbackPatientDataReport(data, bedId, options).patient;
