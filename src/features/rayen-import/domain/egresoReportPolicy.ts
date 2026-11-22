import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import { isSameDocument, isSameDocumentBeforeLetterRule, normalizeRut } from '@/utils/rutUtils';
import {
  correctedStamp,
  isLaterEgresoRow,
  reportPredatesAdmission,
  type CmaOriginEvidence,
  type ReportEgresoStamp,
} from './egresoReportStamps';
import {
  hasRecordedDifferentEpisode,
  type OccupiedBedEvidence,
  type OccupiedClinicalCrib,
} from './egresoReportOccupancy';

export {
  correctedStamp,
  isLaterEgresoRow,
  reportEgresoFromRow,
  reportPredatesAdmission,
  resolveReportDischarge,
  toIsoDay,
  type CmaOriginEvidence,
  type ReportEgresoStamp,
} from './egresoReportStamps';
export {
  collectRecordedMovementRuns,
  findOccupiedBed,
  findOccupiedClinicalCrib,
  hasRecordedDifferentEpisode,
  hasRecordedMovement,
  indexPrincipalBeds,
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
  unchangedClinicalCribEpisodes,
  type OccupiedBedEvidence,
  type OccupiedClinicalCrib,
} from './egresoReportOccupancy';

/** Prefers episode evidence observed during this reconciliation over a legacy stored value. */
export const resolveActiveEpisode = (
  diff: CensusImportDiff,
  document: string,
  storedEpisode?: string
): string => {
  if (!normalizeRut(document)) return String(storedEpisode ?? '').trim();
  const sameDocument = (rut?: string) => isSameDocumentBeforeLetterRule(rut, document);
  const admission = diff.admissions.find(entry => sameDocument(entry.patient.rut));
  const move = diff.moves.find(entry => sameDocument(entry.rut));
  const update = diff.updates.find(entry => sameDocument(entry.rut));
  const pending = diff.pendingAdministrativeDischarges.find(entry => sameDocument(entry.rut));
  return (
    [
      admission?.source?.encounterId,
      admission?.patient.clinicalEpisodeId,
      move?.source.encounterId,
      update?.source?.encounterId,
      pending?.encounterId,
      pending?.source?.encounterId,
      storedEpisode,
    ]
      .map(value => String(value ?? '').trim())
      .find(Boolean) ?? ''
  );
};

export const createReportEpisodeMatcher =
  (rowsByRun: ReadonlyMap<string, EgresoReportRow>) =>
  (rut?: string, episodeId?: string, requireKnownEpisode = false): boolean => {
    const candidateEpisode = String(episodeId ?? '').trim();
    const row =
      [...rowsByRun.values()].find(
        entry => !entry.encounterId && isSameDocumentBeforeLetterRule(entry.run, rut)
      ) ??
      [...rowsByRun.values()].find(
        entry => candidateEpisode && entry.encounterId === candidateEpisode
      );
    if (!row) return false;
    const reportedEpisode = String(row.encounterId ?? '').trim();
    return (
      !reportedEpisode ||
      (!candidateEpisode ? !requireKnownEpisode : reportedEpisode === candidateEpisode)
    );
  };

export const selectReportRowsByEpisode = (
  rows: EgresoReportRow[],
  activeEpisodeForRun: (document: string) => string,
  sourceDocuments: ReadonlyMap<EgresoReportRow, string> = new Map()
): { primaryByRun: Map<string, EgresoReportRow>; supplemental: EgresoReportRow[] } => {
  const byIdentity = new Map<string, EgresoReportRow>();
  for (const row of rows) {
    const run = normalizeRut(row.run);
    const episode = String(row.encounterId ?? '').trim();
    const patientKey = episode ? `episode:${episode}` : run;
    const documentKey = !episode
      ? [...byIdentity].find(
          ([, candidate]) =>
            !candidate.encounterId &&
            isSameDocument(
              sourceDocuments.get(candidate) ?? candidate.run,
              sourceDocuments.get(row) ?? row.run
            )
        )?.[0]
      : undefined;
    const key = episode
      ? `${patientKey}|${episode}`
      : (documentKey ?? `${run}|document:${byIdentity.size}`);
    const previous = byIdentity.get(key);
    const stamp = correctedStamp(
      row.fechaEgreso,
      row.correctedDay,
      row.correctedTime,
      row.correctedCalendarDay
    );
    const previousStamp =
      previous &&
      correctedStamp(
        previous.fechaEgreso,
        previous.correctedDay,
        previous.correctedTime,
        previous.correctedCalendarDay
      );
    if (
      !previous ||
      isLaterEgresoRow(
        `${stamp.correctedDay}T${stamp.correctedTime}`,
        stamp.correctedCalendarDay,
        `${previousStamp?.correctedDay}T${previousStamp?.correctedTime}`,
        previousStamp?.correctedCalendarDay
      )
    )
      byIdentity.set(key, row);
  }
  const primaryByRun = new Map<string, EgresoReportRow>();
  const exactActiveDocuments = [...byIdentity.values()]
    .filter(
      row =>
        Boolean(normalizeRut(row.run)) &&
        Boolean(row.encounterId) &&
        row.encounterId === activeEpisodeForRun(row.run)
    )
    .map(row => row.run);
  for (const [key, row] of byIdentity) {
    const episode = String(row.encounterId ?? '').trim();
    if (
      !episode &&
      normalizeRut(row.run) &&
      exactActiveDocuments.some(document => isSameDocumentBeforeLetterRule(document, row.run))
    )
      continue;
    primaryByRun.set(episode ? `episode:${episode}` : key, row);
  }
  return { primaryByRun, supplemental: [] };
};

export const hasPlannedPatientIdentity = (
  diff: CensusImportDiff,
  run: string,
  episodeId: string
): boolean => {
  const plannedEpisodes = [
    ...diff.admissions.map(entry => entry.source?.encounterId),
    ...diff.updates.map(entry => entry.source?.encounterId),
    ...diff.moves.map(entry => entry.source?.encounterId),
    ...diff.pendingAdministrativeDischarges.flatMap(entry => [
      entry.encounterId,
      entry.source?.encounterId,
    ]),
    ...diff.conflicts.map(entry => entry.source?.encounterId),
  ];
  if (episodeId && plannedEpisodes.includes(episodeId)) return true;
  return (
    Boolean(normalizeRut(run)) &&
    [
      ...diff.admissions.map(entry => entry.patient.rut),
      ...diff.updates.map(entry => entry.rut),
      ...diff.moves.map(entry => entry.rut),
      ...diff.pendingAdministrativeDischarges.map(entry => entry.rut),
      ...diff.conflicts.map(entry => entry.rut),
    ].some(rut => isSameDocumentBeforeLetterRule(rut, run))
  );
};

export const findPlannedBedByEpisode = (
  diff: CensusImportDiff,
  episodeId?: string
): string | undefined =>
  diff.admissions.find(entry => entry.source?.encounterId === episodeId)?.bedId ??
  diff.moves.find(entry => entry.source.encounterId === episodeId)?.toBedId;

export const episodeLessReportConflict = (
  diff: CensusImportDiff,
  record: DailyRecord,
  row: EgresoReportRow,
  current?: OccupiedBedEvidence,
  currentCrib?: OccupiedClinicalCrib
): CensusImportDiff['conflicts'][number] | null => {
  if (row.encounterId) return null;
  const activeCrib = diff.activeClinicalCribs?.find(crib =>
    isSameDocumentBeforeLetterRule(crib.patient.rut, row.run)
  );
  const storedEpisode = String(
    current?.clinicalEpisodeId ??
      activeCrib?.source.encounterId ??
      activeCrib?.patient.clinicalEpisodeId ??
      currentCrib?.patient.clinicalEpisodeId ??
      ''
  ).trim();
  const activeEpisode = resolveActiveEpisode(diff, row.run, storedEpisode);
  if (!hasRecordedDifferentEpisode(record, row.run, activeEpisode)) return null;
  const patientName = current?.patientName ?? currentCrib?.patient.patientName;
  return {
    bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
    rut: row.run,
    patientName,
    reason: `El informe de Gestión de Camas no identifica el episodio activo de ${patientName ?? row.patientName}; se requiere revisión antes de egresar.`,
  };
};

export const reportPredatesActiveAdmission = (
  diff: CensusImportDiff,
  row: EgresoReportRow,
  stamp: ReportEgresoStamp,
  evidence?: CmaOriginEvidence & { clinicalEpisodeId?: string }
): boolean => {
  if (!evidence) return false;
  const reportedEpisode = String(row.encounterId ?? '').trim();
  const activeEpisode = resolveActiveEpisode(diff, row.run, evidence.clinicalEpisodeId);
  if (reportedEpisode && activeEpisode && reportedEpisode !== activeEpisode) return false;
  return reportPredatesAdmission(stamp, evidence);
};
