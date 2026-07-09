/**
 * Maps a normalized Rayen encounter to an HHR `PatientData`, reusing the
 * canonical `EMPTY_PATIENT` defaults so every required field is populated.
 *
 * Field-level mapping is documented in PLAN-SINCRONIZACION.md §2.1.
 */

import { EMPTY_PATIENT } from '@/constants/patient';
import { UTI_BEDS } from '@/constants/beds';
import type { PatientData } from '@/types/domain/patient';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { mapRayenBed } from './bedMapping';

const UTI_BED_IDS = new Set(UTI_BEDS.map(bed => bed.id));

/** Format a RUN as "14.470.055-4" from raw ("144700554") or already-formatted input. */
export const formatRun = (raw?: string): string => {
  const cleaned = (raw ?? '').replace(/[^0-9kK]/g, '');
  if (cleaned.length < 2) return (raw ?? '').trim();
  const dv = cleaned.slice(-1).toUpperCase();
  const body = cleaned.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${dv}`;
};

/** Whole years between `birthDate` and `reference` (default: now). Empty string if unknown. */
export const ageFromBirthDate = (birthDate?: string, reference: Date = new Date()): string => {
  if (!birthDate) return '';
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return '';
  let years = reference.getFullYear() - born.getFullYear();
  const monthDelta = reference.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getDate() < born.getDate())) years -= 1;
  return years >= 0 ? String(years) : '';
};

/** Rayen exposes administrative sex ("Mujer"/"Hombre") and gender ("Femenina"/"Masculino"). */
export const mapBiologicalSex = (
  administrativeSex?: string,
  gender?: string
): PatientData['biologicalSex'] => {
  const value = `${administrativeSex ?? ''} ${gender ?? ''}`.toLowerCase();
  if (/(mujer|femenin)/.test(value)) return 'Femenino';
  if (/(hombre|masculin)/.test(value)) return 'Masculino';
  return 'Indeterminado';
};

/** Strip Rayen's trailing "(Ingreso) (solicitud hospitalización)"-style suffixes. */
export const cleanDiagnosis = (diagnosis?: string): string =>
  (diagnosis ?? '')
    .replace(/\s*\((?:ingreso|solicitud[^)]*)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Extract "HH:MM" from an ISO datetime, if present. */
export const extractTime = (isoDatetime?: string): string => {
  if (!isoDatetime) return '';
  const match = /T(\d{2}:\d{2})/.exec(isoDatetime);
  return match ? match[1] : '';
};

const toIsoDate = (isoDatetime?: string): string => (isoDatetime ? isoDatetime.slice(0, 10) : '');

export interface MappedPatient {
  patient: PatientData;
  /** True when the encounter comes from the CMA virtual service. */
  isCma: boolean;
  /** Resolved HHR bedId, or null if the Rayen location could not be mapped. */
  bedId: string | null;
}

export const rayenToPatientData = (
  encounter: RayenEncounter,
  reference: Date = new Date()
): MappedPatient => {
  const { bedId, isCma } = mapRayenBed({
    room: encounter.room,
    bed: encounter.bed,
    service: encounter.service,
  });

  const givenNames = [encounter.firstGivenName, encounter.nextGivenNames]
    .filter(Boolean)
    .join(' ')
    .trim();
  const fullName = [givenNames, encounter.firstFamilyName, encounter.secondFamilyName]
    .filter(Boolean)
    .join(' ')
    .trim();

  const patient: PatientData = {
    ...EMPTY_PATIENT,
    bedId: bedId ?? '',
    clinicalEpisodeId: encounter.encounterId,
    rut: formatRun(encounter.run),
    patientName: fullName,
    firstName: givenNames,
    lastName: encounter.firstFamilyName ?? '',
    secondLastName: encounter.secondFamilyName ?? '',
    birthDate: toIsoDate(encounter.birthDate),
    age: ageFromBirthDate(encounter.birthDate, reference),
    biologicalSex: mapBiologicalSex(encounter.administrativeSex, encounter.gender),
    pathology: cleanDiagnosis(encounter.diagnosis),
    admissionDate: toIsoDate(encounter.admissionDatetime),
    admissionTime: extractTime(encounter.admissionDatetime),
    isUPC: bedId ? UTI_BED_IDS.has(bedId) : false,
    location: [encounter.service, encounter.room, encounter.bed].filter(Boolean).join(' / '),
  };

  return { patient, isCma, bedId };
};
