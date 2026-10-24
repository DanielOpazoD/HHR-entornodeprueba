import * as z from 'zod';
import type { PatientData } from '@/types/domain/patient';
import type { PatientIdentityField, PatientIdentityReview } from '@/types/domain/patientIdentity';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import {
  isIdentityReview,
  isPatientIdentityField,
  PatientIdentityRepairRequiredError,
  toReviewFields,
} from '@/shared/census/patientIdentityReview';

/**
 * What a salvage does with a stored identity field it cannot read. `reject` throws: imports and
 * writes must not store it. `quarantine` keeps a read of stored data usable: the patient carries an
 * identity review, and the field holds the stored value as text when that loses nothing, else
 * nothing. A choice outside its options (a document type, an identity status) is never guessed.
 */
export type UnreadableIdentityPolicy = 'reject' | 'quarantine';

export interface FallbackPatientDataOptions {
  unreadableIdentity?: UnreadableIdentityPolicy;
  slot?: PatientIdentityReview['slot'];
}

export interface FallbackPatientDataResult {
  patient: PatientData;
  /** Invalid entries left out of the patient's lists (events, handoff entries, devices). */
  droppedListItems: number;
}

const IDENTITY_FIELD_KIND: Record<PatientIdentityField, 'text' | 'choice'> = {
  documentType: 'choice',
  identityStatus: 'choice',
  rut: 'text',
  clinicalEpisodeId: 'text',
  patientName: 'text',
  firstName: 'text',
  lastName: 'text',
  secondLastName: 'text',
  admissionDate: 'text',
  admissionTime: 'text',
};

const readableIdentityValue = (
  field: PatientIdentityField,
  stored: unknown,
  emptyValue: unknown
): unknown => {
  if (IDENTITY_FIELD_KIND[field] === 'choice') return undefined;
  return typeof stored === 'number' || typeof stored === 'boolean' ? String(stored) : emptyValue;
};

/** Entry indexes behind a list's issues, or null when an issue concerns the list itself. */
const invalidListEntries = (issues: z.ZodIssue[]): Set<number> | null => {
  const entries = new Set<number>();
  for (const issue of issues) {
    const index = issue.path[1];
    if (typeof index !== 'number') return null;
    entries.add(index);
  }
  return entries;
};

const groupIssuesByField = (issues: z.ZodIssue[]): Map<string, z.ZodIssue[]> => {
  const byField = new Map<string, z.ZodIssue[]>();
  issues.forEach(issue => {
    const field = issue.path[0];
    if (typeof field === 'string') byField.set(field, [...(byField.get(field) ?? []), issue]);
  });
  return byField;
};

/** Rebuilds a stored patient that failed its schema: valid fields stay, each invalid one is repaired alone. */
export const buildFallbackPatientData = (
  data: unknown,
  bedId: string,
  { unreadableIdentity = 'reject', slot = 'bed' }: FallbackPatientDataOptions = {}
): FallbackPatientDataResult => {
  const stored = z.record(z.string(), z.unknown()).safeParse(data);
  // The bed key is the location; a stored bedId does not move the patient.
  const candidate: Record<string, unknown> = { ...(stored.success ? stored.data : {}), bedId };
  const emptyPatient: Record<string, unknown> = { ...createEmptyPatient(bedId) };
  const reviewed = new Set<PatientIdentityField>(
    isIdentityReview(candidate.identityReview) ? candidate.identityReview.fields : []
  );
  let droppedListItems = 0;

  if (candidate.clinicalCrib && typeof candidate.clinicalCrib === 'object') {
    // The newborn is another patient: salvaged, and reviewed, on its own.
    const crib = buildFallbackPatientData(candidate.clinicalCrib, bedId, {
      unreadableIdentity,
      slot: 'clinicalCrib',
    });
    candidate.clinicalCrib = crib.patient;
    droppedListItems += crib.droppedListItems;
  }

  const parsed = PatientDataSchema.safeParse(candidate);
  if (!parsed.success) {
    const issuesByField = groupIssuesByField(parsed.error.issues);
    const unreadable = toReviewFields([...issuesByField.keys()].filter(isPatientIdentityField));
    if (unreadable && unreadableIdentity === 'reject') {
      throw new PatientIdentityRepairRequiredError({ bedId, slot, fields: unreadable });
    }
    issuesByField.forEach((issues, field) => {
      if (isPatientIdentityField(field)) {
        candidate[field] = readableIdentityValue(field, candidate[field], emptyPatient[field]);
        reviewed.add(field);
        return;
      }
      const list = candidate[field];
      const invalidEntries = Array.isArray(list) ? invalidListEntries(issues) : null;
      if (Array.isArray(list) && invalidEntries) {
        candidate[field] = list.filter((_, index) => !invalidEntries.has(index));
        droppedListItems += invalidEntries.size;
        return;
      }
      candidate[field] = emptyPatient[field];
    });
  }

  const { identityReview: _previousReview, ...patient } = parsed.success
    ? parsed.data
    : PatientDataSchema.parse(candidate);
  const fields = toReviewFields(reviewed);
  return {
    patient: {
      ...patient,
      isUPC: resolveEffectiveUpcState({
        bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      }).isUpc,
      ...(fields ? { identityReview: { bedId, slot, fields } } : {}),
    },
    droppedListItems,
  };
};
