import type { PatientData } from '@/types/domain/patient';
import { documentIdentityKey, hasNonRutLetter } from '@/utils/rutUtils';

export interface LegacyCensusObservation {
  otherActiveNames: Set<string>;
  otherSlotIdentities: Map<string, string>;
  subjectStartedUnnamed: boolean;
  pairedStartedUnnamed: boolean;
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

const hasContiguousTokenSequence = (haystackKey: string, needleKey: string): boolean => {
  const haystackTokens = haystackKey.split(' ').filter(Boolean);
  const needleTokens = needleKey.split(' ').filter(Boolean);
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) {
    return false;
  }
  for (let start = 0; start <= haystackTokens.length - needleTokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needleTokens.length; offset += 1) {
      if (haystackTokens[start + offset] !== needleTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
};

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

const hasOccupiedLegacyPayload = (subject: Partial<PatientData>): boolean => {
  const normalizedSex = subject.biologicalSex?.trim() || '';
  return Boolean(
    subject.clinicalEpisodeId?.trim() ||
    subject.patientName?.trim() ||
    subject.firstName?.trim() ||
    subject.lastName?.trim() ||
    subject.secondLastName?.trim() ||
    subject.rut?.trim() ||
    subject.birthDate?.trim() ||
    (normalizedSex && normalizedSex !== 'Indeterminado') ||
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
};

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

export const isLegacyUpcSubjectIdentity = (identity: string | null): boolean =>
  parseLegacyUpcSubjectTuple(identity) !== null;

const hasAnyNamedPart = (namePartsJson: string): boolean => {
  try {
    const [first, last, secondLast] = JSON.parse(namePartsJson) as [
      string,
      string,
      string,
      string,
      string,
    ];
    return Boolean(
      normalizePatientNameKey(first) ||
      normalizePatientNameKey(last) ||
      normalizePatientNameKey(secondLast)
    );
  } catch {
    return false;
  }
};

const areNamedPartsConsistentWithNaming = (
  expectedNamePartsJson: string,
  currentNamePartsJson: string,
  currentPatientName: string
): boolean => {
  try {
    const [expectedFirst, expectedLast, expectedSecondLast] = JSON.parse(expectedNamePartsJson) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const [currentFirst, currentLast, currentSecondLast] = JSON.parse(currentNamePartsJson) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const normalizedCurrentName = normalizePatientNameKey(currentPatientName);
    const pairs: Array<[string, string]> = [
      [expectedFirst, currentFirst],
      [expectedLast, currentLast],
      [expectedSecondLast, currentSecondLast],
    ];
    for (const [expectedPart, currentPart] of pairs) {
      const expectedKey = normalizePatientNameKey(expectedPart);
      if (!expectedKey) continue;
      const currentKey = normalizePatientNameKey(currentPart);
      if (currentKey && currentKey !== expectedKey) {
        return false;
      }
      if (!hasContiguousTokenSequence(normalizedCurrentName, expectedKey)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
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
  const [
    ,
    expectedEpisode,
    expectedDocType,
    expectedRut,
    expectedName,
    expectedNameParts,
    expectedRest,
  ] = expectedTuple;
  const [, currentEpisode, currentDocType, currentRut, currentName, currentNameParts, currentRest] =
    currentTuple;
  return (
    expectedName === '' &&
    currentName !== '' &&
    (expectedEpisode !== '' || expectedRut !== '' || hasAnyNamedPart(expectedNameParts)) &&
    expectedEpisode === currentEpisode &&
    expectedDocType === currentDocType &&
    expectedRut === currentRut &&
    expectedRest === currentRest &&
    areNamedPartsConsistentWithNaming(expectedNameParts, currentNameParts, currentName)
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

const createEmptyLegacyCensusObservation = (): LegacyCensusObservation => ({
  otherActiveNames: new Set(),
  otherSlotIdentities: new Map(),
  subjectStartedUnnamed: false,
  pairedStartedUnnamed: false,
});

const resolveIdentifiableDocumentKey = (rawDocType?: string, rawValue?: string): string => {
  const value = rawValue?.trim() ?? '';
  if (!value) return '';
  const trimmedType = rawDocType?.trim() || 'RUT';
  const normalizedType = trimmedType.toLowerCase() === 'pasaporte' ? 'Pasaporte' : trimmedType;
  if (normalizedType === 'Pasaporte') {
    const key = documentIdentityKey(value);
    if (!key) return '';
    const core = key.startsWith('passport:') ? key.slice('passport:'.length) : key;
    if (core.length < 2 || /^0+$/.test(core)) return '';
    return `Pasaporte:${key}`;
  }
  if (hasNonRutLetter(value)) return '';
  const key = documentIdentityKey(value);
  if (key.length < 2 || /^0+$/.test(key)) return '';
  return `${normalizedType}:${key}`;
};

const arePairedSubjectsDistinguishedByIdentity = (
  expectedTuple: LegacyUpcSubjectTuple,
  pairedSubject: Partial<PatientData> | undefined
): boolean => {
  if (!pairedSubject) return false;
  const pairedIdentity = resolveUpcCellSubjectIdentity(pairedSubject);
  if (pairedIdentity && !isLegacyUpcSubjectIdentity(pairedIdentity)) {
    return true;
  }
  const expectedKey = resolveIdentifiableDocumentKey(expectedTuple[2], expectedTuple[3]);
  const pairedKey = resolveIdentifiableDocumentKey(pairedSubject.documentType, pairedSubject.rut);
  return Boolean(expectedKey && pairedKey && expectedKey !== pairedKey);
};

/**
 * Snapshots or updates observed census occupancy while a legacy (unaccredited) open is pending.
 *
 * When `isInitialCapture` is true, records every currently occupied other slot (excluding the
 * clicked slot and its paired mother/crib slot, which is validated directly). On subsequent
 * renders that already passed ambiguity validation, latches any unrelated slot's valid
 * empty-to-named transition monotonically and records newly observed names.
 */
export const recordLegacyCensusObservation = (
  observation: LegacyCensusObservation,
  beds: Record<string, PatientData> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  expectedIdentity: string | null,
  pairedSlotKey: string | null = null,
  isInitialCapture = false
): void => {
  if (!beds || !rawBedId) {
    return;
  }
  const expectedTuple = parseLegacyUpcSubjectTuple(expectedIdentity);
  const clickedSlotKey = isCrib ? `${rawBedId}:crib` : rawBedId;
  if (isInitialCapture) {
    observation.subjectStartedUnnamed = Boolean(expectedTuple && expectedTuple[4] === '');
  }

  for (const [bedId, bed] of Object.entries(beds)) {
    const entries: Array<[string, Partial<PatientData> | undefined]> = [
      [bedId, bed],
      [`${bedId}:crib`, bed?.clinicalCrib],
    ];
    for (const [slotKey, subject] of entries) {
      if (slotKey === clickedSlotKey || !subject) continue;
      const normalizedName = normalizePatientNameKey(subject.patientName);
      const skipDistinctPairedName = Boolean(
        slotKey === pairedSlotKey &&
        expectedTuple &&
        arePairedSubjectsDistinguishedByIdentity(expectedTuple, subject)
      );
      if (normalizedName && !skipDistinctPairedName) {
        observation.otherActiveNames.add(normalizedName);
      }
      if (!expectedTuple) continue;
      if (slotKey === pairedSlotKey) {
        if (isInitialCapture) {
          observation.pairedStartedUnnamed = !normalizedName;
        }
        if (isCrib) continue;
        const slotIdentity = resolveUpcCellSubjectIdentity(subject);
        if (isInitialCapture) {
          if (slotIdentity !== null) {
            observation.otherSlotIdentities.set(slotKey, slotIdentity);
          }
        } else if (slotIdentity !== null && observation.otherSlotIdentities.has(slotKey)) {
          observation.otherSlotIdentities.set(slotKey, slotIdentity);
        }
        continue;
      }
      if (isInitialCapture) {
        const slotIdentity = resolveUpcCellSubjectIdentity(subject);
        if (slotIdentity !== null) {
          observation.otherSlotIdentities.set(slotKey, slotIdentity);
        }
      }
    }
  }
};

export const captureLegacyCensusObservation = (
  beds: Record<string, PatientData> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  expectedIdentity: string | null,
  pairedSlotKey: string | null = null
): LegacyCensusObservation => {
  const observation = createEmptyLegacyCensusObservation();
  recordLegacyCensusObservation(
    observation,
    beds,
    rawBedId,
    isCrib,
    expectedIdentity,
    pairedSlotKey,
    true
  );
  return observation;
};

/**
 * Accredited episodes never trigger census-wide ambiguity checks. For legacy (unaccredited)
 * subjects, any admission, vacating, swap, or legacy identity mutation (including simultaneous
 * naming of an unnamed sibling) in another census slot while the deferred open or retry is
 * pending cancels the open rather than risking selecting a sibling or replacement patient.
 * Routine clinical edits on other already-accredited beds keep the same accredited episode ID
 * and therefore do not cancel.
 */
export const hasLegacyCensusAmbiguity = (
  beds: Record<string, PatientData> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  pairedSlotKey: string | null,
  expectedIdentity: string | null,
  currentSubject: Partial<PatientData> | undefined,
  observation: LegacyCensusObservation,
  isNamingTransition: boolean
): boolean => {
  const currentNameKey = normalizePatientNameKey(currentSubject?.patientName);
  if (isNamingTransition && currentNameKey && observation.otherActiveNames.has(currentNameKey)) {
    return true;
  }
  const expectedTuple = parseLegacyUpcSubjectTuple(expectedIdentity);
  if (!beds || !rawBedId || !expectedTuple) {
    return false;
  }
  const clickedSlotKey = isCrib ? `${rawBedId}:crib` : rawBedId;
  const seenSlots = new Set<string>();

  for (const [bedId, bed] of Object.entries(beds)) {
    const entries: Array<[string, Partial<PatientData> | undefined]> = [
      [bedId, bed],
      [`${bedId}:crib`, bed?.clinicalCrib],
    ];
    for (const [slotKey, subject] of entries) {
      if (slotKey === clickedSlotKey) continue;
      if (slotKey === pairedSlotKey) {
        const pairedNameKey = normalizePatientNameKey(subject?.patientName);
        const hasPendingPairedNaming =
          observation.subjectStartedUnnamed || observation.pairedStartedUnnamed;
        if (
          hasPendingPairedNaming &&
          !arePairedSubjectsDistinguishedByIdentity(expectedTuple, subject) &&
          currentNameKey &&
          pairedNameKey &&
          pairedNameKey === currentNameKey
        ) {
          return true;
        }
        if (isCrib) continue;
        seenSlots.add(slotKey);
        const currentPairedIdentity = resolveUpcCellSubjectIdentity(subject);
        const initialPairedIdentity = observation.otherSlotIdentities.get(slotKey) ?? null;
        if (
          currentPairedIdentity !== initialPairedIdentity &&
          !isSameUpcCellSubjectIdentity(initialPairedIdentity, currentPairedIdentity)
        ) {
          return true;
        }
        continue;
      }
      seenSlots.add(slotKey);
      const currentOtherIdentity = resolveUpcCellSubjectIdentity(subject);
      const initialOtherIdentity = observation.otherSlotIdentities.get(slotKey) ?? null;
      if (currentOtherIdentity !== initialOtherIdentity) {
        return true;
      }
    }
  }

  for (const slotKey of observation.otherSlotIdentities.keys()) {
    if (!seenSlots.has(slotKey)) {
      const currentOtherIdentity = resolveUpcCellSubjectIdentity(getBedSlotSubject(beds, slotKey));
      if (currentOtherIdentity === null) {
        return true;
      }
    }
  }

  return false;
};
