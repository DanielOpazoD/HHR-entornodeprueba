import { normalizeRut } from '@/utils/rutUtils';
import type { ConflictEntry } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import {
  parseStatisticalEgresoInstant,
  parseStatisticalEgresoStamp,
} from '../mapping/reportEgresoDateTime';
import { historicalReconstructionConflict as unresolvedConflict } from './historicalReconstructionConflicts';

export interface HistoricalCandidate {
  encounter: RayenEncounter;
  reportRow?: EgresoReportRow;
  localBedId?: string;
  exactEgresoVerified?: boolean;
  exactDischargeAt?: string;
}

const encounterFromLocal = (
  patient: PatientData,
  clinicalCribParentBedId?: string
): RayenEncounter => ({
  encounterId: patient.clinicalEpisodeId?.trim() ?? '',
  run: patient.rut,
  firstGivenName: patient.firstName?.trim() || patient.patientName,
  firstFamilyName: patient.lastName?.trim() || '',
  secondFamilyName: patient.secondLastName,
  admissionDatetime: patient.admissionDate
    ? `${patient.admissionDate}T${patient.admissionTime || '00:00'}:00`
    : undefined,
  diagnosis: patient.pathology,
  service: patient.location,
  clinicalCribParentBedId,
});

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
        ? encounterFromLocal(local.patient, local.clinicalCribParentBedId)
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
