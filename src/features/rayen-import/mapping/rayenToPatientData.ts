/**
 * Maps a normalized Rayen encounter to an HHR `PatientData`, reusing the
 * canonical `EMPTY_PATIENT` defaults so every required field is populated.
 *
 * Field-level mapping is documented in PLAN-SINCRONIZACION.md §2.1.
 */

import { EMPTY_PATIENT } from '@/constants/patient';
import { PatientStatus } from '@/types/domain/patientClassification';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { mapRayenBed } from './bedMapping';

/** Format a RUN as "14.470.055-4" from raw ("144700554") or already-formatted input. */
export const formatRun = (raw?: string): string => {
  const cleaned = (raw ?? '').replace(/[^0-9kK]/g, '');
  if (cleaned.length < 2) return (raw ?? '').trim();
  const dv = cleaned.slice(-1).toUpperCase();
  const body = cleaned.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${dv}`;
};

const parseIsoCalendarDate = (
  value?: string
): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const daysInUtcMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const utcDayNumber = (year: number, month: number, day: number): number =>
  Date.UTC(year, month, day) / 86_400_000;

const calendarMonthAnchor = (
  born: { year: number; month: number; day: number },
  completedMonths: number
): { year: number; month: number; day: number } => {
  const monthIndex = born.month + completedMonths;
  const year = born.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  return { year, month, day: Math.min(born.day, daysInUtcMonth(year, month)) };
};

/**
 * Clinically useful age between `birthDate` and `reference` (default: now).
 * Newborns use days; infants use months/days; toddlers use years/months; from four years onward
 * the existing whole-year representation is preserved.
 */
export const ageFromBirthDate = (birthDate?: string, reference: Date = new Date()): string => {
  const born = parseIsoCalendarDate(birthDate);
  if (!born || Number.isNaN(reference.getTime())) return '';

  const referenceYear = reference.getFullYear();
  const referenceMonth = reference.getMonth();
  const referenceDay = reference.getDate();
  const bornDayNumber = utcDayNumber(born.year, born.month, born.day);
  const referenceDayNumber = utcDayNumber(referenceYear, referenceMonth, referenceDay);
  if (referenceDayNumber < bornDayNumber) return '';

  let completedMonths = (referenceYear - born.year) * 12 + referenceMonth - born.month;
  const candidateAnchor = calendarMonthAnchor(born, completedMonths);
  if (
    referenceDayNumber <
    utcDayNumber(candidateAnchor.year, candidateAnchor.month, candidateAnchor.day)
  ) {
    completedMonths -= 1;
  }
  completedMonths = Math.max(0, completedMonths);

  const anchor = calendarMonthAnchor(born, completedMonths);
  const remainingDays = Math.max(
    0,
    referenceDayNumber - utcDayNumber(anchor.year, anchor.month, anchor.day)
  );

  if (completedMonths === 0) return `${referenceDayNumber - bornDayNumber}d`;
  if (completedMonths < 6) return `${completedMonths}m ${remainingDays}d`;
  if (completedMonths < 24) return `${completedMonths}m`;
  if (completedMonths < 48) {
    return `${Math.floor(completedMonths / 12)}a ${completedMonths % 12}m`;
  }
  return String(Math.floor(completedMonths / 12));
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

/**
 * Normalize a person name to "primera letra mayúscula, resto minúscula" per word
 * ("JUAN PÉREZ" or "juan pérez" → "Juan Pérez"). Rayen commonly returns names in
 * uppercase. Capitalizes the first letter after a space, hyphen or apostrophe, and is
 * accent-aware (á → Á).
 */
export const toTitleCaseName = (value?: string): string =>
  (value ?? '')
    .trim()
    // Colapsa espacios internos: los campos de nombre de Rayen llegan con
    // relleno y, al unirlos, el censo mostraba «Jorge  Urgencias Aroca».
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, sep: string, ch: string) => sep + ch.toUpperCase());

/**
 * Marcadores administrativos que Rayen deja dentro de los NOMBRES cuando el
 * paciente se registró en un punto de atención (típicamente un ingreso por
 * urgencias que después se completa con la identidad real). No son identidad
 * clínica y en el censo aparecían como un segundo nombre —«Jorge Urgencias
 * Aroca Benavides» por «Jorge Aroca Benavides» (reportado el 01-09, H2C2).
 *
 * La lista es EXACTA y por palabra completa, igual que el criterio de
 * `normalizeOptionalPersonName`: nunca se recorta una subcadena, para no
 * mutilar un nombre real que contenga estas letras.
 */
const ADMINISTRATIVE_NAME_TOKENS = new Set(['urgencia', 'urgencias', 'sapu']);

const stripAdministrativeNameTokens = (value: string): string =>
  value
    .split(' ')
    .filter(word => word && !ADMINISTRATIVE_NAME_TOKENS.has(word.toLowerCase()))
    .join(' ');

/** Nombres de pila ya normalizados (title case, sin relleno ni marcadores). */
export const composeRayenGivenNames = (firstGivenName?: string, nextGivenNames?: string): string =>
  stripAdministrativeNameTokens(
    toTitleCaseName([firstGivenName, nextGivenNames].filter(Boolean).join(' '))
  );

/**
 * Rayen sometimes serializes a missing optional surname as a display placeholder.
 * Placeholders are absence, not clinical identity data, so they must never be persisted in HHR.
 */
export const normalizeOptionalPersonName = (value?: string): string => {
  const normalized = toTitleCaseName(value);
  return /^(?:no\s*informad[oa]?|sin\s+informaci[oó]n)$/i.test(normalized) ? '' : normalized;
};

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
  /** True when this encounter occupies a crib attached to `bedId`. */
  isClinicalCrib: boolean;
  /** Resolved HHR bedId, or null if the Rayen location could not be mapped. */
  bedId: string | null;
}

export const rayenToPatientData = (
  encounter: RayenEncounter,
  reference: Date = new Date()
): MappedPatient => {
  const verifiedBedId = encounter.verifiedBedPlacement?.bedId;
  const { bedId, isCma, isClinicalCrib } = verifiedBedId
    ? mapRayenBed({ bed: verifiedBedId, service: encounter.service })
    : mapRayenBed({
        room: encounter.room,
        bed: encounter.bed,
        service: encounter.service,
        clinicalCribParentBedId: encounter.clinicalCribParentBedId,
      });

  // Los marcadores administrativos se podan de los NOMBRES (donde Rayen
  // concatena varios y donde apareció el caso real); los apellidos se
  // conservan tal cual para no arriesgar la identidad por un heurístico.
  const givenNames = composeRayenGivenNames(encounter.firstGivenName, encounter.nextGivenNames);
  const firstFamily = toTitleCaseName(encounter.firstFamilyName);
  const secondFamily = normalizeOptionalPersonName(encounter.secondFamilyName);
  const fullName = [givenNames, firstFamily, secondFamily].filter(Boolean).join(' ').trim();

  const patient: PatientData = {
    ...EMPTY_PATIENT,
    bedId: bedId ?? '',
    clinicalEpisodeId: encounter.encounterId,
    rut: formatRun(encounter.run),
    patientName: fullName,
    firstName: givenNames,
    lastName: firstFamily,
    secondLastName: secondFamily,
    birthDate: toIsoDate(encounter.birthDate),
    age: ageFromBirthDate(encounter.birthDate, reference),
    biologicalSex: mapBiologicalSex(encounter.administrativeSex, encounter.gender),
    pathology: cleanDiagnosis(encounter.diagnosis),
    cie10Code: encounter.diagnosisCode?.trim() || undefined,
    cie10Description: encounter.diagnosisCode?.trim()
      ? cleanDiagnosis(encounter.diagnosisDescription || encounter.diagnosis)
      : undefined,
    treatingPhysicianId: encounter.treatingPhysicianId?.trim() || undefined,
    treatingPhysicianName: encounter.treatingPhysicianId?.trim()
      ? encounter.treatingPhysicianName?.trim() || undefined
      : undefined,
    specialty: encounter.treatingPhysicianSpecialty?.trim() || EMPTY_PATIENT.specialty,
    admissionDate: toIsoDate(encounter.admissionDatetime),
    admissionTime: extractTime(encounter.admissionDatetime),
    // A synced patient defaults to "Estable"; `status` is not in SYNCABLE_FIELDS, so a re-sync
    // never overwrites the nurse's manual classification (Grave / De cuidado).
    status: PatientStatus.ESTABLE,
    // Sync never auto-classifies a patient as UPC (UCI/UTI): the bed being physically critical
    // does not make the patient a critical-care case — the nurse categorizes that in HHR. Default
    // to non-UPC and let it be set manually.
    isUPC: false,
    // Aislamiento (precaución de contacto/gotitas/aéreo): Ficha Médico lo marca por paciente.
    isIsolated: !!encounter.isIsolated,
    isolationType: encounter.isIsolated ? encounter.isolationType?.trim() || undefined : undefined,
    isolationMicroorganism: encounter.isIsolated
      ? encounter.isolationMicroorganism?.trim() || undefined
      : undefined,
    location: [encounter.service, encounter.room, encounter.bed].filter(Boolean).join(' / '),
    bedMode: isClinicalCrib ? 'Cuna' : EMPTY_PATIENT.bedMode,
    hasCompanionCrib: false,
  };

  return { patient, isCma, isClinicalCrib, bedId };
};
