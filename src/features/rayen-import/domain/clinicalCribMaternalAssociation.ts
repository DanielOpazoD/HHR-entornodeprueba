import type { PatientData } from '@/types/domain/patient';

import { mapRayenBed } from '../mapping/bedMapping';
import { isPassportFormat, isValidRut, normalizeRut } from '@/utils/rutUtils';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

import type { MappedPatient } from '../mapping/rayenToPatientData';

export interface MappedClinicalEncounter {
  encounter: RayenEncounter;
  mapped: MappedPatient;
  originatedAsClinicalCrib?: boolean;
  maternalAssociationConflict?: 'ambiguous' | 'unmatched' | 'location-mismatch';
  usesMaternalRun?: boolean;
  maternalAssociationBedId?: string;
}

const nameKey = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Exact full name or first-given/first-family alias; no fuzzy matching and no bed tie-break. */
const maternalAlias = (candidate: MappedClinicalEncounter): string | undefined => {
  const first = candidate.mapped.patient.firstName?.trim().split(/\s+/)[0] ?? '';
  const family = candidate.mapped.patient.lastName ?? '';
  return nameKey(first) && nameKey(family) ? `${first} ${family}` : undefined;
};

/** The fields that tell a newborn apart; census and CUDYR report rows both carry them. */
interface NeonatalSignals {
  bedMode?: string;
  neonatalPlacementDecision?: unknown;
  neonatalMaternalRut?: string;
  patientName?: string;
  age?: string;
}

/** Known RN labels/decisions and neonatal age prove the role, never the physical bed alone. */
export const isNeonatalPatient = (patient: NeonatalSignals): boolean =>
  patient.bedMode === 'Cuna' ||
  Boolean(patient.neonatalPlacementDecision || patient.neonatalMaternalRut) ||
  /^RN\s+de\b/i.test(patient.patientName ?? '') ||
  /^\d+d$/.test(patient.age ?? '');
/**
 * Eloísa opens a newborn's episode at birth, before Registro Civil issues a RUN, and may show a
 * delivery-receipt folio or a typo as its identification. For a newborn, a number that is neither
 * a valid RUN nor a passport is never the child's own document.
 */
export const isUnusableNewbornRun = (run: string): boolean =>
  Boolean(run.trim()) && !isPassportFormat(run) && !isValidRut(run);

/** A newborn's own document, leaving out a stored number that cannot be one. */
export const newbornOwnRut = (
  patient: NeonatalSignals & { rut?: string; documentType?: string }
): string =>
  isNeonatalPatient(patient) &&
  patient.documentType !== 'Pasaporte' &&
  isUnusableNewbornRun(patient.rut ?? '')
    ? ''
    : (patient.rut ?? '');

export const isMaternalCandidatePatient = (patient: PatientData): boolean =>
  !isNeonatalPatient(patient) && !patient.isBlocked && patient.biologicalSex !== 'Masculino';

export const associateClinicalCribsWithMothers = (
  candidates: MappedClinicalEncounter[],
  localNameFor: (candidate: MappedClinicalEncounter) => string | undefined,
  knownMotherFor: (candidate: MappedClinicalEncounter) =>
    | {
        episodeId: string;
        bedId: string;
        rut: string;
        reviewed?: boolean;
        sourceRun?: string;
        sourcePlacementKey?: string;
        sourceRunIsMaternal?: boolean;
        parentConflict?: boolean;
      }
    | undefined,
  maternalCandidates: MappedClinicalEncounter[] = candidates
): MappedClinicalEncounter[] => {
  const mothers = maternalCandidates.filter(
    ({ mapped, originatedAsClinicalCrib }) =>
      !originatedAsClinicalCrib &&
      !mapped.isClinicalCrib &&
      mapped.bedId &&
      isMaternalCandidatePatient(mapped.patient)
  );
  return candidates.map(candidate => {
    if (!candidate.mapped.isClinicalCrib) return candidate;
    // Some legacy RN episodes carry the progenitor RUN. A child's own RUN never
    // matches a principal patient and therefore falls through to the RN-de name.
    const run = candidate.encounter.run;
    const reviewedMother = knownMotherFor(candidate);
    if (reviewedMother?.parentConflict)
      return { ...candidate, maternalAssociationConflict: 'ambiguous' };
    const byRun = isValidRut(run)
      ? mothers.filter(mother => normalizeRut(mother.encounter.run) === normalizeRut(run))
      : [];
    if (reviewedMother?.reviewed) {
      const foreignMother = byRun.some(
        mother => mother.encounter.encounterId !== reviewedMother.episodeId
      );
      if (foreignMother && normalizeRut(reviewedMother.sourceRun ?? '') !== normalizeRut(run))
        return { ...candidate, maternalAssociationConflict: 'ambiguous' };
      const mother = mothers.find(m => m.encounter.encounterId === reviewedMother.episodeId);
      const bedId = mother?.mapped.bedId ?? reviewedMother.bedId;
      const sourcePlacement = mapRayenBed(candidate.encounter);
      const sourceKey = `${sourcePlacement.bedId ?? ''}:cuna`;
      if (
        sourcePlacement.bedId &&
        sourcePlacement.bedId !== bedId &&
        sourceKey !== reviewedMother.sourcePlacementKey
      )
        return {
          ...candidate,
          maternalAssociationConflict: 'location-mismatch',
          maternalAssociationBedId: bedId,
        };
      return {
        ...candidate,
        usesMaternalRun:
          isValidRut(run) &&
          (normalizeRut(run) === normalizeRut(reviewedMother.rut) ||
            (reviewedMother.sourceRunIsMaternal === true &&
              normalizeRut(run) === normalizeRut(reviewedMother.sourceRun ?? ''))),
        mapped: { ...candidate.mapped, bedId, patient: { ...candidate.mapped.patient, bedId } },
      };
    }
    const motherName = /^\s*RN\s+de\s+(.+)$/i.exec(candidate.mapped.patient.patientName)?.[1];
    const key = motherName ? nameKey(motherName) : '';
    const matches = byRun.length
      ? byRun
      : key
        ? mothers.filter(mother =>
            [mother.mapped.patient.patientName, localNameFor(mother), maternalAlias(mother)].some(
              name => name && nameKey(name) === key
            )
          )
        : [];
    if (matches.length > 1) return { ...candidate, maternalAssociationConflict: 'ambiguous' };
    if (!matches.length) {
      // Preserve a relationship already stored for this exact RN episode. A missing
      // active mother can be awaiting her administrative discharge in this same diff.
      const knownMother = knownMotherFor(candidate);
      if (!knownMother) return { ...candidate, maternalAssociationConflict: 'unmatched' };
      const activeMother = mothers.find(m => m.encounter.encounterId === knownMother.episodeId);
      const bedId = activeMother?.mapped.bedId ?? knownMother.bedId;
      const sourcePlacement = mapRayenBed(candidate.encounter);
      if (sourcePlacement.bedId && sourcePlacement.bedId !== bedId)
        return {
          ...candidate,
          maternalAssociationConflict: 'location-mismatch',
          maternalAssociationBedId: bedId,
        };
      return {
        ...candidate,
        usesMaternalRun: isValidRut(run) && normalizeRut(run) === normalizeRut(knownMother.rut),
        mapped: { ...candidate.mapped, bedId, patient: { ...candidate.mapped.patient, bedId } },
      };
    }
    const bedId = matches[0].mapped.bedId!;
    const sourcePlacement = mapRayenBed(candidate.encounter);
    if (sourcePlacement.bedId && sourcePlacement.bedId !== bedId)
      return {
        ...candidate,
        maternalAssociationConflict: 'location-mismatch',
        maternalAssociationBedId: bedId,
      };
    return {
      ...candidate,
      usesMaternalRun: byRun.length === 1,
      mapped: { ...candidate.mapped, bedId, patient: { ...candidate.mapped.patient, bedId } },
    };
  });
};
