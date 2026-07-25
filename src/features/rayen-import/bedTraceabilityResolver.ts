import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import type { CensusImportDiff } from './contracts/censusImportDiff';
import type { DailyRecord, PatientData } from './contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from './contracts/rayenSnapshot';
import { toIsoCensusDay } from './domain/censusDayPolicy';
import { latestPatientFlowMovement, patientRunFromFlowReport } from './mapping/parsePatientFlow';
import { buildSortableLocalTimestamp, parseStrictIsoInstant } from './mapping/localTimestamp';

export interface PatientFlowReportResult {
  base64: string;
  error?: string;
}

export interface BedTraceabilityResolverDependencies {
  fetchReport: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
}

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

const isClosed = (encounter: RayenEncounter): boolean =>
  !!encounter.hasMedicalDischarge ||
  !!encounter.hasNurseDischarge ||
  !!encounter.dischargeDatetime ||
  !!encounter.isDead;

const absoluteInstantInRapaNui = (raw: string | undefined): string | null => {
  const instant = parseStrictIsoInstant((raw ?? '').trim());
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  const [year, month, day, hour, minute, second] = [
    partValue('year'),
    partValue('month'),
    partValue('day'),
    partValue('hour'),
    partValue('minute'),
    partValue('second'),
  ];
  return year && month && day && hour && minute && second
    ? `${year}-${month}-${day}T${hour}:${minute}:${second}`
    : null;
};

const admissionWallClockInRapaNui = (raw: string | undefined): string | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const localIso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
  if (localIso) {
    return buildSortableLocalTimestamp(
      Number(localIso[1]),
      Number(localIso[2]),
      Number(localIso[3]),
      Number(localIso[4] ?? 0),
      Number(localIso[5] ?? 0),
      Number(localIso[6] ?? 0)
    );
  }
  const localDmy =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (localDmy) {
    return buildSortableLocalTimestamp(
      Number(localDmy[3]),
      Number(localDmy[2]),
      Number(localDmy[1]),
      Number(localDmy[4] ?? 0),
      Number(localDmy[5] ?? 0),
      Number(localDmy[6] ?? 0)
    );
  }
  return absoluteInstantInRapaNui(value);
};

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const findExactEncounter = (
  occupant: PatientData,
  encounters: RayenEncounter[]
): RayenEncounter | undefined => {
  if (occupant.clinicalEpisodeId) {
    return encounters.find(encounter => encounter.encounterId === occupant.clinicalEpisodeId);
  }
  const rut = normalizeRut(occupant.rut);
  if (!rut) return undefined;
  const matches = encounters.filter(encounter => normalizeRut(encounter.run) === rut);
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * Adds official bed-placement evidence only for a closed encounter that is actively blocking an
 * admission. Missing, malformed or contradictory reports leave the original conflict untouched.
 */
export const resolveOccupiedBedTraceability = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  diff: CensusImportDiff,
  dependencies: BedTraceabilityResolverDependencies
): Promise<RayenCensusSnapshot> => {
  const placementCutoff = absoluteInstantInRapaNui(snapshot.capturedAt);
  const censusDay = toIsoCensusDay(current.date);
  if (!placementCutoff || !censusDay) return snapshot;
  const effectiveCutoff = [placementCutoff, `${censusDay}T23:59:59`].sort()[0];
  const candidates = new Map<string, RayenEncounter>();
  for (const conflict of diff.conflicts) {
    if (conflict.code !== 'occupied-local-bed' || !conflict.bedId) continue;
    const occupant = current.beds[conflict.bedId];
    if (!isOccupied(occupant)) continue;
    const encounter = findExactEncounter(occupant, snapshot.encounters);
    if (
      !encounter ||
      encounter.verifiedBedPlacement ||
      !isClosed(encounter) ||
      !/^\d+$/.test(encounter.encounterId)
    )
      continue;
    candidates.set(encounter.encounterId, encounter);
  }
  if (candidates.size === 0) return snapshot;

  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  const evidence = new Map<string, NonNullable<RayenEncounter['verifiedBedPlacement']>>();
  await Promise.all(
    [...candidates.keys()].map(async encounterId => {
      try {
        const encounter = candidates.get(encounterId);
        const admissionCutoff = admissionWallClockInRapaNui(encounter?.admissionDatetime);
        if (!encounter || !admissionCutoff) return;
        const report = await dependencies.fetchReport(encounterId);
        if (!report.base64 || report.error) return;
        const reportText = await extractText(base64ToArrayBuffer(report.base64));
        const reportRun = patientRunFromFlowReport(reportText);
        const encounterRun = normalizeRut(encounter.run);
        if (!reportRun || !encounterRun || reportRun !== encounterRun) return;
        const movement = latestPatientFlowMovement(reportText, {
          notBefore: admissionCutoff,
          notAfter: effectiveCutoff,
        });
        if (!movement) return;
        evidence.set(encounterId, {
          source: 'patient-flow-report',
          bedId: movement.bedId,
          changedAt: movement.changedAt,
        });
      } catch {
        // Fail closed: the occupied-bed conflict remains reviewable and no placement is invented.
      }
    })
  );
  if (evidence.size === 0) return snapshot;

  return {
    ...snapshot,
    encounters: snapshot.encounters.map(encounter => {
      const verifiedBedPlacement = evidence.get(encounter.encounterId);
      return verifiedBedPlacement ? { ...encounter, verifiedBedPlacement } : encounter;
    }),
  };
};

export interface BedTraceabilityChainResult {
  snapshot: RayenCensusSnapshot;
  diff: CensusImportDiff;
}

/** Resolves newly exposed closed-patient blockers in bounded rounds, never refetching proven episodes. */
export const resolveOccupiedBedTraceabilityChain = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  initialDiff: CensusImportDiff,
  dependencies: BedTraceabilityResolverDependencies,
  replan: (snapshot: RayenCensusSnapshot) => CensusImportDiff
): Promise<BedTraceabilityChainResult> => {
  let resolvedSnapshot = snapshot;
  let diff = initialDiff;
  for (let pass = 0; pass < snapshot.encounters.length; pass += 1) {
    const nextSnapshot = await resolveOccupiedBedTraceability(
      current,
      resolvedSnapshot,
      diff,
      dependencies
    );
    if (nextSnapshot === resolvedSnapshot) break;
    resolvedSnapshot = nextSnapshot;
    diff = replan(resolvedSnapshot);
  }
  return { snapshot: resolvedSnapshot, diff };
};
