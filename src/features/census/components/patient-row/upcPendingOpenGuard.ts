import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

export interface UpcCellSubjectLike {
  patientName?: string;
  clinicalEpisodeId?: string;
  documentType?: 'RUT' | 'Pasaporte' | string;
  rut?: string;
  birthDate?: string;
  biologicalSex?: string;
  neonatalMaternalRut?: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
  isUPC?: boolean;
  upcChecklist?: UpcChecklistRecord;
  pathology?: string;
  specialty?: string;
  age?: string;
  diagnosisComments?: string;
}

export interface BedWithOptionalCrib extends UpcCellSubjectLike {
  clinicalCrib?: UpcCellSubjectLike;
}

export interface UnnamedLegacyCensusSnapshot {
  otherActiveNames: Set<string>;
  siblingLegacySlots: Map<string, string | null>;
}

const isAccreditedEpisodeId = (episode: string): boolean =>
  Boolean(episode) && !episode.startsWith('legacy_ep_');

const normalizePatientNameKey = (name?: string): string =>
  (name ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const stableSerializeValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerializeValue(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Fingerprints the patient occupying a clicked UPC cell even when the name is still empty
 * (e.g. a bed or crib with only RUT/document and clinicalEpisodeId) so turnover during a
 * deferred load or retry never opens the round on a replacement patient, while completing only
 * the name of the same accredited or legacy episode preserves the pending open.
 */
export const resolveUpcCellSubjectIdentity = (
  subject?: UpcCellSubjectLike | null
): string | null => {
  if (!subject) return null;
  const episode = subject.clinicalEpisodeId?.trim() || '';
  if (isAccreditedEpisodeId(episode)) {
    return episode;
  }
  const docType = subject.documentType?.trim() || 'RUT';
  const name = subject.patientName?.trim() || '';
  const rut = subject.rut?.trim() || '';
  const birthDate = subject.birthDate?.trim() || '';
  const biologicalSex = subject.biologicalSex?.trim() || '';
  const firstSeenDate = subject.firstSeenDate?.trim() || '';
  const admissionDate = subject.admissionDate?.trim() || '';
  const admissionTime = subject.admissionTime?.trim() || '';
  const maternalRut = subject.neonatalMaternalRut?.trim() || '';
  const upcState = stableSerializeValue([Boolean(subject.isUPC), subject.upcChecklist ?? null]);
  const clinicalContext = stableSerializeValue([
    subject.pathology?.trim() || '',
    subject.specialty?.trim() || '',
    subject.age?.trim() || '',
    subject.diagnosisComments?.trim() || '',
  ]);
  if (
    !episode &&
    !name &&
    !rut &&
    !birthDate &&
    !biologicalSex &&
    !firstSeenDate &&
    !admissionDate &&
    !admissionTime &&
    !maternalRut &&
    !subject.isUPC &&
    !subject.upcChecklist &&
    !subject.pathology?.trim()
  ) {
    return null;
  }
  return JSON.stringify([
    'legacy',
    episode,
    docType,
    rut,
    name,
    birthDate,
    biologicalSex,
    firstSeenDate,
    admissionDate,
    admissionTime,
    maternalRut,
    upcState,
    clinicalContext,
  ]);
};

type LegacyUpcSubjectTuple = [
  tag: 'legacy',
  episode: string,
  docType: string,
  rut: string,
  name: string,
  birthDate: string,
  biologicalSex: string,
  firstSeenDate: string,
  admissionDate: string,
  admissionTime: string,
  maternalRut: string,
  upcState: string,
  clinicalContext: string,
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
  const [
    ,
    expectedEpisode,
    expectedDocType,
    expectedRut,
    expectedName,
    expectedBirthDate,
    expectedBiologicalSex,
    expectedFirstSeenDate,
    expectedAdmissionDate,
    expectedTime,
    expectedMaternalRut,
    expectedUpcState,
    expectedClinicalContext,
  ] = expectedTuple;
  const [
    ,
    currentEpisode,
    currentDocType,
    currentRut,
    currentName,
    currentBirthDate,
    currentBiologicalSex,
    currentFirstSeenDate,
    currentAdmissionDate,
    currentTime,
    currentMaternalRut,
    currentUpcState,
    currentClinicalContext,
  ] = currentTuple;
  return (
    expectedName === '' &&
    currentName !== '' &&
    (expectedEpisode !== '' || expectedRut !== '') &&
    expectedEpisode === currentEpisode &&
    expectedDocType === currentDocType &&
    expectedRut === currentRut &&
    expectedBirthDate === currentBirthDate &&
    expectedBiologicalSex === currentBiologicalSex &&
    expectedFirstSeenDate === currentFirstSeenDate &&
    expectedAdmissionDate === currentAdmissionDate &&
    expectedTime === currentTime &&
    expectedMaternalRut === currentMaternalRut &&
    expectedUpcState === currentUpcState &&
    expectedClinicalContext === currentClinicalContext
  );
};

const getBedSlotSubject = (
  beds: Record<string, BedWithOptionalCrib> | null | undefined,
  slotKey: string
): UpcCellSubjectLike | undefined => {
  if (!beds) return undefined;
  if (slotKey.endsWith(':crib')) {
    return beds[slotKey.slice(0, -':crib'.length)]?.clinicalCrib;
  }
  return beds[slotKey];
};

export const createEmptyUnnamedLegacySnapshot = (): UnnamedLegacyCensusSnapshot => ({
  otherActiveNames: new Set(),
  siblingLegacySlots: new Map(),
});

/**
 * Accumulates active names and sibling legacy slots observed across the census while an unnamed
 * legacy open is pending, including occupants that arrive after the initial click (e.g. a second
 * twin admitted to Neo 1 before swapping into the clicked crib).
 */
export const recordUnnamedLegacyCensusObservation = (
  snapshot: UnnamedLegacyCensusSnapshot,
  beds: Record<string, BedWithOptionalCrib> | null | undefined,
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
  const clickedSlotKey = isCrib ? `${rawBedId}:crib` : rawBedId;

  for (const [bedId, bed] of Object.entries(beds)) {
    const entries: Array<[string, UpcCellSubjectLike | undefined]> = [
      [bedId, bed],
      [`${bedId}:crib`, bed?.clinicalCrib],
    ];
    for (const [slotKey, subject] of entries) {
      if (slotKey === clickedSlotKey || !subject) continue;
      const normalizedName = normalizePatientNameKey(subject.patientName);
      if (normalizedName) {
        snapshot.otherActiveNames.add(normalizedName);
      }
      if (!expectedTuple) continue;
      const otherEpisode = subject.clinicalEpisodeId?.trim() || '';
      const otherDocType = subject.documentType?.trim() || 'RUT';
      const otherRut = subject.rut?.trim() || '';
      const sharesLegacyEpisode = Boolean(expectedEpisode && otherEpisode === expectedEpisode);
      const sharesDocument = Boolean(
        expectedRut && otherRut === expectedRut && otherDocType === expectedDocType
      );
      if ((sharesLegacyEpisode || sharesDocument) && !snapshot.siblingLegacySlots.has(slotKey)) {
        snapshot.siblingLegacySlots.set(slotKey, resolveUpcCellSubjectIdentity(subject));
      }
    }
  }
};

export const captureUnnamedLegacyCensusSnapshot = (
  beds: Record<string, BedWithOptionalCrib> | null | undefined,
  rawBedId: string | null,
  isCrib: boolean,
  expectedIdentity: string | null
): UnnamedLegacyCensusSnapshot => {
  const snapshot = createEmptyUnnamedLegacySnapshot();
  recordUnnamedLegacyCensusObservation(snapshot, beds, rawBedId, isCrib, expectedIdentity);
  return snapshot;
};

export const hasUnnamedLegacyNamingAmbiguity = (
  beds: Record<string, BedWithOptionalCrib> | null | undefined,
  currentSubject: UpcCellSubjectLike | undefined,
  snapshot: UnnamedLegacyCensusSnapshot
): boolean => {
  const newNameKey = normalizePatientNameKey(currentSubject?.patientName);
  if (newNameKey && snapshot.otherActiveNames.has(newNameKey)) {
    return true;
  }
  for (const [slotKey, initialIdentity] of snapshot.siblingLegacySlots.entries()) {
    const currentSiblingIdentity = resolveUpcCellSubjectIdentity(getBedSlotSubject(beds, slotKey));
    if (currentSiblingIdentity !== initialIdentity) {
      return true;
    }
  }
  return false;
};
