import { normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenActiveBedAssignment, RayenEncounter } from '../contracts/rayenSnapshot';
import {
  parseStatisticalEgresoInstant,
  parseStatisticalEgresoStamp,
} from '../mapping/reportEgresoDateTime';
import { historicalReconstructionConflict as unresolvedConflict } from './historicalReconstructionConflicts';
import { historicalEncounterFromLocal } from './historicalEncounterFromLocal';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';

export interface HistoricalCandidate {
  encounter: RayenEncounter;
  reportRow?: EgresoReportRow;
  localBedId?: string;
  exactEgresoVerified?: boolean;
  exactDischargeAt?: string;
}

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
    if (!/^\d+$/.test(episode) || !normalizeRut(row.run) || !stamp) continue;
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

export const invalidReportBackedConflicts = (
  reportRows: EgresoReportRow[],
  validRows: ReadonlyMap<string, EgresoReportRow>
): ConflictEntry[] => {
  const surfacedEpisodes = new Set<string>();
  const conflicts: ConflictEntry[] = [];
  for (const row of reportRows) {
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
    conflicts.push(
      unresolvedConflict(
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
      )
    );
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
