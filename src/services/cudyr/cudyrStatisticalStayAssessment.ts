import type { StatisticalDischargeEvidence } from '@/types/domain/statisticalDischarge';
import { normalizeRut } from '@/utils/rutUtils';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';

/** Official report clocks are Rapa Nui wall times. Reject ambiguous/nonexistent DST clocks. */
const instant = (local: string): number | null => {
  const candidates = ['-05:00', '-06:00']
    .map(offset => Date.parse(local + offset))
    .filter(at => {
      if (!Number.isFinite(at)) return false;
      const stamp = calendarStampInClinicalTimeZone(new Date(at));
      return `${stamp.iso}T${stamp.hhmm}` === local.slice(0, 16);
    });
  return candidates.length === 1 ? candidates[0] : null;
};

/** Evidence assessment only: does not invent a bed, CUDYR, identity link, or census write.
 * Presence, eight-hour duration and functional unit are deliberately independent facts.
 */
export const assessCudyrStatisticalDay = (
  evidence: StatisticalDischargeEvidence,
  input: { document: string; date: string; applicationAt?: string }
) => {
  if (
    !evidence.run ||
    !normalizeRut(input.document) ||
    evidence.run !== normalizeRut(input.document)
  )
    return null;
  const cutoff = cudyrReferenceInstant(input.date);
  const admissionAt = instant(evidence.admissionAt),
    dischargeAt = instant(evidence.dischargeAt);
  if (!cutoff || admissionAt === null || dischargeAt === null || dischargeAt < admissionAt)
    return null;
  const next = getNextDay(input.date);
  const windowStart = `${next}T00:00:00`,
    windowEnd = `${next}T08:00:00`;
  const events = [
    { changedAt: evidence.admissionAt, unit: evidence.admissionUnit },
    ...evidence.transfers,
  ].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  if (
    events.some(
      e =>
        instant(e.changedAt) === null ||
        e.changedAt < evidence.admissionAt ||
        e.changedAt > evidence.dischargeAt
    )
  )
    return null;
  // An admission from Urgencias does not establish the time first entering Hospitalizados.
  const hospital = (unit: string) =>
    /cuidados medios|cuidados intermedios|m[eé]dica pedi[aá]trica/i.test(unit) &&
    !/urgencia|\bUEA\b|ambulatori|\bCMA\b|cuna/i.test(unit);
  const firstHospital = events.find(
    (e, index) =>
      hospital(e.unit) && (events[index + 1]?.changedAt || evidence.dischargeAt) > e.changedAt
  );
  const durationEnd = Math.min(Date.parse(cutoff), dischargeAt);
  let segmentStart: string | null = null;
  for (const event of events) {
    const at = instant(event.changedAt)!;
    if (at >= durationEnd) break;
    if (hospital(event.unit)) segmentStart ??= event.changedAt;
    else segmentStart = null;
  }
  const hospitalAt = segmentStart ? instant(segmentStart) : null;
  const hoursAtReference =
    hospitalAt !== null
      ? Math.max(0, durationEnd - hospitalAt) / 3600000
      : firstHospital
        ? 0
        : null;
  const presentInNight = events.some((event, index) => {
    if (!hospital(event.unit)) return false;
    const end = events[index + 1]?.changedAt || evidence.dischargeAt;
    const hospitalDay = resolveClinicalDayForDateTime(
      event.changedAt.slice(0, 10),
      event.changedAt.slice(11, 16)
    );
    return Boolean(
      hospitalDay && hospitalDay <= input.date && end > windowStart && end > event.changedAt
    );
  });
  let units: string[] = [];
  let applicationWithinStay: boolean | null = null;
  if (input.applicationAt) {
    const at = Date.parse(input.applicationAt);
    if (!Number.isFinite(at) || !/(Z|[+-]\d{2}:\d{2})$/.test(input.applicationAt)) return null;
    const stamp = calendarStampInClinicalTimeZone(new Date(at));
    if (stamp.iso !== next || stamp.hhmm >= '12:00') return null;
    applicationWithinStay = at >= admissionAt && at < dischargeAt;
    const event = events.filter(e => instant(e.changedAt)! <= at).at(-1);
    if (applicationWithinStay && event) units = [event.unit];
  } else {
    // HHR rule: missing authoring time means madrugada before 08:00, not a fabricated instant.
    units = events
      .filter(
        (e, i) =>
          e.changedAt < windowEnd &&
          (events[i + 1]?.changedAt || evidence.dischargeAt) > e.changedAt &&
          (events[i + 1]?.changedAt || evidence.dischargeAt) > windowStart &&
          evidence.dischargeAt > windowStart
      )
      .map(e => e.unit);
  }
  units = [...new Set(units)];
  return {
    presentInNight,
    admissionAt: evidence.admissionAt,
    dischargeAt: evidence.dischargeAt,
    firstHospitalAdmissionAt: firstHospital?.changedAt || null,
    hospitalSegmentAdmissionAt: segmentStart,
    hoursAtReference,
    meetsEightHours:
      hoursAtReference === null ? null : dischargeAt > Date.parse(cutoff) && hoursAtReference >= 8,
    unitAtApplication: units.length === 1 ? units[0] : null,
    possibleUnits: units,
    applicationWithinStay,
    applicationTimingBasis: input.applicationAt ? 'recorded_time' : 'assumed_before_0800',
    // Unit codes are not physical bed codes and do not authorize copying the discharge bed.
    bedId: null,
  };
};
