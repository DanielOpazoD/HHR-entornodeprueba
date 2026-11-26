import type { PatientData } from '@/types/domain/patient';

export interface LegacyCensusObservation {
  otherActiveNames: Set<string>;
  siblingLegacySlots: Map<string, string | null>;
}

const IGNORED_SLOT_AND_NAME_KEYS = new Set([
  'bedId',
  'bedName',
  'location',
  'clinicalCrib',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'namePartsSource',
  'identityStatus',
]);

const isAccreditedEpisodeId = (episode: string): boolean =>
  Boolean(episode) && !episode.startsWith('legacy_ep_');

const normalizePatientNameKey = (name?: string): string =>
  (name ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const stableSerializeValue = (value: unknown, seen = new WeakSet<object>()): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object') return 'null';
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerializeValue(item, seen)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerializeValue(entryValue, seen)}`).join(',')}}`;
};

const hasOccupiedLegacyPayload = (subject: Partial<PatientData>): boolean =>
  Boolean(
    subject.clinicalEpisodeId?.trim() ||
    subject.patientName?.trim() ||
    subject.rut?.trim() ||
    subject.birthDate?.trim() ||
    subject.biologicalSex?.trim() ||
    subject.firstSeenDate?.trim() ||
    subject.admissionDate?.trim() ||
    subject.admissionTime?.trim() ||
    subject.neonatalMaternalRut?.trim() ||
    subject.isUPC ||
    subject.upcChecklist ||
    subject.pathology?.trim() ||
    subject.diagnosisComments?.trim() ||
    subject.status ||
    subject.devices?.length
  );

const serializeLegacySubjectRest = (subject: Partial<PatientData>): string => {
  const normalized: Record<string, unknown> = {
    documentType: subject.documentType?.trim() || 'RUT',
  };
  for (const [key, rawValue] of Object.entries(subject)) {
    if (IGNORED_SLOT_AND_NAME_KEYS.has(key) || rawValue === undefined) {
      continue;
    }
    if (key === 'documentType') {
      normalized.documentType = typeof rawValue === 'string' ? rawValue.trim() || 'RUT' : 'RUT';
      continue;
    }
    normalized[key] = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  }
  return stableSerializeValue(normalized);
};

const serializeNameParts = (subject: Partial<PatientData>): string =>
  stableSerializeValue([
    subject.firstName?.trim() || '',
    subject.lastName?.trim() || '',
    subject.secondLastName?.trim() || '',
    subject.namePartsSource || '',
    subject.identityStatus || '',
  ]);

/**
 * Fingerprints the patient occupying a clicked UPC cell even when the name is still empty
 * (e.g. a bed or crib with only RUT/document and clinicalEpisodeId) so turnover during a
 * deferred load or retry never opens the round on a replacement patient, while completing only
 * the name of the same accredited or legacy episode preserves the pending open.
 */
export const resolveUpcCellSubjectIdentity = (
  subject?: Partial<PatientData> | null
): string | null => {
  if (!subject) return null;
  const episode = subject.clinicalEpisodeId?.trim() || '';
  if (isAccreditedEpisodeId(episode)) {
    return episode;
  }
  if (!hasOccupiedLegacyPayload(subject)) {
    return null;
  }
  const docType = subject.documentType?.trim() || 'RUT';
  const rut = subject.rut?.trim() || '';
  const name = subject.patientName?.trim() || '';
  const nameParts = serializeNameParts(subject);
  const rest = serializeLegacySubjectRest(subject);
  return JSON.stringify(['legacy', episode, docType, rut, name, nameParts, rest]);
};

type LegacyUpcSubjectTuple = [
  tag: 'legacy',
  episode: string,
  docType: string,
  rut: string,
  name: string,
  nameParts: string,
  rest: string,
];

const parseLegacyUpcSubjectTuple = (identity: string | null): LegacyUpcSubjectTuple | null => {
  if (!identity || !identity.startsWith('["legacy",')) {
    return null;
  }
  try {
    return JSON.parse(identity) as LegacyUpcSubjectTuple;
  } catch {
    return null;
  }
};

export const isSameUpcCellSubjectIdentity = (
  expected: string | null,
  current: string | null
): boolean => {
  if (expected === current) return true;
  const expectedTuple = parseLegacyUpcSubjectTuple(expected);
  const currentTuple = parseLegacyUpcSubjectTuple(current);
  if (!expectedTuple || !currentTuple) {
    return false;
  }
  const [, expectedEpisode, expectedDocType, expectedRut, expectedName, , expectedRest] =
    expectedTuple;
  const [, currentEpisode, currentDocType, currentRut, currentName, , currentRest] = currentTuple;
  return (
    expectedName === '' &&
    currentName !== '' &&
    (expectedEpisode !== '' || expectedRut !== '') &&
    expectedEpisode === currentEpisode &&
    expectedDocType === currentDocType &&
    expectedRut === currentRut &&
    expectedRest === currentRest
  );
};

const getBedSlotSubject = (
  beds: Record<string, PatientData> | null | undefined,
  slotKey: string
): Partial<PatientData> | undefined => {
  if (!beds) return undefined;
  if (slotKey.endsWith(':crib')) {
    return beds[slotKey.slice(0, -':crib'.length)]?.clinicalCrib;
  }
  return beds[slotKey];
};

export const createEmptyLegacyCensusObservation = (): LegacyCensusObservation => ({
  otherActiveNames: new Set(),
  siblingLegacySlots: new Map(),
});

/**
 * Accumulates active names and sibling legacy slots observed across the census while a legacy
 * open is pending, including occupants that arrive after the initial click (e.g. a second twin
 * admitted to Neo 1 before swapping into the clicked crib).
 */
export const recordLegacyCensusObservation = (
  observation: LegacyCensusObservation,
  beds: Record<string, PatientData> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  expectedIdentity: string | null
): void => {
  if (!beds || !rawBedId) {
    return;
  }
  const expectedTuple = parseLegacyUpcSubjectTuple(expectedIdentity);
  const expectedEpisode = expectedTuple?.[1] ?? '';
  const expectedDocType = expectedTuple?.[2] ?? 'RUT';
  const expectedRut = expectedTuple?.[3] ?? '';
  const expectedNameKey = normalizePatientNameKey(expectedTuple?.[4]);
  const clickedSlotKey = isCrib ? `${rawBedId}:crib` : rawBedId;

  for (const [bedId, bed] of Object.entries(beds)) {
    const entries: Array<[string, Partial<PatientData> | undefined]> = [
      [bedId, bed],
      [`${bedId}:crib`, bed?.clinicalCrib],
    ];
    for (const [slotKey, subject] of entries) {
      if (slotKey === clickedSlotKey || !subject) continue;
      const normalizedName = normalizePatientNameKey(subject.patientName);
      if (normalizedName) {
        observation.otherActiveNames.add(normalizedName);
      }
      if (!expectedTuple) continue;
      const otherEpisode = subject.clinicalEpisodeId?.trim() || '';
      const otherDocType = subject.documentType?.trim() || 'RUT';
      const otherRut = subject.rut?.trim() || '';
      const sharesLegacyEpisode = Boolean(expectedEpisode && otherEpisode === expectedEpisode);
      const sharesDocument = Boolean(
        expectedRut && otherRut === expectedRut && otherDocType === expectedDocType
      );
      const sharesProvisionalName = Boolean(expectedNameKey && normalizedName === expectedNameKey);
      if (
        (sharesLegacyEpisode || sharesDocument || sharesProvisionalName) &&
        !observation.siblingLegacySlots.has(slotKey)
      ) {
        observation.siblingLegacySlots.set(slotKey, resolveUpcCellSubjectIdentity(subject));
      }
    }
  }
};

export const captureLegacyCensusObservation = (
  beds: Record<string, PatientData> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  expectedIdentity: string | null
): LegacyCensusObservation => {
  const observation = createEmptyLegacyCensusObservation();
  recordLegacyCensusObservation(observation, beds, rawBedId, isCrib, expectedIdentity);
  return observation;
};

export const hasLegacyCensusAmbiguity = (
  beds: Record<string, PatientData> | null | undefined,
  currentSubject: Partial<PatientData> | undefined,
  observation: LegacyCensusObservation,
  isNamingTransition: boolean
): boolean => {
  if (isNamingTransition) {
    const newNameKey = normalizePatientNameKey(currentSubject?.patientName);
    if (newNameKey && observation.otherActiveNames.has(newNameKey)) {
      return true;
    }
  }
  for (const [slotKey, initialIdentity] of observation.siblingLegacySlots.entries()) {
    const currentSiblingIdentity = resolveUpcCellSubjectIdentity(getBedSlotSubject(beds, slotKey));
    if (currentSiblingIdentity !== initialIdentity) {
      return true;
    }
  }
  return false;
};
