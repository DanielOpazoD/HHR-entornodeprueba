import { getNextDay, getShiftSchedule, parseTimeMinutes } from '@/utils/clinicalDayUtils';
import type {
  NursingStaffingProposal,
  NursingShiftEvidence,
  NursingShiftSuggestion,
  RayenNursingActivity,
} from '../contracts/nursingShiftInference';
import {
  buildNurseCatalogIdentities,
  nurseIdentityKey,
  resolveNurseIdentity,
  type NurseCatalogIdentity,
} from '@/services/staff/nurseIdentity';

export interface NursingActivityObservation extends RayenNursingActivity {
  encounterId: string;
}

const NURSE_ROLE = /enfermer/i;
const TECHNICIAN_ROLE = /\btens\b|param[eé]dic|t[eé]cnic[oa]|auxiliar/i;
const BOUNDARY_GRACE_MINUTES = 60;

export const isNurseRole = (role: string): boolean =>
  NURSE_ROLE.test(role) && !TECHNICIAN_ROLE.test(role);

export const isNursingTechnicianRole = (role: string): boolean => TECHNICIAN_ROLE.test(role);

interface LocalStamp {
  day: string;
  minutes: number;
  hour: number;
}

/** Ficha Médico history stamps are Rapa Nui wall-clock values without an offset. */
const parseLocalStamp = (value: string): LocalStamp | null => {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { day: match[1], minutes: hour * 60 + minute, hour };
};

type Shift = 'day' | 'night';

const classifyShift = (
  stamp: LocalStamp,
  censusDate: string
): { shift: Shift; boundary: boolean } | null => {
  const schedule = getShiftSchedule(censusDate);
  const nextDay = getNextDay(censusDate);
  const dayStart = parseTimeMinutes(schedule.dayStart);
  const dayEnd = parseTimeMinutes(schedule.dayEnd);
  const nightEnd = parseTimeMinutes(schedule.nightEnd);
  if (dayStart == null || dayEnd == null || nightEnd == null) return null;

  if (stamp.day === censusDate && stamp.minutes >= dayStart && stamp.minutes < dayEnd) {
    return { shift: 'day', boundary: stamp.minutes < dayStart + BOUNDARY_GRACE_MINUTES };
  }
  if (stamp.day === censusDate && stamp.minutes >= dayEnd) {
    return { shift: 'night', boundary: stamp.minutes < dayEnd + BOUNDARY_GRACE_MINUTES };
  }
  if (stamp.day === nextDay && stamp.minutes < nightEnd) {
    return { shift: 'night', boundary: false };
  }
  if (stamp.day === nextDay && stamp.minutes < nightEnd + BOUNDARY_GRACE_MINUTES) {
    return { shift: 'night', boundary: true };
  }
  return null;
};

interface CandidateAccumulator {
  name: string;
  observedNames: Set<string>;
  structuredAliasKeys: Set<string>;
  records: Set<string>;
  patients: Set<string>;
  hours: Set<string>;
  hasShiftChange: boolean;
  catalogMatched: boolean;
}

const buildSuggestion = (
  observations: NursingActivityObservation[],
  censusDate: string,
  targetShift: Shift,
  staffCatalog: NurseCatalogIdentity[],
  acceptsRole: (role: string) => boolean,
  standardSlots: number
): NursingShiftSuggestion => {
  const candidates = new Map<string, CandidateAccumulator>();
  let ignoredBoundaryRecords = 0;

  for (const observation of observations) {
    if (observation.archived || observation.crossedOut || !acceptsRole(observation.role)) {
      continue;
    }
    const identity = resolveNurseIdentity(
      observation.author,
      staffCatalog,
      observation.authorIdentity
    );
    const stamp = parseLocalStamp(observation.recordedAt);
    if (
      !identity ||
      /^(?:no\s*informad[oa]|sin\s*informaci[oó]n)$/i.test(identity.displayName) ||
      !observation.encounterId ||
      !stamp
    ) {
      continue;
    }
    const classified = classifyShift(stamp, censusDate);
    if (!classified || classified.shift !== targetShift) continue;
    if (classified.boundary) {
      ignoredBoundaryRecords += 1;
      continue;
    }

    const key = identity.key;
    const accumulator = candidates.get(key) ?? {
      name: identity.displayName,
      observedNames: new Set<string>(),
      structuredAliasKeys: new Set<string>(),
      records: new Set<string>(),
      patients: new Set<string>(),
      hours: new Set<string>(),
      hasShiftChange: false,
      catalogMatched: identity.catalogMatched,
    };
    accumulator.observedNames.add(observation.author);
    if (observation.authorIdentity) {
      accumulator.structuredAliasKeys.add(
        nurseIdentityKey(
          `${observation.authorIdentity.firstGivenName} ${observation.authorIdentity.firstSurname}`
        )
      );
    }
    accumulator.records.add(
      `${observation.encounterId}|${observation.recordedAt}|${observation.source}`
    );
    accumulator.patients.add(observation.encounterId);
    accumulator.hours.add(`${stamp.day}|${stamp.hour}`);
    accumulator.hasShiftChange ||= observation.source === 'shift-change';
    accumulator.catalogMatched ||= identity.catalogMatched;
    candidates.set(key, accumulator);
  }

  const identityCollision = [...candidates].some(([key, candidate]) =>
    [...candidate.structuredAliasKeys].some(
      aliasKey => aliasKey !== key && candidates.has(aliasKey)
    )
  );

  const evidence: NursingShiftEvidence[] = [...candidates.values()]
    .map(candidate => {
      const records = candidate.records.size;
      const patients = candidate.patients.size;
      const activeHours = candidate.hours.size;
      return {
        name: candidate.name,
        observedNames: [...candidate.observedNames],
        identityAliases: [...candidate.structuredAliasKeys],
        records,
        patients,
        activeHours,
        hasShiftChange: candidate.hasShiftChange,
        catalogMatched: candidate.catalogMatched,
        score:
          patients * 5 +
          Math.min(records, 5) +
          Math.min(activeHours, 4) * 2 +
          (candidate.hasShiftChange ? 2 : 0) +
          (candidate.catalogMatched ? 4 : 0),
      };
    })
    .filter(
      candidate =>
        (candidate.catalogMatched && candidate.records >= 1) ||
        candidate.patients >= 2 ||
        (candidate.records >= 2 && candidate.activeHours >= 2) ||
        (candidate.hasShiftChange && candidate.records >= 2)
    )
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'es'));

  const cutoffScore = evidence[standardSlots - 1]?.score;
  const cutoffTied =
    evidence.length > standardSlots && cutoffScore === evidence[standardSlots]?.score;
  const names = identityCollision
    ? []
    : cutoffTied
      ? evidence
          .filter(candidate => cutoffScore != null && candidate.score > cutoffScore)
          .slice(0, standardSlots)
          .map(candidate => candidate.name)
      : evidence.slice(0, standardSlots).map(candidate => candidate.name);
  return {
    names,
    catalogNames: staffCatalog.map(identity => identity.displayName),
    candidates: evidence,
    ignoredBoundaryRecords,
    ambiguous: cutoffTied || identityCollision,
  };
};

export const inferNursingShifts = (
  observations: NursingActivityObservation[],
  censusDate: string,
  nurseCatalog: string[] = [],
  tensCatalog: string[] = []
): NursingStaffingProposal => {
  const nurseIdentities = buildNurseCatalogIdentities(nurseCatalog);
  const tensIdentities = buildNurseCatalogIdentities(tensCatalog);
  return {
    censusDate,
    day: buildSuggestion(observations, censusDate, 'day', nurseIdentities, isNurseRole, 2),
    night: buildSuggestion(observations, censusDate, 'night', nurseIdentities, isNurseRole, 2),
    // Eloísa labels these professionals as Paramédico/TENS/Técnico. The curated local catalog
    // resolves their identity and allows one authoritative activity to count as evidence.
    tensDay: buildSuggestion(
      observations,
      censusDate,
      'day',
      tensIdentities,
      isNursingTechnicianRole,
      3
    ),
    tensNight: buildSuggestion(
      observations,
      censusDate,
      'night',
      tensIdentities,
      isNursingTechnicianRole,
      3
    ),
  };
};

export const hasNursingShiftSuggestions = (proposal: NursingStaffingProposal): boolean =>
  [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(suggestion =>
    Boolean(suggestion && (suggestion.names.length > 0 || suggestion.ambiguous))
  );
