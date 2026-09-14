import { normalizeRut } from '@/utils/rutUtils';
import type { EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import { correctedStamp } from './egresoReportPolicy';
import { previousCensusDate } from './previousCensusContinuity';

export interface PreviousCensusEgresoCandidate extends EgresoLookupTarget {
  patientName: string;
  fromClinicalCrib: boolean;
}

const normalizedName = (value: string | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

export const previousCensusEgresoIdentity = (
  run: string | undefined,
  patientName: string | undefined,
  dischargeDay: string
): string => {
  const normalizedRun = normalizeRut(run);
  const name = normalizedName(patientName);
  return normalizedRun && name && /^\d{4}-\d{2}-\d{2}$/.test(dischargeDay)
    ? `${normalizedRun}|${dischargeDay}|${name}`
    : '';
};

export const previousCensusEgresoRowIdentity = (row: EgresoReportRow): string => {
  const day =
    correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime).correctedDay ?? '';
  return previousCensusEgresoIdentity(row.run, row.patientName, day);
};

interface PreviousOccupant {
  patient: PatientData;
  fromClinicalCrib: boolean;
}

const occupantIdentityWithoutDay = (patient: PatientData): string =>
  `${normalizeRut(patient.rut)}|${normalizedName(patient.patientName)}`;

/**
 * Builds exact lookup targets only when one report row maps to one identified D-1 occupant.
 * The lookup still has to confirm the exact episode's administrative discharge; absence alone
 * never creates a movement. Shared maternal RUNs are safe because the row name separates mother
 * and newborn before the exact episode query is issued.
 */
export const previousCensusEgresoCandidates = (
  previous: DailyRecord | null | undefined,
  rows: readonly EgresoReportRow[],
  reportDate: string
): PreviousCensusEgresoCandidate[] => {
  if (!previous || previous.date !== previousCensusDate(reportDate)) return [];
  const eligibleRows = rows.filter(row => {
    const day = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime).correctedDay;
    return day === previous.date || day === reportDate;
  });
  const rowIdentityCount = new Map<string, number>();
  for (const row of eligibleRows) {
    const identity = previousCensusEgresoRowIdentity(row);
    if (identity) rowIdentityCount.set(identity, (rowIdentityCount.get(identity) ?? 0) + 1);
  }

  const occupants: PreviousOccupant[] = Object.values(previous.beds).flatMap(patient => [
    ...(patient?.patientName?.trim() ? [{ patient, fromClinicalCrib: false }] : []),
    ...(patient?.clinicalCrib?.patientName?.trim()
      ? [{ patient: patient.clinicalCrib, fromClinicalCrib: true }]
      : []),
  ]);
  const occupantIdentityCount = new Map<string, number>();
  for (const occupant of occupants) {
    const identity = occupantIdentityWithoutDay(occupant.patient);
    occupantIdentityCount.set(identity, (occupantIdentityCount.get(identity) ?? 0) + 1);
  }

  return occupants.flatMap(({ patient, fromClinicalCrib }) => {
    const encounterId = patient.clinicalEpisodeId?.trim() ?? '';
    const patientIdentity = occupantIdentityWithoutDay(patient);
    if (!/^\d+$/.test(encounterId) || occupantIdentityCount.get(patientIdentity) !== 1) return [];
    const matchingRows = eligibleRows.filter(
      row => `${normalizeRut(row.run)}|${normalizedName(row.patientName)}` === patientIdentity
    );
    if (matchingRows.length !== 1) return [];
    const row = matchingRows[0];
    const rowIdentity = previousCensusEgresoRowIdentity(row);
    if (!rowIdentity || rowIdentityCount.get(rowIdentity) !== 1) return [];
    const dischargeDay = correctedStamp(
      row.fechaEgreso,
      row.correctedDay,
      row.correctedTime
    ).correctedDay;
    if (!dischargeDay) return [];
    return [
      {
        run: patient.rut ?? '',
        encounterId,
        dischargeDay,
        patientName: patient.patientName ?? '',
        fromClinicalCrib,
      },
    ];
  });
};
