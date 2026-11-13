import type { PatientData } from '@/types/domain/patient';

import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenActiveBedAssignment, RayenEncounter } from '../contracts/rayenSnapshot';
import {
  parseStatisticalEgresoInstant,
  parseStatisticalEgresoStamp,
} from '../mapping/reportEgresoDateTime';
import { historicalReconstructionConflict as unresolvedConflict } from './historicalReconstructionConflicts';
import { historicalEncounterFromLocal } from './historicalEncounterFromLocal';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';

import { normalizedName } from './previousCensusEgresoCandidates';
import { resolveReportCribParentBedId } from '../mapping/resolveReportBed';

export interface HistoricalCandidate {
  encounter: RayenEncounter;
  reportRow?: EgresoReportRow;
  localBedId?: string;
  exactEgresoVerified?: boolean;
  exactDischargeAt?: string;
}

/** A closed RN may retain its known historical mother; a report's crib label is insufficient. */
export const verifiedHistoricalCribParent = (
  record: DailyRecord,
  encounter: RayenEncounter,
  row?: EgresoReportRow
): string | undefined => {
  const parent = record.beds[encounter.clinicalCribParentBedId ?? ''];
  return row?.exactEpisodeVerification === 'verified' &&
    row.fromClinicalCrib &&
    parent?.clinicalCrib?.clinicalEpisodeId === encounter.encounterId &&
    /^\d+$/.test(parent.clinicalEpisodeId ?? '')
    ? parent.clinicalEpisodeId
    : undefined;
};

export const reportClinicalStamp = (
  row: EgresoReportRow
): { iso: string; calendarIso: string; hhmm: string } | null => {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(row.correctedDay ?? '') &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.correctedTime ?? '')
  ) {
    const iso = row.correctedDay as string;
    return { iso, calendarIso: iso, hhmm: row.correctedTime as string };
  }
  const parsed =
    parseStatisticalEgresoStamp(row.fechaEgreso) ?? parseStatisticalEgresoInstant(row.fechaEgreso);
  return parsed ? { iso: parsed.iso, calendarIso: parsed.calendarIso, hhmm: parsed.hhmm } : null;
};

export const latestReportRowsByEpisode = (
  reportRows: EgresoReportRow[]
): Map<string, EgresoReportRow> => {
  const byEpisode = new Map<string, EgresoReportRow>();
  for (const row of reportRows) {
    const episode = String(row.encounterId ?? '').trim();
    const stamp = reportClinicalStamp(row);
    const verifiedCrib = row.fromClinicalCrib && row.exactEpisodeVerification === 'verified';
    if (!/^\d+$/.test(episode) || (!normalizeRut(row.run) && !verifiedCrib) || !stamp) continue;
    const prior = byEpisode.get(episode);
    const priorStamp = prior ? reportClinicalStamp(prior) : null;
    if (
      !priorStamp ||
      `${stamp.calendarIso}T${stamp.hhmm}` > `${priorStamp.calendarIso}T${priorStamp.hhmm}`
    ) {
      byEpisode.set(episode, row);
    }
  }
  return byEpisode;
};

export const relevantHistoricalReportRows = (
  reportRows: EgresoReportRow[],
  censusDay: string,
  record: DailyRecord,
  encounters: RayenEncounter[]
): EgresoReportRow[] => {
  // Bulk reports include the previous night's discharges. An unlinked row from
  // an earlier census cannot block this day when no local/live patient references it.
  const referencedRuns = new Set(
    [
      ...encounters.map(encounter => normalizeRut(encounter.run)),
      ...Object.values(record.beds).flatMap(patient => [
        normalizeRut(patient.rut),
        normalizeRut(patient.clinicalCrib?.rut ?? ''),
      ]),
    ].filter(Boolean)
  );
  return reportRows.filter(row => {
    const stamp = reportClinicalStamp(row);
    const run = normalizeRut(row.run);
    return !stamp || stamp.iso >= censusDay || !run || referencedRuns.has(run);
  });
};

/** Only explains a recorded event; never supplies identity evidence to apply a discharge. */
const hasRecordedNewbornDischarge = (
  row: EgresoReportRow,
  rows: EgresoReportRow[],
  record: DailyRecord
): boolean => {
  const bedId = resolveReportCribParentBedId(row.bedLabel);
  const stamp = reportClinicalStamp(row);
  const name = normalizedName(row.patientName);
  if (
    !bedId ||
    !stamp ||
    stamp.iso !== record.date ||
    !name ||
    row.encounterId?.trim() ||
    isValidRut(row.run)
  )
    return false;
  // A current occupant may be a readmission. Keep its exact-episode review intact.
  if (
    Object.values(record.beds).some(bed =>
      [bed, bed.clinicalCrib].some(
        patient => patient?.patientName?.trim() && normalizedName(patient.patientName) === name
      )
    )
  )
    return false;
  const documents = new Set(
    rows
      .filter(other => {
        const otherStamp = reportClinicalStamp(other);
        return (
          resolveReportCribParentBedId(other.bedLabel) === bedId &&
          otherStamp?.calendarIso === stamp.calendarIso &&
          otherStamp.hhmm === stamp.hhmm &&
          normalizedName(other.patientName) === name
        );
      })
      .map(other => other.run.trim())
  );
  if (documents.size !== 1) return false;
  return (
    (record.discharges ?? []).filter(
      movement =>
        !movement.deletedAt &&
        movement.isNested === true &&
        movement.bedId === bedId &&
        !movement.rut?.trim() &&
        !movement.originalData?.rut?.trim() &&
        movement.movementDate === stamp.calendarIso &&
        movement.time === stamp.hhmm &&
        normalizedName(movement.patientName) === name
    ).length === 1
  );
};

export const invalidReportBackedConflicts = (
  reportRows: EgresoReportRow[],
  validRows: ReadonlyMap<string, EgresoReportRow>,
  record: DailyRecord
): ConflictEntry[] => {
  const surfacedEpisodes = new Set<string>();
  const conflicts: ConflictEntry[] = [];
  for (const row of reportRows) {
    if (hasRecordedNewbornDischarge(row, reportRows, record)) continue;
    const encounterId = String(row.encounterId ?? '').trim();
    const validEncounterId = /^\d+$/.test(encounterId);
    const conflictKey = validEncounterId
      ? encounterId
      : `${normalizeRut(row.run)}|${row.patientName}|${row.fechaEgreso}`;
    if ((validEncounterId && validRows.has(encounterId)) || surfacedEpisodes.has(conflictKey))
      continue;
    const missingEpisode = !validEncounterId;
    const missingIdentity = !normalizeRut(row.run);
    const missingTimestamp = !reportClinicalStamp(row);
    if (!missingEpisode && !missingIdentity && !missingTimestamp) continue;
    surfacedEpisodes.add(conflictKey);
    conflicts.push({
      ...unresolvedConflict(
        {
          encounterId,
          run: row.run,
          firstGivenName: row.patientName.trim(),
          firstFamilyName: '',
          diagnosis: row.diagnostico,
          service: row.servicio,
        },
        missingEpisode
          ? 'el reporte administrativo no contiene un episodio clínico verificable.'
          : missingIdentity && missingTimestamp
            ? 'el reporte administrativo tiene RUN y fecha de egreso inválidos.'
            : missingIdentity
              ? 'el reporte administrativo no contiene un RUN verificable.'
              : 'el reporte administrativo no contiene una fecha de egreso verificable.'
      ),
      diagnostic: {
        source: 'gestion-camas/egresos',
        sourceTimestamp: row.fechaEgreso.slice(0, 100),
        ...(reportClinicalStamp(row) ? { sourceClinicalDay: reportClinicalStamp(row)!.iso } : {}),
        bedId: (row.bedLabel ?? '').slice(0, 80),
      },
    });
  }
  return conflicts;
};

export const reportBackedCandidates = (
  record: DailyRecord,
  byEpisode: ReadonlyMap<string, EgresoReportRow>,
  liveEncounterIds: ReadonlySet<string>
): HistoricalCandidate[] => {
  const localByEpisode = new Map<
    string,
    { patient: PatientData; clinicalCribParentBedId?: string }
  >();
  for (const [bedId, bed] of Object.entries(record.beds)) {
    for (const entry of [
      { patient: bed },
      { patient: bed.clinicalCrib, clinicalCribParentBedId: bedId },
    ]) {
      const episode = entry.patient?.clinicalEpisodeId?.trim() ?? '';
      if (entry.patient?.patientName?.trim() && !entry.patient.isBlocked && /^\d+$/.test(episode)) {
        localByEpisode.set(
          episode,
          entry as { patient: PatientData; clinicalCribParentBedId?: string }
        );
      }
    }
  }
  const candidates: HistoricalCandidate[] = [];
  for (const [encounterId, row] of byEpisode) {
    if (liveEncounterIds.has(encounterId)) continue;
    const local = localByEpisode.get(encounterId);
    candidates.push({
      encounter: local
        ? historicalEncounterFromLocal(local.patient, local.clinicalCribParentBedId)
        : {
            encounterId,
            run: row.run,
            firstGivenName: row.patientName.trim(),
            firstFamilyName: '',
            diagnosis: row.diagnostico,
            service: row.servicio,
          },
      reportRow: row,
    });
  }
  return candidates;
};

/**
 * Restores an active episode omitted by Ficha Medico after a service or bed change. Gestión de
 * Camas proves the episode is still active; its historical bed is verified later from traceability.
 */
export const activeBedBackedCandidates = (
  record: DailyRecord,
  assignments: RayenActiveBedAssignment[],
  alreadyReferencedEpisodes: ReadonlySet<string>
): HistoricalCandidate[] => {
  const localByEpisode = new Map<string, { patient: PatientData; bedId: string }>();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    const episodeId = patient.clinicalEpisodeId?.trim() ?? '';
    if (
      patient.patientName?.trim() &&
      !patient.isBlocked &&
      /^\d+$/.test(episodeId) &&
      !isPavilionRecoveryLocation(patient.location)
    ) {
      localByEpisode.set(episodeId, { patient, bedId });
    }
  }

  return assignments.flatMap(assignment => {
    if (
      alreadyReferencedEpisodes.has(assignment.encounterId) ||
      isPavilionRecoveryLocation(assignment.bedId)
    )
      return [];
    const local = localByEpisode.get(assignment.encounterId);
    return local
      ? [{ encounter: historicalEncounterFromLocal(local.patient), localBedId: local.bedId }]
      : [];
  });
};
