import { MONTH_NAMES } from '@/constants/export';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { formatDateDDMMYYYY } from '@/services/exporters/excel/formatters';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { PatientData } from '@/services/contracts/patientServiceContracts';
import {
  getActiveCma,
  getStatisticalDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

import type {
  CensusHiddenSheetMonthContext,
  CensusLogicalSnapshotSheet,
  CensusWorkbookSnapshotSheet,
  ExtractedPatientRow,
  SummaryDayRow,
  UpcPatientAggregate,
  UpcPatientPresentation,
} from './censusHiddenSheetsContracts';
import { SPECIALTY_COLUMNS } from './censusHiddenSheetsConfig';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

const normalizeText = (value?: string | null): string => (value || '').trim();

const normalizePatientKey = (patient: PatientData): string =>
  normalizeText(patient.rut) || normalizeText(patient.patientName).toLocaleLowerCase('es-CL');

const isRealPatient = (patient?: PatientData | null): patient is PatientData =>
  Boolean(patient && !patient.isBlocked && normalizeText(patient.patientName));

const sortByDate = <T extends { date: string }>(items: T[]) =>
  [...items].sort((a, b) => a.date.localeCompare(b.date));

const areConsecutiveDates = (previousDate: string, nextDate: string): boolean => {
  const previous = new Date(`${previousDate}T00:00:00Z`);
  const next = new Date(`${nextDate}T00:00:00Z`);
  return next.getTime() - previous.getTime() === 24 * 60 * 60 * 1000;
};

const formatSegment = (bedCode: string, startDate: string, endDate: string): string => {
  const start = formatDateDDMMYYYY(startDate);
  const end = formatDateDDMMYYYY(endDate);
  return start === end ? `${bedCode} (${start})` : `${bedCode} (${start} a ${end})`;
};

const buildBedHistory = (dailyRecords: Array<{ date: string; bedCode: string }>) => {
  if (dailyRecords.length === 0) {
    return { history: '', changedBed: false };
  }

  const ordered = sortByDate(dailyRecords);
  const segments: string[] = [];
  let currentBed = ordered[0].bedCode;
  let segmentStart = ordered[0].date;
  let previousDate = ordered[0].date;

  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const shouldExtend =
      current.bedCode === currentBed && areConsecutiveDates(previousDate, current.date);

    if (!shouldExtend) {
      segments.push(formatSegment(currentBed, segmentStart, previousDate));
      currentBed = current.bedCode;
      segmentStart = current.date;
    }

    previousDate = current.date;
  }

  segments.push(formatSegment(currentBed, segmentStart, previousDate));
  return {
    history: segments.join(' → '),
    changedBed: segments.length > 1,
  };
};

const resolvePeriodLabel = (uciDays: number, utiDays: number): 'UCI' | 'UTI' | 'Mixto' => {
  if (uciDays > 0 && utiDays > 0) {
    return 'Mixto';
  }
  if (uciDays > 0) {
    return 'UCI';
  }
  return 'UTI';
};

/**
 * Extracts the clinical rows that should count as real patients in hidden-sheet summaries.
 * Empty beds and blocked beds are excluded; clinical cribs are promoted as independent rows.
 */
const collectRealPatients = (record: CensusExportRecord): ExtractedPatientRow[] => {
  const patients: ExtractedPatientRow[] = [];

  Object.entries(record.beds || {}).forEach(([bedId, bedData]) => {
    if (!bedData) return;

    const mainBedCode = bedData.location ? `${bedId} (${bedData.location})` : bedId;
    if (isRealPatient(bedData)) {
      patients.push({ patient: bedData, bedCode: mainBedCode });
    }

    if (isRealPatient(bedData.clinicalCrib)) {
      const cribBedCode = bedData.location ? `${bedId}-C (${bedData.location})` : `${bedId}-C`;
      patients.push({ patient: bedData.clinicalCrib, bedCode: cribBedCode });
    }
  });

  return patients;
};

export const getMonthContext = (date: string): CensusHiddenSheetMonthContext => {
  const [year, month] = date.split('-');
  const monthIndex = Number(month) - 1;

  return {
    year,
    monthIndex,
    monthName: (MONTH_NAMES[monthIndex] || '').toUpperCase(),
    daysInMonth: new Date(Number(year), Number(month), 0).getDate(),
  };
};

/**
 * Hidden sheets must operate on one logical census snapshot per calendar date.
 * The builder passes descriptors in precedence order, so the last descriptor for a date wins.
 */
export const buildLogicalSnapshotSheets = (
  sheets: CensusWorkbookSnapshotSheet[]
): CensusLogicalSnapshotSheet[] => {
  const byDate = new Map<string, CensusLogicalSnapshotSheet>();

  sheets.forEach(sheet => {
    byDate.set(sheet.record.date, {
      ...sheet,
      displaySheetName: sheet.resolvedSheetName,
    });
  });

  return [...byDate.values()].sort((a, b) => a.record.date.localeCompare(b.record.date));
};

export const buildSummaryRows = (sheets: CensusLogicalSnapshotSheet[]): SummaryDayRow[] =>
  sheets.map(sheet => {
    const stats = calculateStats(sheet.record.beds);
    const specialtyCounts = Object.fromEntries(SPECIALTY_COLUMNS.map(item => [item.key, 0]));

    collectRealPatients(sheet.record).forEach(({ patient }) => {
      const specialty = normalizeText(patient.specialty);
      if (specialtyCounts[specialty] !== undefined) {
        specialtyCounts[specialty] += 1;
      }
    });

    const denominator = stats.occupiedBeds + stats.availableCapacity;
    const discharges = getStatisticalDischarges(sheet.record.discharges);
    const transfers = getActiveTransfers(sheet.record.transfers);
    const cma = getActiveCma(sheet.record.cma);

    return {
      displaySheetName: sheet.displaySheetName,
      occupiedBeds: stats.occupiedBeds,
      availableCapacity: stats.availableCapacity,
      blockedBeds: stats.blockedBeds,
      cribs: stats.clinicalCribsCount + stats.companionCribs,
      occupancyRate: denominator > 0 ? stats.occupiedBeds / denominator : null,
      discharges: discharges.filter(item => item.status === 'Vivo').length,
      transfers: transfers.length,
      cma: cma.length,
      deceased: discharges.filter(item => item.status === 'Fallecido').length,
      specialtyCounts,
    };
  });

/**
 * Aggregates UPC patients across logical snapshots and preserves bed history by day.
 * RUT is the preferred identity key; patient name is the fallback when RUT is absent.
 */
export const buildUpcPatients = (
  sheets: CensusLogicalSnapshotSheet[]
): UpcPatientPresentation[] => {
  const patients = new Map<string, UpcPatientAggregate>();

  sheets.forEach(sheet => {
    collectRealPatients(sheet.record).forEach(({ patient, bedCode }) => {
      const effectiveUpcState = resolveEffectiveUpcState({
        bedId: patient.bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      });
      if (!effectiveUpcState.isUpc || !effectiveUpcState.classification) {
        return;
      }

      const dailyClassification = effectiveUpcState.classification === 'UPC_UCI' ? 'UCI' : 'UTI';

      const key = normalizePatientKey(patient);
      if (!key) return;

      const current = patients.get(key);
      const nextDailyRecords = current?.dailyRecords ? [...current.dailyRecords] : [];
      if (!nextDailyRecords.some(entry => entry.date === sheet.record.date)) {
        nextDailyRecords.push({
          date: sheet.record.date,
          bedCode,
          classification: dailyClassification,
        });
      }

      if (!current) {
        patients.set(key, {
          key,
          patientName: normalizeText(patient.patientName),
          rut: normalizeText(patient.rut),
          age: normalizeText(patient.age),
          diagnosis: normalizeText(patient.pathology),
          specialty: normalizeText(patient.specialty),
          admissionDate: normalizeText(patient.admissionDate),
          firstSeenDate: sheet.record.date,
          dailyRecords: nextDailyRecords,
          uciDays: dailyClassification === 'UCI' ? 1 : 0,
          utiDays: dailyClassification === 'UTI' ? 1 : 0,
        });
        return;
      }

      current.dailyRecords = nextDailyRecords;
      current.uciDays += dailyClassification === 'UCI' ? 1 : 0;
      current.utiDays += dailyClassification === 'UTI' ? 1 : 0;
    });
  });

  return [...patients.values()]
    .map(patient => {
      const orderedRecords = sortByDate(patient.dailyRecords);
      const { history, changedBed } = buildBedHistory(orderedRecords);

      return {
        ...patient,
        dailyRecords: orderedRecords,
        totalDays: patient.uciDays + patient.utiDays,
        daysDetail: orderedRecords.map(entry => formatDateDDMMYYYY(entry.date)).join('\n'),
        history,
        changedBed,
        periodLabel: resolvePeriodLabel(patient.uciDays, patient.utiDays),
      };
    })
    .sort((a, b) =>
      a.firstSeenDate === b.firstSeenDate
        ? a.patientName.localeCompare(b.patientName, 'es')
        : a.firstSeenDate.localeCompare(b.firstSeenDate)
    );
};
