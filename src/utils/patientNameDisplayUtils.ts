/** Display only: preserve the stored identity and the casing of the rest of the name. */
export const formatCensusPatientName = (name: string): string => name.replace(/\brn\b/gi, 'RN');

const MAX_DISPLAYED_GIVEN_NAMES = 3;
// A particle opens the name that follows it: «de los Ángeles» counts as one given name.
const GIVEN_NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

const normalizeSpaces = (value: string | undefined): string =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

/** Keeps the first three given names; accents and case stay as stored. */
export const limitGivenNames = (givenNames: string | undefined): string => {
  const words = normalizeSpaces(givenNames).split(' ').filter(Boolean);
  const names: string[] = [];
  let pendingParticles: string[] = [];

  for (const word of words) {
    if (GIVEN_NAME_PARTICLES.has(word.toLocaleLowerCase('es'))) {
      pendingParticles.push(word);
      continue;
    }
    names.push([...pendingParticles, word].join(' '));
    pendingParticles = [];
  }
  if (pendingParticles.length > 0) {
    names.push(pendingParticles.join(' '));
  }

  return names.slice(0, MAX_DISPLAYED_GIVEN_NAMES).join(' ');
};

export interface PatientNameFields {
  patientName?: string;
  firstName?: string;
  lastName?: string;
  secondLastName?: string;
}

/**
 * Display only: the first three given names followed by both surnames. The limit applies only
 * when the stored given names and surnames agree with the full name; otherwise the stored full
 * name is shown whole, because guessing where the surnames start could cut one.
 */
export const formatPatientDisplayName = (patient: PatientNameFields): string => {
  const fullName = normalizeSpaces(patient.patientName);
  const givenNames = normalizeSpaces(patient.firstName);
  const surnames = [patient.lastName, patient.secondLastName].map(normalizeSpaces).filter(Boolean);
  const nameFromParts = [givenNames, ...surnames].filter(Boolean).join(' ');
  const partsMatchFullName =
    !fullName || nameFromParts.toLocaleLowerCase('es') === fullName.toLocaleLowerCase('es');

  if (!givenNames || !partsMatchFullName) {
    return fullName || nameFromParts;
  }

  return [limitGivenNames(givenNames), ...surnames].join(' ');
};
