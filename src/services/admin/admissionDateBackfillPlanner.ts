import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';
import { deepClone } from '@/utils/deepClone';
import { normalizeDateOnly } from '@/utils/clinicalDayUtils';
import {
  getAvailableDates,
  getForDate,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  resolveAdmissionDateAudit,
  resolveAdmissionDateSuggestion,
} from '@/application/patient-flow/admissionDatePolicy';
import { createEpisodeAdmissionTracker } from '@/services/calculations/minsal/episodeTracker';
import type {
  AdmissionDateBackfillPlan,
  AdmissionDateBackfillSample,
  BackfillTarget,
} from '@/services/admin/admissionDateBackfillTypes';

const normalizeRutKey = (rut: string): string =>
  rut
    .replace(/[.\-\s]/g, '')
    .trim()
    .toUpperCase();

const hasPatientIdentity = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(patient?.patientName?.trim() && patient?.rut?.trim());

const collectTargetsFromDischarge = (date: string, discharge: DischargeData): BackfillTarget[] => {
  if (!discharge.originalData) return [];

  return [
    {
      scope: 'discharge',
      patient: discharge.originalData,
      date,
      bedId: discharge.bedId,
      bedName: discharge.bedName,
    },
  ];
};

const collectTargetsFromTransfer = (date: string, transfer: TransferData): BackfillTarget[] => {
  if (!transfer.originalData) return [];

  return [
    {
      scope: 'transfer',
      patient: transfer.originalData,
      date,
      bedId: transfer.bedId,
      bedName: transfer.bedName,
    },
  ];
};

const collectTargetsFromRecord = (record: DailyRecord): BackfillTarget[] => {
  const targets: BackfillTarget[] = [];

  Object.entries(record.beds).forEach(([bedId, patient]) => {
    if (hasPatientIdentity(patient)) {
      targets.push({
        scope: 'bed',
        patient,
        date: record.date,
        bedId,
        bedName: patient.bedName || bedId,
      });
    }

    if (hasPatientIdentity(patient.clinicalCrib)) {
      targets.push({
        scope: 'clinicalCrib',
        patient: patient.clinicalCrib,
        date: record.date,
        bedId,
        bedName: patient.bedName ? `Cuna (${patient.bedName})` : `Cuna (${bedId})`,
      });
    }
  });

  record.discharges?.forEach(discharge => {
    targets.push(...collectTargetsFromDischarge(record.date, discharge));
  });

  record.transfers?.forEach(transfer => {
    targets.push(...collectTargetsFromTransfer(record.date, transfer));
  });

  return targets;
};

const applyAdmissionDateCorrection = (
  target: BackfillTarget,
  firstSeenDate: string
): AdmissionDateBackfillSample | null => {
  const audit = resolveAdmissionDateAudit({
    recordDate: target.date,
    admissionDate: target.patient.admissionDate,
    admissionTime: target.patient.admissionTime,
    firstSeenDate,
  });

  const suggestedAdmissionDate =
    audit.suggestedAdmissionDate ||
    resolveAdmissionDateSuggestion(firstSeenDate, target.patient.admissionTime) ||
    firstSeenDate;
  const normalizedCurrentAdmission = normalizeDateOnly(target.patient.admissionDate);
  const normalizedFirstSeen = normalizeDateOnly(target.patient.firstSeenDate);

  const needsAdmissionUpdate = normalizedCurrentAdmission !== suggestedAdmissionDate;
  const needsFirstSeenUpdate = normalizedFirstSeen !== firstSeenDate;

  if (!needsAdmissionUpdate && !needsFirstSeenUpdate) {
    return null;
  }

  target.patient.firstSeenDate = firstSeenDate;
  target.patient.admissionDate = suggestedAdmissionDate;

  return {
    scope: target.scope,
    date: target.date,
    bedId: target.bedId,
    bedName: target.bedName,
    patientName: target.patient.patientName,
    rut: target.patient.rut,
    previousAdmissionDate: normalizedCurrentAdmission,
    suggestedAdmissionDate,
    firstSeenDate,
  };
};

export const buildAdmissionDateBackfillPlan = async (): Promise<AdmissionDateBackfillPlan> => {
  const dates = (await getAvailableDates()).slice().sort();
  const records = [];
  const episodeTracker = createEpisodeAdmissionTracker();
  let reviewedEntries = 0;

  for (const date of dates) {
    const record = await getForDate(date);
    if (!record) {
      continue;
    }

    const clonedRecord = deepClone(record);
    const corrections: AdmissionDateBackfillSample[] = [];
    const targets = collectTargetsFromRecord(clonedRecord);

    Object.values(clonedRecord.beds || {}).forEach(bed => {
      episodeTracker.observeBed(bed, date);
    });

    for (const target of targets) {
      const rutKey = normalizeRutKey(target.patient.rut);
      if (!rutKey) continue;

      reviewedEntries += 1;

      const firstSeenDate =
        episodeTracker.resolveEpisodeStartDate(target.patient.rut, target.date) || target.date;
      const correction = applyAdmissionDateCorrection(target, firstSeenDate);
      if (correction) {
        corrections.push(correction);
      }
    }

    record.discharges?.forEach(discharge => {
      episodeTracker.closeEpisode(discharge.rut);
    });

    record.transfers?.forEach(transfer => {
      episodeTracker.closeEpisode(transfer.rut);
    });

    if (corrections.length > 0) {
      records.push({
        record: clonedRecord,
        corrections,
      });
    }
  }

  return {
    records,
    scannedDays: dates.length,
    reviewedEntries,
  };
};
