import { resolveAccreditedClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { isCalendarDate } from '@/utils/clinicalDateUtils';

export interface MinsalEpisodeTraceabilityRow {
  clinicalEpisodeId?: string;
  name: string;
  rut: string;
  documentType?: string;
  diagnosis?: string;
  date: string;
  bedName?: string;
  admissionDate?: string;
  dischargeDate?: string;
}

export interface MinsalOccupiedBedSubject {
  clinicalEpisodeId?: string;
  patientName?: string;
  rut?: string;
  documentType?: string;
  admissionDate?: string;
}

export interface MinsalExitMovementSubject {
  clinicalEpisodeId?: string;
  patientName?: string;
  rut?: string;
  documentType?: string;
  admissionDate?: string;
  movementDate?: string;
  movementDateSource?: string;
  originalData?: {
    clinicalEpisodeId?: string;
    documentType?: string;
    admissionDate?: string;
  };
}

const normalizeIsoDate = (value?: string): string | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  const datePart = (value.split('T')[0] || '').trim();
  return isCalendarDate(datePart) ? datePart : undefined;
};

const normalizePatientName = (value?: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeDocumentKey = (rut?: string, documentType?: string): string => {
  const trimmed = String(rut || '').trim();
  if (!trimmed) return '';
  if (documentType === 'Pasaporte') {
    return `passport:${trimmed.toUpperCase()}`;
  }
  return `rut:${trimmed.replace(/[.\-\s]/g, '').toUpperCase()}`;
};

const resolveMovementAccreditedEpisodeId = (
  movement?: MinsalExitMovementSubject
): string | undefined =>
  resolveAccreditedClinicalEpisodeId(movement) ??
  resolveAccreditedClinicalEpisodeId(movement?.originalData);

const resolveExplicitMovementAdmissionDate = (
  movement?: MinsalExitMovementSubject
): string | undefined =>
  normalizeIsoDate(movement?.admissionDate) ??
  normalizeIsoDate(movement?.originalData?.admissionDate);

const resolveExitDate = (movement: MinsalExitMovementSubject, recordDate: string): string => {
  if (movement.movementDateSource === 'official') {
    const officialDate = normalizeIsoDate(movement.movementDate);
    if (officialDate) return officialDate;
  }
  return recordDate;
};

const buildLegacyEpisodeKey = (documentKey: string, admissionDate: string): string =>
  `${documentKey}|${admissionDate}`;

/**
 * Resolves the bed-day row's admission date without letting a closing same-day legacy episode
 * overwrite a fresh readmission whose bed explicitly declares `admissionDate === recordDate`.
 */
export const resolveBedDayAdmissionDate = ({
  patient,
  trackedAdmissionDate,
  recordDate,
  sameDayExits,
}: {
  patient: MinsalOccupiedBedSubject;
  trackedAdmissionDate?: string;
  recordDate: string;
  sameDayExits: readonly MinsalExitMovementSubject[];
}): string | undefined => {
  if (resolveAccreditedClinicalEpisodeId(patient)) {
    return trackedAdmissionDate;
  }

  const explicitBedAdmission = normalizeIsoDate(patient.admissionDate);
  const trackedDate = normalizeIsoDate(trackedAdmissionDate);
  if (!explicitBedAdmission || !trackedDate || explicitBedAdmission <= trackedDate) {
    return trackedAdmissionDate;
  }

  const documentKey = normalizeDocumentKey(patient.rut, patient.documentType);
  if (!documentKey) {
    return explicitBedAdmission;
  }

  const hasClosingEarlierExit = sameDayExits.some(exit => {
    const exitDocKey = normalizeDocumentKey(
      exit.rut,
      exit.documentType || exit.originalData?.documentType
    );
    if (exitDocKey !== documentKey) return false;
    const explicitExitAdmission = resolveExplicitMovementAdmissionDate(exit);
    return !explicitExitAdmission || explicitExitAdmission < explicitBedAdmission;
  });

  return hasClosingEarlierExit && explicitBedAdmission === recordDate
    ? explicitBedAdmission
    : trackedAdmissionDate;
};

interface OpenLegacyRowEntry {
  row: MinsalEpisodeTraceabilityRow;
  name: string;
  date: string;
}

interface PendingDayExit {
  accreditedEpisodeId?: string;
  documentKey: string;
  explicitAdmissionDate?: string;
  name: string;
  exitDate: string;
}

/**
 * Attributes discharge/transfer dates to occupied bed-day rows per clinical episode.
 *
 * Rules:
 * - Accredited `clinicalEpisodeId` (`ep_...`) matches strictly by episode id (never falls back to RUT).
 * - Official Eloísa `movementDate` (`movementDateSource === 'official'`) prevails over `record.date`.
 * - Legacy rows without an accredited episode id (`undefined` or `legacy_ep_...`) only match when
 *   document + documentType + explicit admissionDate + patient name point unambiguously to one open
 *   legacy episode and no open accredited episode shares that document.
 * - Undocumented patients without an accredited episode id and ambiguous legacy records stay unattributed.
 */
export const createMinsalEpisodeExitTracker = () => {
  const openByEpisode = new Map<
    string,
    { documentKey: string; rows: MinsalEpisodeTraceabilityRow[] }
  >();
  const openAccreditedByDocument = new Map<string, Set<string>>();
  const openByLegacyKey = new Map<string, OpenLegacyRowEntry[]>();
  const openLegacyKeysByDocument = new Map<string, Set<string>>();
  const ambiguousLegacyKeys = new Set<string>();

  let currentDate = '';
  let seenDocumentsOnCurrentDate = new Set<string>();
  let pendingDayExits: PendingDayExit[] = [];

  const markDocumentLegacyKeysAmbiguous = (documentKey: string): void => {
    const keys = openLegacyKeysByDocument.get(documentKey);
    if (!keys) return;
    keys.forEach(key => ambiguousLegacyKeys.add(key));
  };

  const beginDay = (recordDate: string): void => {
    currentDate = recordDate;
    seenDocumentsOnCurrentDate = new Set<string>();
    pendingDayExits = [];
  };

  const observeOccupiedBedDay = (
    row: MinsalEpisodeTraceabilityRow,
    patient: MinsalOccupiedBedSubject,
    recordDate: string
  ): void => {
    if (recordDate !== currentDate) {
      beginDay(recordDate);
    }

    if (patient.documentType) {
      row.documentType = patient.documentType;
    }

    const accreditedEpisodeId = resolveAccreditedClinicalEpisodeId(patient);
    const documentKey = normalizeDocumentKey(patient.rut, patient.documentType);
    const hasSameDayDocumentCollision = Boolean(
      documentKey && seenDocumentsOnCurrentDate.has(documentKey)
    );

    if (documentKey) {
      if (hasSameDayDocumentCollision) {
        markDocumentLegacyKeysAmbiguous(documentKey);
      }
      seenDocumentsOnCurrentDate.add(documentKey);
    }

    if (accreditedEpisodeId) {
      row.clinicalEpisodeId = accreditedEpisodeId;
      const existing = openByEpisode.get(accreditedEpisodeId);
      if (existing) {
        existing.rows.push(row);
      } else {
        openByEpisode.set(accreditedEpisodeId, { documentKey, rows: [row] });
      }
      if (documentKey) {
        const docEpisodes = openAccreditedByDocument.get(documentKey) ?? new Set<string>();
        docEpisodes.add(accreditedEpisodeId);
        openAccreditedByDocument.set(documentKey, docEpisodes);
      }
      return;
    }

    // Legacy matching requires an explicit admissionDate on the bed (never synthesized from record.date).
    const explicitAdmissionDate = normalizeIsoDate(patient.admissionDate);
    if (!documentKey || !explicitAdmissionDate) {
      return;
    }

    const legacyKey = buildLegacyEpisodeKey(documentKey, explicitAdmissionDate);
    const name = normalizePatientName(patient.patientName);
    const existing = openByLegacyKey.get(legacyKey) ?? [];

    if (
      hasSameDayDocumentCollision ||
      existing.some(entry => entry.date === recordDate) ||
      existing.some(entry => entry.name && name && entry.name !== name)
    ) {
      ambiguousLegacyKeys.add(legacyKey);
    }

    existing.push({ row, name, date: recordDate });
    openByLegacyKey.set(legacyKey, existing);

    const docKeys = openLegacyKeysByDocument.get(documentKey) ?? new Set<string>();
    docKeys.add(legacyKey);
    openLegacyKeysByDocument.set(documentKey, docKeys);
  };

  const recordExit = (movement: MinsalExitMovementSubject, recordDate: string): void => {
    if (recordDate !== currentDate) {
      beginDay(recordDate);
    }

    const accreditedEpisodeId = resolveMovementAccreditedEpisodeId(movement);
    const documentKey = normalizeDocumentKey(
      movement.rut,
      movement.documentType || movement.originalData?.documentType
    );

    pendingDayExits.push({
      accreditedEpisodeId,
      documentKey,
      explicitAdmissionDate: resolveExplicitMovementAdmissionDate(movement),
      name: normalizePatientName(movement.patientName),
      exitDate: resolveExitDate(movement, recordDate),
    });
  };

  const flushDayExits = (): void => {
    const legacyExitCounts = new Map<string, number>();
    pendingDayExits.forEach(exit => {
      if (exit.accreditedEpisodeId || !exit.documentKey || !exit.explicitAdmissionDate) return;
      const legacyKey = buildLegacyEpisodeKey(exit.documentKey, exit.explicitAdmissionDate);
      legacyExitCounts.set(legacyKey, (legacyExitCounts.get(legacyKey) ?? 0) + 1);
    });

    pendingDayExits.forEach(exit => {
      if (exit.accreditedEpisodeId) {
        const openEpisode = openByEpisode.get(exit.accreditedEpisodeId);
        if (openEpisode) {
          openEpisode.rows.forEach(row => {
            if (!row.date || row.date <= exit.exitDate) {
              row.dischargeDate = exit.exitDate;
            }
          });
          openByEpisode.delete(exit.accreditedEpisodeId);
          if (openEpisode.documentKey) {
            const docEpisodes = openAccreditedByDocument.get(openEpisode.documentKey);
            docEpisodes?.delete(exit.accreditedEpisodeId);
            if (docEpisodes && docEpisodes.size === 0) {
              openAccreditedByDocument.delete(openEpisode.documentKey);
            }
          }
        }
        return;
      }

      if (!exit.documentKey || !exit.explicitAdmissionDate) {
        return;
      }

      // If an accredited episode for the same document is also open, a legacy exit cannot safely claim it.
      const openAccredited = openAccreditedByDocument.get(exit.documentKey);
      if (openAccredited && openAccredited.size > 0) {
        markDocumentLegacyKeysAmbiguous(exit.documentKey);
        return;
      }

      const legacyKey = buildLegacyEpisodeKey(exit.documentKey, exit.explicitAdmissionDate);
      if ((legacyExitCounts.get(legacyKey) ?? 0) > 1) {
        ambiguousLegacyKeys.add(legacyKey);
        return;
      }

      if (ambiguousLegacyKeys.has(legacyKey)) {
        return;
      }

      const openEntries = openByLegacyKey.get(legacyKey);
      if (!openEntries || openEntries.length === 0) {
        return;
      }

      if (exit.name && openEntries.some(entry => entry.name && entry.name !== exit.name)) {
        ambiguousLegacyKeys.add(legacyKey);
        return;
      }

      openEntries.forEach(entry => {
        if (!entry.row.date || entry.row.date <= exit.exitDate) {
          entry.row.dischargeDate = exit.exitDate;
        }
      });

      openByLegacyKey.delete(legacyKey);
      const openDocKeys = openLegacyKeysByDocument.get(exit.documentKey);
      openDocKeys?.delete(legacyKey);
      if (openDocKeys && openDocKeys.size === 0) {
        openLegacyKeysByDocument.delete(exit.documentKey);
      }
    });

    pendingDayExits = [];
  };

  return {
    beginDay,
    observeOccupiedBedDay,
    recordExit,
    flushDayExits,
  };
};

export interface GroupedBedDayTraceabilityItem<TRow extends MinsalEpisodeTraceabilityRow> {
  groupKey: string;
  patient: TRow;
  daysCount: number;
  dates: string[];
}

const buildLegacyModalKey = (patient: MinsalEpisodeTraceabilityRow): string | null => {
  const documentKey = normalizeDocumentKey(patient.rut, patient.documentType);
  const admissionDate = normalizeIsoDate(patient.admissionDate);
  if (!documentKey || !admissionDate) {
    return null;
  }
  return `legacy:${documentKey}|${admissionDate}|${normalizePatientName(patient.name)}`;
};

/**
 * Groups bed-day rows for `TraceabilityModal` by clinical episode rather than by RUT.
 *
 * - Accredited episodes (`ep_...`) group strictly by episode id so readmissions stay separate.
 * - Legacy documented rows with a valid admission date group by `(documentType, document, admissionDate, name)`
 *   only when that legacy key never collides across multiple rows on the same calendar date.
 * - Undocumented, unanchored, or same-day-colliding legacy rows stay unmerged so distinct people never mix.
 */
export const groupBedDaysTraceabilityRows = <TRow extends MinsalEpisodeTraceabilityRow>(
  patients: readonly TRow[]
): Array<GroupedBedDayTraceabilityItem<TRow>> => {
  const datesByLegacyKey = new Map<string, Set<string>>();
  const collidingLegacyKeys = new Set<string>();

  patients.forEach(patient => {
    if (resolveAccreditedClinicalEpisodeId(patient)) return;
    const legacyKey = buildLegacyModalKey(patient);
    if (!legacyKey) return;
    const seenDates = datesByLegacyKey.get(legacyKey) ?? new Set<string>();
    if (seenDates.has(patient.date)) {
      collidingLegacyKeys.add(legacyKey);
    }
    seenDates.add(patient.date);
    datesByLegacyKey.set(legacyKey, seenDates);
  });

  const map = new Map<string, GroupedBedDayTraceabilityItem<TRow>>();

  patients.forEach((patient, index) => {
    const accreditedId = resolveAccreditedClinicalEpisodeId(patient);
    let groupKey: string;

    if (accreditedId) {
      groupKey = `episode:${accreditedId}`;
    } else {
      const legacyKey = buildLegacyModalKey(patient);
      groupKey =
        legacyKey && !collidingLegacyKeys.has(legacyKey) ? legacyKey : `unattributed:${index}`;
    }

    const existing = map.get(groupKey);
    if (existing) {
      existing.daysCount++;
      existing.dates.push(patient.date);
      const nextAdmission = existing.patient.admissionDate || patient.admissionDate;
      const nextDischarge = existing.patient.dischargeDate || patient.dischargeDate;
      const nextDiagnosis = existing.patient.diagnosis || patient.diagnosis;
      if (
        nextAdmission !== existing.patient.admissionDate ||
        nextDischarge !== existing.patient.dischargeDate ||
        nextDiagnosis !== existing.patient.diagnosis
      ) {
        existing.patient = {
          ...existing.patient,
          admissionDate: nextAdmission,
          dischargeDate: nextDischarge,
          diagnosis: nextDiagnosis,
        };
      }
    } else {
      map.set(groupKey, {
        groupKey,
        patient,
        daysCount: 1,
        dates: [patient.date],
      });
    }
  });

  return Array.from(map.values()).sort(
    (a, b) =>
      b.daysCount - a.daysCount ||
      a.patient.name.localeCompare(b.patient.name) ||
      (a.patient.admissionDate || '').localeCompare(b.patient.admissionDate || '') ||
      (a.patient.dischargeDate || '').localeCompare(b.patient.dischargeDate || '')
  );
};
