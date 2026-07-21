import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { isCmaBedLabel, isCmaLocation } from '../mapping/bedMapping';
import { mapDestinoDeAlta } from '../mapping/mapDestinoDeAlta';
import { toTitleCaseName } from '../mapping/rayenToPatientData';
import { parseStatisticalEgresoStamp } from '../mapping/reportEgresoDateTime';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import { normalizeRut } from '@/utils/rutUtils';
export interface OccupiedBedEvidence {
  bedId: string;
  patientName: string;
  rut?: string;
  clinicalEpisodeId?: string;
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}
export interface OccupiedClinicalCrib {
  parentBedId: string;
  parent: DailyRecord['beds'][string];
  patient: DailyRecord['beds'][string];
}
/** Prefers episode evidence observed during this reconciliation over a legacy stored value. */
export const resolveActiveEpisode = (
  diff: CensusImportDiff,
  normalizedRun: string,
  storedEpisode?: string
): string => {
  if (!normalizedRun) return String(storedEpisode ?? '').trim();
  const admission = diff.admissions.find(
    entry => normalizeRut(entry.patient.rut) === normalizedRun
  );
  const move = diff.moves.find(entry => normalizeRut(entry.rut) === normalizedRun);
  const update = diff.updates.find(entry => normalizeRut(entry.rut) === normalizedRun);
  const pending = diff.pendingAdministrativeDischarges.find(
    entry => normalizeRut(entry.rut) === normalizedRun
  );
  return [
    admission?.source?.encounterId,
    admission?.patient.clinicalEpisodeId,
    move?.source.encounterId,
    update?.source?.encounterId,
    pending?.encounterId,
    pending?.source?.encounterId,
    storedEpisode,
  ].map(value => String(value ?? '').trim()).find(Boolean) ?? '';
};

export const createReportEpisodeMatcher = (
  rowsByRun: ReadonlyMap<string, EgresoReportRow>
) => (rut?: string, episodeId?: string, requireKnownEpisode = false): boolean => {
  const candidateEpisode = String(episodeId ?? '').trim();
  const row = rowsByRun.get(normalizeRut(rut)) ??
    [...rowsByRun.values()].find(entry => candidateEpisode && entry.encounterId === candidateEpisode);
  if (!row) return false;
  const reportedEpisode = String(row.encounterId ?? '').trim();
  return !reportedEpisode ||
    (!candidateEpisode ? !requireKnownEpisode : reportedEpisode === candidateEpisode);
};
export const selectReportRowsByEpisode = (
  rows: EgresoReportRow[],
  activeEpisodeForRun: (run: string) => string
): { primaryByRun: Map<string, EgresoReportRow>; supplemental: EgresoReportRow[] } => {
  const byIdentity = new Map<string, EgresoReportRow>();
  for (const row of rows) {
    const run = normalizeRut(row.run);
    const episode = String(row.encounterId ?? '').trim();
    const patientKey = episode ? `episode:${episode}` : run;
    const key = `${patientKey}|${episode || 'episode-less'}`;
    const previous = byIdentity.get(key);
    const stamp = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    const previousStamp = previous && correctedStamp(
      previous.fechaEgreso, previous.correctedDay, previous.correctedTime
    );
    if (!previous || `${stamp.correctedDay}T${stamp.correctedTime}` >
      `${previousStamp?.correctedDay}T${previousStamp?.correctedTime}`) byIdentity.set(key, row);
  }
  const primaryByRun = new Map<string, EgresoReportRow>();
  const exactActiveRuns = new Set([...byIdentity.values()].filter(row => {
    const run = normalizeRut(row.run);
    return Boolean(run && row.encounterId && row.encounterId === activeEpisodeForRun(run));
  }).map(row => normalizeRut(row.run)));
  for (const row of byIdentity.values()) {
    const episode = String(row.encounterId ?? '').trim();
    const run = normalizeRut(row.run);
    if (!episode && exactActiveRuns.has(run)) continue;
    primaryByRun.set(episode ? `episode:${episode}` : run, row);
  }
  return { primaryByRun, supplemental: [] };
};

export const indexPrincipalBeds = (
  diff: CensusImportDiff,
  occupied: ReadonlyMap<string, OccupiedBedEvidence>
): Map<string, string> => {
  const result = new Map<string, string>();
  for (const current of occupied.values()) {
    const run = normalizeRut(current.rut); if (run) result.set(run, current.bedId);
  }
  for (const entry of diff.admissions) result.set(normalizeRut(entry.patient.rut), entry.bedId);
  for (const entry of diff.moves) result.set(normalizeRut(entry.rut), entry.toBedId);
  return result;
};

export const clinicalCribConflictBeds = (diff: CensusImportDiff): Set<string> =>
  new Set(diff.conflicts
    .filter(entry => entry.bedId && (
      entry.code === 'principal-bed-collision' ||
      (entry.scope === 'clinical-crib' && entry.code !== 'unconfirmed-principal-bed')
    ))
    .map(entry => entry.bedId as string));

export const hasPlannedPatientIdentity = (
  diff: CensusImportDiff,
  run: string,
  episodeId: string
): boolean => {
  const plannedEpisodes = [
    ...diff.admissions.map(entry => entry.source?.encounterId),
    ...diff.updates.map(entry => entry.source?.encounterId),
    ...diff.moves.map(entry => entry.source?.encounterId),
    ...diff.pendingAdministrativeDischarges.flatMap(entry => [entry.encounterId, entry.source?.encounterId]),
    ...diff.conflicts.map(entry => entry.source?.encounterId),
  ];
  if (episodeId && plannedEpisodes.includes(episodeId)) return true;
  const normalizedRun = normalizeRut(run);
  return Boolean(normalizedRun) && [
    ...diff.admissions.map(entry => entry.patient.rut),
    ...diff.updates.map(entry => entry.rut), ...diff.moves.map(entry => entry.rut),
    ...diff.pendingAdministrativeDischarges.map(entry => entry.rut),
    ...diff.conflicts.map(entry => entry.rut),
  ].some(rut => normalizeRut(rut) === normalizedRun);
};

export const findPlannedBedByEpisode = (diff: CensusImportDiff, episodeId?: string): string | undefined =>
  diff.admissions.find(entry => entry.source?.encounterId === episodeId)?.bedId ??
  diff.moves.find(entry => entry.source.encounterId === episodeId)?.toBedId;

interface CmaOriginEvidence {
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}

export const correctedStamp = (
  fechaEgreso: string,
  correctedDay?: string,
  correctedTime?: string
): { correctedDay?: string; correctedTime?: string } => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(correctedDay || '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(correctedTime || '');
  const date = dayMatch && new Date(Date.UTC(
    Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3])
  ));
  const isValidDay = Boolean(dayMatch && date &&
    date.getUTCFullYear() === Number(dayMatch[1]) &&
    date.getUTCMonth() === Number(dayMatch[2]) - 1 &&
    date.getUTCDate() === Number(dayMatch[3]));
  const isValidTime = Boolean(timeMatch &&
    Number(timeMatch[1]) <= 23 && Number(timeMatch[2]) <= 59);
  if (isValidDay && isValidTime) {
    return { correctedDay, correctedTime };
  }
  const stamp = parseStatisticalEgresoStamp(fechaEgreso);
  return { correctedDay: stamp?.iso, correctedTime: stamp?.hhmm };
};

export const hasRecordedDifferentEpisode = (
  record: DailyRecord,
  run: string,
  activeEpisode: string
): boolean => {
  const normalizedRun = normalizeRut(run);
  return Boolean(activeEpisode) && [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ].some(movement =>
    normalizeRut(movement.rut) === normalizedRun &&
    Boolean(movement.clinicalEpisodeId) &&
    movement.clinicalEpisodeId !== activeEpisode
  );
};

export const episodeLessReportConflict = (
  diff: CensusImportDiff,
  record: DailyRecord,
  row: EgresoReportRow,
  current?: OccupiedBedEvidence,
  currentCrib?: OccupiedClinicalCrib
): CensusImportDiff['conflicts'][number] | null => {
  if (row.encounterId) return null;
  const run = normalizeRut(row.run);
  const activeCrib = diff.activeClinicalCribs?.find(
    crib => normalizeRut(crib.patient.rut) === run
  );
  const storedEpisode = String(
    current?.clinicalEpisodeId ??
    activeCrib?.source.encounterId ??
    activeCrib?.patient.clinicalEpisodeId ??
    currentCrib?.patient.clinicalEpisodeId ?? ''
  ).trim();
  const activeEpisode = resolveActiveEpisode(diff, run, storedEpisode);
  if (!hasRecordedDifferentEpisode(record, run, activeEpisode)) return null;
  const patientName = current?.patientName ?? currentCrib?.patient.patientName;
  return {
    bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
    rut: row.run,
    patientName,
    reason: `El informe de Gestión de Camas no identifica el episodio activo de ${patientName ?? row.patientName}; se requiere revisión antes de egresar.`,
  };
};

export const collectRecordedMovementRuns = (record: DailyRecord): Set<string> => {
  const runs = new Set<string>();
  const add = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) runs.add(run);
  };
  for (const movement of [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ]) {
    add(movement.rut);
  }
  return runs;
};

export const hasRecordedMovement = (
  record: DailyRecord,
  run: string,
  encounterId?: string
): boolean => {
  const normalizedRun = normalizeRut(run);
  return [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ].some(movement => encounterId
    ? movement.clinicalEpisodeId === encounterId
    : normalizeRut(movement.rut) === normalizedRun);
};

export const toIsoDay = (raw: string): string => {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
};

const timeFrom = (raw?: string): string | undefined => {
  const match = (raw ?? '').match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const reportPredatesAdmission = (
  stamp: { iso: string; hhmm: string },
  evidence: CmaOriginEvidence
): boolean => {
  const admissionDay = toIsoDay(evidence.admissionDate ?? '');
  if (!admissionDay) return false;
  if (stamp.iso !== admissionDay) return stamp.iso < admissionDay;
  const admissionTime = timeFrom(evidence.admissionTime) ?? timeFrom(evidence.admissionDate);
  return admissionTime ? stamp.hhmm < admissionTime : false;
};

export const reportPredatesActiveAdmission = (
  diff: CensusImportDiff,
  row: EgresoReportRow,
  run: string,
  stamp: { iso: string; hhmm: string },
  evidence?: CmaOriginEvidence & { clinicalEpisodeId?: string }
): boolean => {
  if (!evidence) return false;
  const reportedEpisode = String(row.encounterId ?? '').trim();
  const activeEpisode = resolveActiveEpisode(diff, run, evidence.clinicalEpisodeId);
  if (reportedEpisode && activeEpisode && reportedEpisode !== activeEpisode) return false;
  return reportPredatesAdmission(stamp, evidence);
};

export const resolveReportDischarge = (
  row: EgresoReportRow,
  evidence: CmaOriginEvidence = {}
) => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  const dischargeDay = correctedStamp(
    row.fechaEgreso,
    row.correctedDay,
    row.correctedTime
  ).correctedDay;
  const hasExactCmaBed = isCmaLocation(evidence.location) || isCmaBedLabel(row.bedLabel);
  const isSameDayCma =
    mapped.kind === 'alta' &&
    mapped.status === 'Vivo' &&
    hasExactCmaBed &&
    Boolean(evidence.admissionDate) &&
    toIsoDay(evidence.admissionDate ?? '') === dischargeDay;
  return isSameDayCma ? { ...mapped, kind: 'cma' as const } : mapped;
};

export const occupiedBedsByRun = (record: DailyRecord): Map<string, OccupiedBedEvidence> => {
  const byRun = new Map<string, OccupiedBedEvidence>();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    const key = patient.clinicalEpisodeId ? `episode:${patient.clinicalEpisodeId}` : run;
    if (key) byRun.set(key, {
        bedId,
        patientName: patient.patientName,
        rut: patient.rut,
        clinicalEpisodeId: patient.clinicalEpisodeId,
        admissionDate: patient.admissionDate,
        admissionTime: patient.admissionTime,
        location: patient.location,
      });
  }
  return byRun;
};

export const findOccupiedBed = (
  index: ReadonlyMap<string, OccupiedBedEvidence>,
  run?: string,
  episodeId?: string
): OccupiedBedEvidence | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.clinicalEpisodeId === episodeId) ??
  (normalizeRut(run) ? [...index.values()].find(entry =>
    normalizeRut(entry.rut) === normalizeRut(run)) : undefined);

export const occupiedClinicalCribsByRun = (
  record: DailyRecord
): Map<string, OccupiedClinicalCrib> => {
  const byRun = new Map<string, OccupiedClinicalCrib>();
  for (const [parentBedId, parent] of Object.entries(record.beds)) {
    const patient = parent?.clinicalCrib;
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    const key = patient.clinicalEpisodeId
      ? `episode:${patient.clinicalEpisodeId}` : run || `parent:${parentBedId}`;
    byRun.set(key, { parentBedId, parent, patient });
  }
  return byRun;
};

export const findOccupiedClinicalCrib = (
  index: ReadonlyMap<string, OccupiedClinicalCrib>,
  run?: string,
  episodeId?: string,
  parentBedId?: string
): OccupiedClinicalCrib | undefined =>
  (episodeId ? index.get(`episode:${episodeId}`) : undefined) ??
  [...index.values()].find(entry => episodeId && entry.patient.clinicalEpisodeId === episodeId) ??
  (normalizeRut(run) ? [...index.values()].find(entry =>
    normalizeRut(entry.patient.rut) === normalizeRut(run)) : undefined) ??
  (parentBedId ? index.get(`parent:${parentBedId}`) : undefined) ??
  [...index.values()].find(entry =>
    parentBedId && entry.parentBedId === parentBedId);

export const unchangedClinicalCribEpisodes = (
  diff: CensusImportDiff,
  occupied: ReadonlyMap<string, OccupiedClinicalCrib>
): Set<string> => {
  const plannedEpisodes = new Set([
    ...diff.admissions, ...diff.updates, ...diff.moves,
    ...diff.pendingAdministrativeDischarges, ...diff.conflicts,
  ].map(entry => entry.source?.encounterId).filter(Boolean));
  return new Set((diff.activeClinicalCribs ?? []).filter(crib =>
    !plannedEpisodes.has(crib.source.encounterId) &&
    Boolean(findOccupiedClinicalCrib(
      occupied, crib.patient.rut, crib.source.encounterId, crib.parentBedId
    ))
  ).map(crib => crib.source.encounterId));
};

export const reportEgresoFromRow = (row: EgresoReportRow): ReportEgreso => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  return {
    run: row.run,
    encounterId: row.encounterId,
    patientName: toTitleCaseName(row.patientName.replace(/\s+/g, ' ')),
    bedLabel: resolveReportBedId(row.bedLabel),
    destino: row.destino,
    fechaEgreso: row.fechaEgreso,
    kind: mapped.kind,
    status: mapped.status,
    edad: row.edad,
    servicio: row.servicio,
    diagnostico: row.diagnostico,
    ...correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime),
  };
};
