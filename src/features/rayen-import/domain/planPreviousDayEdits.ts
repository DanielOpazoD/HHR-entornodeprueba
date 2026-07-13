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
}

export const planPreviousDayEdits = (
  diff: CensusImportDiff,
  censusDay: string,
  probes: PreviousDayProbes
): PreviousDayEdit[] => {
  // Scope: bed-occupying discharges (reconcile/known) — the "synced late" case where a discharge was
  // filed on the sync day. Report egresos (unknown RUN, never in a bed) keep their same-day handling.
  const candidates: Array<{ correctedDay?: string; patientName: string }> = [...diff.discharges];

  const namesByDay = new Map<string, string[]>();
  for (const candidate of candidates) {
    const day = candidate.correctedDay;
    // Only island days strictly earlier than the day being synced (string ISO order is chronological).
    if (!day || day >= censusDay) continue;
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
