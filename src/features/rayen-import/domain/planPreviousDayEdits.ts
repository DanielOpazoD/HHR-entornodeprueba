/**
 * Plans which PREVIOUS days a sync would modify (Capability A of "conciliar contra el egreso
 * oficial"): every discharge / report egreso whose official island egreso day (`correctedDay`) is
 * earlier than the census day being synced. Grouped by day, with per-day flags (does a record exist,
 * is the nurse editing window still open, is the day already signed) resolved via injected probes so
 * the function stays pure and testable.
 */

import type { CensusImportDiff, PreviousDayEdit } from '../contracts/censusImportDiff';

export interface PreviousDayProbes {
  /** Whether a daily record already exists for `day`. */
  recordExists: (day: string) => boolean;
  /** Whether a nurse may still write `day` (Firestore ~48h window); false → needs admin. */
  withinEditingWindow: (day: string) => boolean;
  /** Whether `day`'s record carries a medical signature (already "closed"). */
  isSigned: (day: string) => boolean;
  /** Whether `day`'s record ALREADY holds an egreso for this patient RUT (→ nothing to add). */
  alreadyDischarged: (day: string, rut: string) => boolean;
}

export const planPreviousDayEdits = (
  diff: CensusImportDiff,
  censusDay: string,
  probes: PreviousDayProbes
): PreviousDayEdit[] => {
  // Every egreso the report attributes to an EARLIER island day than the census day — both bed-
  // occupying discharges (reconcile/known) and report egresos (unknown RUN, e.g. a late sync where
  // the source filed the alta a day ahead) — is filed on that real day.
  const candidates: Array<{ correctedDay?: string; patientName: string; rut: string }> = [
    ...diff.discharges.map(entry => ({ ...entry, rut: entry.rut })),
    ...(diff.reportEgresos ?? []).map(entry => ({ ...entry, rut: entry.run })),
  ];

  const namesByDay = new Map<string, string[]>();
  for (const candidate of candidates) {
    const day = candidate.correctedDay;
    // Only island days strictly earlier than the day being synced (string ISO order is chronological).
    if (!day || day >= censusDay) continue;
    // Skip a patient whose egreso is ALREADY consigned in that day's HHR record (verified by RUT):
    // re-adding it would be a no-op, so the "falta el egreso de X" message makes no sense.
    if (probes.alreadyDischarged(day, candidate.rut)) continue;
    const names = namesByDay.get(day) ?? [];
    names.push(candidate.patientName);
    namesByDay.set(day, names);
  }

  return [...namesByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, patientNames]) => ({
      day,
      reason: 'discharge-day-correction' as const,
      patientNames,
      recordExists: probes.recordExists(day),
      withinEditingWindow: probes.withinEditingWindow(day),
      isSigned: probes.isSigned(day),
    }));
};
