/**
 * Persists the clinical closures Eloísa already verified — medical and nursing discharge — on the
 * beds that stay occupied, so the census can remind the pending administrative egreso in Gestión de
 * Camas. Only confirmed closures are written; an inconclusive observation never erases a previous
 * confirmation.
 */

import { normalizeRut } from '@/utils/rutUtils';
import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PendingAdministrativeDischargeEntry } from '../contracts/censusImportDiff';
import { isOccupiedCensusPatient } from './censusReconciliationPredicates';

type ClosureState = 'confirmed' | 'not-detected' | 'unknown';

type StoredVerification = NonNullable<PatientData['dischargeVerification']>;

/**
 * A pending entry only belongs to the current occupant with strong identity: the RUT, or the Rayen
 * encounter when the capture could not read a RUN. A bed id alone is not enough because the bed may
 * have been reassigned since the closure was observed.
 */
const matchesOccupant = (
  entry: PendingAdministrativeDischargeEntry,
  patient: PatientData
): boolean => {
  const entryRut = normalizeRut(entry.rut);
  if (entryRut) return entryRut === normalizeRut(patient.rut);
  return Boolean(entry.encounterId && entry.encounterId === patient.clinicalEpisodeId);
};

/**
 * Resolves one dimension across every observation of the same patient. A confirmation always wins
 * (conflicting captures are rare and the reminder is the safe side to keep); an explicit
 * `not-detected` erases it; `unknown` or an absent observation preserves what was already stored.
 */
const resolveClosureState = (
  entries: PendingAdministrativeDischargeEntry[],
  read: (entry: PendingAdministrativeDischargeEntry) => ClosureState,
  previous?: ClosureState
): ClosureState => {
  if (entries.some(entry => read(entry) === 'confirmed')) return 'confirmed';
  if (entries.some(entry => read(entry) === 'not-detected')) return 'not-detected';
  return previous ?? 'unknown';
};

const clearVerification = (
  beds: Record<string, PatientData>,
  bedId: string,
  patient: PatientData
): void => {
  if (!patient.dischargeVerification) return;
  const { dischargeVerification: _clearedVerification, ...patientWithoutVerification } = patient;
  beds[bedId] = patientWithoutVerification as PatientData;
};

/**
 * Per bed each discharge is resolved on its own, so a nursing confirmation is not lost when the
 * medical one arrives separately. Anything inconclusive — no observation at all, an `unknown`
 * state or a closure belonging to a previous occupant — preserves the stored verification: a stale
 * badge is visible and reviewable, erasing a valid one is not.
 *
 * Writes over the working copy of `beds` that the caller owns, matching the in-place steps of
 * `applyCensusImportDiff`.
 */
export const applyRayenDischargeVerification = (
  beds: Record<string, PatientData>,
  pendingAdministrativeDischarges: PendingAdministrativeDischargeEntry[]
): void => {
  const entriesByBed = new Map<string, PendingAdministrativeDischargeEntry[]>();
  for (const entry of pendingAdministrativeDischarges) {
    const entries = entriesByBed.get(entry.bedId);
    if (entries) entries.push(entry);
    else entriesByBed.set(entry.bedId, [entry]);
  }

  for (const [bedId, patient] of Object.entries(beds)) {
    if (!isOccupiedCensusPatient(patient)) continue;

    const bedEntries = entriesByBed.get(bedId) ?? [];
    const ownEntries = bedEntries.filter(entry => matchesOccupant(entry, patient));
    if (ownEntries.length === 0) continue;

    const previous = patient.dischargeVerification;
    const medicalEpicrisis = resolveClosureState(
      ownEntries,
      entry => entry.verification.medicalEpicrisis,
      previous?.medicalEpicrisis
    );
    const nursingEpicrisis = resolveClosureState(
      ownEntries,
      entry => entry.verification.nursingEpicrisis,
      previous?.nursingEpicrisis
    );

    if (medicalEpicrisis !== 'confirmed' && nursingEpicrisis !== 'confirmed') {
      clearVerification(beds, bedId, patient);
      continue;
    }

    const medicalEntry = ownEntries.find(
      entry => entry.verification.medicalEpicrisis === 'confirmed'
    );
    const encounterId = (medicalEntry ?? ownEntries[0]).encounterId ?? previous?.encounterId;
    // La fecha que informa Eloísa corresponde al alta médica, no al cierre de enfermería.
    const registeredAt =
      medicalEntry?.source?.dischargeDatetime ?? previous?.registeredAt ?? undefined;

    const dischargeVerification: StoredVerification = {
      medicalEpicrisis,
      nursingEpicrisis,
      ...(encounterId ? { encounterId } : {}),
      ...(medicalEpicrisis === 'confirmed' && registeredAt ? { registeredAt } : {}),
    };

    beds[bedId] = { ...patient, dischargeVerification };
  }
};
