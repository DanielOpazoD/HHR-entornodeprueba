import type { PatientData } from '@/types/domain/patient';
import { documentIdentityKey, isValidRut } from '@/utils/rutUtils';
import {
  isLegacyUpcSubjectIdentity,
  isSameUpcCellSubjectIdentity,
  normalizePatientNameKey,
  parseLegacyUpcSubjectTuple,
  resolveUpcCellSubjectIdentity,
  type LegacyUpcSubjectTuple,
} from './upcCellSubjectIdentity';

export interface LegacyCensusObservation {
  otherActiveNames: Set<string>;
  otherSlotIdentities: Map<string, string>;
  subjectStartedUnnamed: boolean;
  pairedStartedUnnamed: boolean;
}

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
    const rawCore = key.startsWith('passport:') ? key.slice('passport:'.length) : key;
    const core = rawCore.replace(/[/_\s.-]/g, '');
    if (core.length < 2 || !/[1-9]/.test(core)) return '';
    return `Pasaporte:${core}`;
  }
  if (!isValidRut(value)) return '';
  const canonicalRut = documentIdentityKey(value).replace(/^0+/, '');
  if (canonicalRut.length < 2) return '';
  return `${normalizedType}:${canonicalRut}`;
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
