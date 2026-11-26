import type { PatientData } from '@/types/domain/patient';

import { isNeonatalPatient, newbornOwnRut } from './clinicalCribMaternalAssociation';
import type { FieldChange, MoveEntry } from '../contracts/censusImportDiff';

import {
  hasNonRutLetter,
  hasPassportShapeBeforeLetterRule,
  isSameDocument,
  normalizeRut,
} from '@/utils/rutUtils';
import { isDismissedTreatingPhysician } from '@/shared/census/treatingPhysicianDismissal';
import { hasNewerSourceDiagnosisThanOverrideBase } from '@/shared/census/diagnosisManualOverridePolicy';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import { matchesCensusEpisodeIdentity, normalizePatientRut } from './censusPatientIdentityIndex';

/** Relocation preserves notes and classification while replacing the former source location. */
export const patientAfterBedMove = (
  source: PatientData,
  move: MoveEntry,
  reference: Date
): PatientData => {
  const placement = rayenToPatientData(move.source, reference);
  return normalizePatientUpcForBed(
    {
      ...source,
      // A newborn carries no number that cannot be its own document into its new bed.
      rut: newbornOwnRut(source),
      ...(!source.clinicalEpisodeId && matchesCensusEpisodeIdentity(source, placement.patient)
        ? { clinicalEpisodeId: placement.patient.clinicalEpisodeId }
        : {}),
      ...(placement.bedId === move.toBedId ? { location: placement.patient.location } : {}),
    },
    move.toBedId
  );
};

/** Rayen-owned fields. Specialty (including a manual blank) belongs to HHR server decisions. */
const SYNCABLE_FIELDS: Array<keyof PatientData> = [
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'namePartsSource',
  'rut',
  'documentType',
  'birthDate',
  'age',
  'biologicalSex',
  'admissionDate',
  'admissionTime',
  'pathology',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'isIsolated',
  'isolationType',
  'isolationMicroorganism',
  'clinicalEpisodeId',
];

export const diffSyncablePatientFields = (
  current: PatientData,
  incoming: PatientData
): FieldChange[] => {
  const changes: FieldChange[] = [];
  const dismissedPhysician = isDismissedTreatingPhysician(current, incoming);
  const sameEpisodeForManualOverride =
    !current.clinicalEpisodeId ||
    !incoming.clinicalEpisodeId ||
    current.clinicalEpisodeId === incoming.clinicalEpisodeId;
  const supersededManualDiagnosis =
    sameEpisodeForManualOverride && hasNewerSourceDiagnosisThanOverrideBase(current, incoming);
  const preserveManualDiagnosis =
    current.diagnosisManualOverride === true &&
    sameEpisodeForManualOverride &&
    !supersededManualDiagnosis;
  // A deliberate manual document correction (RUT/Pasaporte) survives subsequent Eloísa
  // synchronizations for this same episode without blocking clinical updates.
  const preserveManualDocument =
    current.documentManualOverride === true && sameEpisodeForManualOverride;
  // The legacy bridge does not send a document type. Its inferred RUT is not evidence
  // against an already-identified numeric passport for the same patient and episode.
  const preservePassport =
    current.documentType === 'Pasaporte' &&
    Boolean(current.rut) &&
    matchesCensusEpisodeIdentity(current, incoming) &&
    normalizePatientRut(current.rut) === normalizePatientRut(incoming.rut);
  // Letters make a source document a passport from new cases on (owner, 2026-11-12). A value the
  // mapper read as a RUT until then (no leading letter, no two letters in a row) leaves the
  // document stored for this episode as it is, also when it kept an inner K. Passport formats keep
  // their earlier repair.
  const preserveStoredRut =
    Boolean(normalizeRut(current.rut)) &&
    (!hasNonRutLetter(current.rut ?? '') || current.documentType !== 'Pasaporte') &&
    hasNonRutLetter(incoming.rut ?? '') &&
    !hasPassportShapeBeforeLetterRule(incoming.rut ?? '') &&
    matchesCensusEpisodeIdentity(current, incoming) &&
    normalizeRut(current.rut) === normalizeRut(incoming.rut);
  for (const field of SYNCABLE_FIELDS) {
    if (
      (preserveManualDocument || preservePassport || preserveStoredRut) &&
      (field === 'rut' || field === 'documentType')
    )
      continue;
    if (
      dismissedPhysician &&
      (field === 'treatingPhysicianId' || field === 'treatingPhysicianName')
    )
      continue;
    if (preserveManualDiagnosis && ['pathology', 'cie10Code', 'cie10Description'].includes(field))
      continue;
    const from = current[field];
    const to = incoming[field];
    if (field === 'clinicalEpisodeId' && !incoming.clinicalEpisodeId) continue;
    // Missing bridge coding is not an instruction to erase locally curated CIE-10 data.
    if ((field === 'cie10Code' || field === 'cie10Description') && !incoming.cie10Code) continue;
    // No Rayen assignment is not authoritative enough to erase a name-only physician selected
    // manually in HHR. Rayen-backed identities still follow the source when it removes them.
    if (
      field === 'treatingPhysicianName' &&
      !incoming.treatingPhysicianId &&
      !incoming.treatingPhysicianName &&
      !current.treatingPhysicianId &&
      current.treatingPhysicianName
    )
      continue;
    // A transient failure resolving the directory must not erase a previously verified display
    // name while Rayen still reports the exact same stable physician identity.
    if (
      field === 'treatingPhysicianName' &&
      incoming.treatingPhysicianId &&
      incoming.treatingPhysicianId === current.treatingPhysicianId &&
      !incoming.treatingPhysicianName &&
      current.treatingPhysicianName
    )
      continue;
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field, from, to });
  }
  if (
    supersededManualDiagnosis &&
    changes.some(change => ['pathology', 'cie10Code', 'cie10Description'].includes(change.field))
  ) {
    changes.push({ field: 'diagnosisManualOverride', from: true, to: undefined });
    if (current.diagnosisManualOverrideBase !== undefined) {
      changes.push({
        field: 'diagnosisManualOverrideBase',
        from: current.diagnosisManualOverrideBase,
        to: undefined,
      });
    }
  }
  if (
    incoming.neonatalMaternalRut &&
    current.neonatalMaternalRut !== incoming.neonatalMaternalRut
  ) {
    changes.push({
      field: 'neonatalMaternalRut',
      from: current.neonatalMaternalRut,
      to: incoming.neonatalMaternalRut,
    });
  }
  // Keep identity status consistent for this exact neonatal episode.
  if (
    (isNeonatalPatient(current) || isNeonatalPatient(incoming)) &&
    current.clinicalEpisodeId === incoming.clinicalEpisodeId &&
    incoming.identityStatus &&
    current.identityStatus !== incoming.identityStatus
  ) {
    changes.push({
      field: 'identityStatus',
      from: current.identityStatus,
      to: incoming.identityStatus,
    });
  }
  return changes;
};

export const mergeSyncablePatient = (current: PatientData, incoming: PatientData): PatientData => {
  const merged = { ...current };
  if (
    current.clinicalEpisodeId &&
    incoming.clinicalEpisodeId &&
    current.clinicalEpisodeId !== incoming.clinicalEpisodeId
  ) {
    delete merged.diagnosisManualOverride;
    delete merged.diagnosisManualOverrideBase;
    delete merged.documentManualOverride;
  }
  for (const change of diffSyncablePatientFields(current, incoming)) {
    if (
      (change.field === 'diagnosisManualOverride' ||
        change.field === 'diagnosisManualOverrideBase') &&
      change.to === undefined
    ) {
      delete merged[change.field];
      continue;
    }
    (merged as Record<string, unknown>)[change.field] = change.to;
  }
  return merged;
};

/** Preserve the fresh decision when applying a whole-crib update from an older preview. */
const preserveClinicalCribSpecialty = (
  current: PatientData | undefined,
  incoming: PatientData | undefined
): PatientData | undefined => {
  const sameCrib =
    current &&
    incoming &&
    (current.clinicalEpisodeId
      ? current.clinicalEpisodeId === incoming.clinicalEpisodeId
      : Boolean(
          normalizeRut(current.rut) &&
          isSameDocument(current.rut, incoming.rut) &&
          current.admissionDate &&
          current.admissionDate === incoming.admissionDate &&
          (current.admissionTime ?? '') === (incoming.admissionTime ?? '')
        ));
  const cribPreservesManualDiagnosis = Boolean(
    sameCrib &&
    current.diagnosisManualOverride === true &&
    !hasNewerSourceDiagnosisThanOverrideBase(current, incoming)
  );
  return sameCrib
    ? {
        ...incoming,
        specialty: current.specialty,
        specialtyAssignment: current.specialtyAssignment,
        ...(cribPreservesManualDiagnosis
          ? {
              pathology: current.pathology,
              cie10Code: current.cie10Code,
              cie10Description: current.cie10Description,
              diagnosisManualOverride: true,
              ...(current.diagnosisManualOverrideBase
                ? { diagnosisManualOverrideBase: current.diagnosisManualOverrideBase }
                : {}),
            }
          : {}),
        ...(current.documentManualOverride
          ? {
              rut: current.rut,
              documentType: current.documentType,
              documentManualOverride: true,
            }
          : {}),
      }
    : incoming;
};

/** Apply a reviewed diff without turning source suggestions into specialty decisions. */
export const applyReviewedPatientChanges = (
  current: PatientData,
  incoming: PatientData,
  changes: FieldChange[]
): PatientData => {
  const merged: Partial<Record<keyof PatientData, unknown>> = { ...current };
  if (
    changes.some(
      change =>
        change.field === 'clinicalEpisodeId' &&
        change.to &&
        current.clinicalEpisodeId &&
        change.to !== current.clinicalEpisodeId
    )
  ) {
    delete merged.diagnosisManualOverride;
    delete merged.diagnosisManualOverrideBase;
    delete merged.documentManualOverride;
  }
  const plannedDiagnosisOverrideClear = changes.some(
    change => change.field === 'diagnosisManualOverride' && change.to === undefined
  );
  const pathologyChange = changes.find(change => change.field === 'pathology');
  const cie10CodeChange = changes.find(change => change.field === 'cie10Code');
  const cie10DescriptionChange = changes.find(change => change.field === 'cie10Description');
  const postPreviewManualDiagnosisEdit =
    merged.diagnosisManualOverride === true &&
    (!plannedDiagnosisOverrideClear ||
      (pathologyChange !== undefined &&
        String(current.pathology ?? '') !== String(pathologyChange.from ?? '')) ||
      (cie10CodeChange !== undefined &&
        String(current.cie10Code ?? '') !== String(cie10CodeChange.from ?? '')) ||
      (cie10DescriptionChange !== undefined &&
        String(current.cie10Description ?? '') !== String(cie10DescriptionChange.from ?? '')));
  for (const change of changes) {
    if (
      postPreviewManualDiagnosisEdit &&
      [
        'pathology',
        'cie10Code',
        'cie10Description',
        'diagnosisManualOverride',
        'diagnosisManualOverrideBase',
      ].includes(change.field)
    )
      continue;
    if (
      (change.field === 'diagnosisManualOverride' ||
        change.field === 'diagnosisManualOverrideBase') &&
      change.to === undefined
    ) {
      delete merged[change.field];
      continue;
    }
    if (
      merged.documentManualOverride === true &&
      (change.field === 'rut' || change.field === 'documentType')
    )
      continue;
    if (change.field === 'specialty' || change.field === 'specialtyAssignment') continue;
    if (
      (change.field === 'treatingPhysicianId' || change.field === 'treatingPhysicianName') &&
      isDismissedTreatingPhysician(current, incoming)
    )
      continue;
    merged[change.field] =
      change.field === 'clinicalCrib'
        ? preserveClinicalCribSpecialty(current.clinicalCrib, change.to as PatientData | undefined)
        : change.to;
  }
  return merged as PatientData;
};
