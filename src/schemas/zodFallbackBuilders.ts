import * as z from 'zod';
import type { PatientData } from '@/types/domain/patient';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

const identityFields = new Set([
  'documentType',
  'rut',
  'clinicalEpisodeId',
  'identityStatus',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'admissionDate',
  'admissionTime',
]);

export class PatientIdentityRepairRequiredError extends Error {
  readonly code = 'patient_identity_repair_required';

  constructor(
    readonly bedId: string,
    readonly fields: string[]
  ) {
    super(`La identidad del paciente requiere reparación (${fields.join(', ')}).`);
    this.name = 'PatientIdentityRepairRequiredError';
  }
}

export const buildFallbackPatientData = (data: unknown, bedId: string): PatientData => {
  const raw = z.record(z.string(), z.unknown()).safeParse(data);
  const candidate: Record<string, unknown> = {
    bedId,
    ...(raw.success ? raw.data : {}),
  };
  const defaults: Record<string, unknown> = {
    ...createEmptyPatient(bedId),
    documentType: undefined,
  };

  if (candidate.clinicalCrib && typeof candidate.clinicalCrib === 'object') {
    candidate.clinicalCrib = buildFallbackPatientData(candidate.clinicalCrib, bedId);
  }

  const parsed = PatientDataSchema.safeParse(candidate);
  if (!parsed.success) {
    const invalidFields = new Set(
      parsed.error.issues.flatMap(issue =>
        typeof issue.path[0] === 'string' ? [issue.path[0]] : []
      )
    );
    const invalidIdentityFields = [...invalidFields].filter(field => identityFields.has(field));
    if (invalidIdentityFields.length > 0) {
      // Existing read errors and skipped JSON entries must remain failures, never invented identities.
      throw new PatientIdentityRepairRequiredError(bedId, invalidIdentityFields);
    }
    for (const field of invalidFields) {
      candidate[field] = defaults[field];
    }
  }

  const patient = parsed.success ? parsed.data : PatientDataSchema.parse(candidate);
  return {
    ...patient,
    isUPC: resolveEffectiveUpcState({
      bedId,
      isUPC: patient.isUPC,
      checklist: patient.upcChecklist,
    }).isUpc,
  };
};
