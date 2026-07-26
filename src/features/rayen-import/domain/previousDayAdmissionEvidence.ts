import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import type {
  AdmissionEntry,
  CensusImportDiff,
  ConflictEntry,
} from '../contracts/censusImportDiff';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import { historicalEncounterFromLocal } from './historicalEncounterFromLocal';
import { isOccupied } from './applyCensusImportDiff';
import { clinicalAdmissionDay } from './censusDayPolicy';
import { isDischargedEncounter } from './censusReconciliationPredicates';
import {
  isPatientPreviousNightRollover,
  isPreviousNightRollover,
  patientAdmissionDay,
} from './previousDayAdmissionCorrections';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import { latestPatientFlowMovement, patientRunFromFlowReport } from '../mapping/parsePatientFlow';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { resolveClinicalDayBounds } from '@/utils/clinicalDayScheduleUtils';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

interface EvidenceDependencies {
  fetchReport: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
  snapshot?: RayenCensusSnapshot;
  currentRecord?: DailyRecord;
  reference?: Date;
}

const decodePdfBase64 = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const secondBefore = (localTimestamp: string): string => {
  const parsed = new Date(`${localTimestamp}Z`);
  if (Number.isNaN(parsed.getTime())) return localTimestamp;
  return new Date(parsed.getTime() - 1000).toISOString().slice(0, 19);
};

const candidateKey = (entry: AdmissionEntry): string =>
  entry.source?.encounterId?.trim() ||
  entry.patient.clinicalEpisodeId?.trim() ||
  `${normalizeRut(entry.patient.rut)}:${entry.bedId}`;

const principalSourceForUpdate = (
  source: RayenEncounter | undefined,
  parent: PatientData
): RayenEncounter | undefined => {
  const sameEpisode = Boolean(
    source?.encounterId &&
    parent.clinicalEpisodeId &&
    source.encounterId === parent.clinicalEpisodeId
  );
  const sameRun = Boolean(
    normalizeRut(source?.run) &&
    normalizeRut(parent.rut) &&
    normalizeRut(source?.run) === normalizeRut(parent.rut)
  );
  if (source && (sameEpisode || sameRun)) return source;
  if (
    parent.clinicalEpisodeId?.trim() &&
    parent.admissionDate?.trim() &&
    parent.admissionTime?.trim()
  ) {
    return historicalEncounterFromLocal(parent);
  }
  return undefined;
};

const candidatesFromCribUpdates = (diff: CensusImportDiff): AdmissionEntry[] =>
  diff.updates.flatMap(update => {
    const cribChange = update.changes.find(
      change =>
        change.field === 'clinicalCrib' &&
        !isOccupied(change.from as PatientData | undefined) &&
        isOccupied(change.to as PatientData | undefined)
    );
    const source = principalSourceForUpdate(update.source, update.patient);
    if (!cribChange || !source) return [];
    return [
      {
        bedId: update.bedId,
        isCma: false,
        patient: { ...update.patient, clinicalCrib: cribChange.to as PatientData },
        source,
      },
    ];
  });

const currentPrincipalFor = (
  record: DailyRecord | undefined,
  encounter: RayenEncounter
): PatientData | undefined =>
  Object.values(record?.beds ?? {}).find(patient => {
    if (!isOccupied(patient)) return false;
    if (encounter.encounterId && patient.clinicalEpisodeId) {
      return encounter.encounterId === patient.clinicalEpisodeId;
    }
    return (
      !!normalizeRut(encounter.run) && normalizeRut(encounter.run) === normalizeRut(patient.rut)
    );
  });

const snapshotReference = (snapshot: RayenCensusSnapshot, reference?: Date): Date => {
  if (reference) return reference;
  const capturedAt = new Date(snapshot.capturedAt);
  return Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;
};

const candidatesFromSnapshot = (
  diff: CensusImportDiff,
  censusDay: string,
  dependencies: EvidenceDependencies
): AdmissionEntry[] => {
  const snapshot = dependencies.snapshot;
  if (!snapshot) return [];
  const reference = snapshotReference(snapshot, dependencies.reference);
  return snapshot.encounters.flatMap(encounter => {
    if (isDischargedEncounter(encounter)) return [];
    const mapped = rayenToPatientData(encounter, reference);
    if (!mapped.bedId || mapped.isClinicalCrib) return [];
    const principalRut = normalizeRut(encounter.run);
    const activeCrib = (diff.activeClinicalCribs ?? []).find(
      crib =>
        crib.parentBedId === mapped.bedId &&
        (!normalizeRut(crib.principalRut) || normalizeRut(crib.principalRut) === principalRut)
    );
    const currentPrincipal = currentPrincipalFor(dependencies.currentRecord, encounter);
    const patient: PatientData = {
      ...(currentPrincipal ?? mapped.patient),
      bedId: mapped.bedId,
      clinicalCrib: activeCrib?.patient,
    };
    const candidate: AdmissionEntry = {
      bedId: mapped.bedId,
      patient,
      isCma: mapped.isCma,
      source: encounter,
    };
    const cribRollover = Boolean(
      patient.clinicalCrib && isPatientPreviousNightRollover(patient.clinicalCrib, censusDay)
    );
    return isPreviousNightRollover(candidate, censusDay) || cribRollover ? [candidate] : [];
  });
};

const supplementalCandidates = (
  diff: CensusImportDiff,
  censusDay: string,
  dependencies: EvidenceDependencies
): AdmissionEntry[] => {
  const seen = new Set(
    [...diff.admissions, ...(diff.previousDayAdmissionCandidates ?? [])].map(candidateKey)
  );
  return [
    ...candidatesFromCribUpdates(diff),
    ...candidatesFromSnapshot(diff, censusDay, dependencies),
  ].filter(candidate => {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const evidenceConflict = (admission: AdmissionEntry, reason: string): ConflictEntry => ({
  bedId: admission.bedId || null,
  rut: admission.patient.rut || admission.source?.run,
  patientName: admission.patient.patientName,
  code: 'historical-admission-evidence',
  reason: `No se verificó el ingreso nocturno histórico de ${admission.patient.patientName || 'un paciente'}: ${reason}`,
  source: admission.source,
});

interface VerificationResult {
  admission: AdmissionEntry;
  conflict?: ConflictEntry;
}

const conflictKey = (conflict: ConflictEntry): string =>
  [
    conflict.code,
    conflict.source?.encounterId?.trim(),
    conflict.bedId,
    normalizeRut(conflict.rut),
    conflict.patientName?.trim(),
  ]
    .filter(Boolean)
    .join(':');

const verifyCandidate = async (
  admission: AdmissionEntry,
  censusDay: string,
  dependencies: EvidenceDependencies,
  extractText: (buffer: ArrayBuffer) => Promise<string>
): Promise<VerificationResult> => {
  const source = admission.source;
  const cribRollover = Boolean(
    admission.patient.clinicalCrib &&
    isPatientPreviousNightRollover(admission.patient.clinicalCrib, censusDay)
  );
  const needsEvidence = isPreviousNightRollover(admission, censusDay) || cribRollover;
  if (!needsEvidence) return { admission };
  if (!source || !/^\d+$/.test(source.encounterId)) {
    return {
      admission,
      conflict: evidenceConflict(
        admission,
        'no se identificó un episodio válido para consultar su trazabilidad.'
      ),
    };
  }
  const unverifiedAdmission: AdmissionEntry = {
    ...admission,
    source: { ...source, verifiedBedPlacement: undefined },
  };
  const admissionStamp = encounterWallClockInRapaNui(source.admissionDatetime);
  const correctionDay = isPreviousNightRollover(admission, censusDay)
    ? clinicalAdmissionDay(source)
    : patientAdmissionDay(admission.patient.clinicalCrib as PatientData);
  if (!admissionStamp || !correctionDay) {
    return {
      admission: unverifiedAdmission,
      conflict: evidenceConflict(admission, 'la fecha u hora de ingreso no es verificable.'),
    };
  }
  const { nextDay, nightEnd } = resolveClinicalDayBounds(correctionDay);
  try {
    const report = await dependencies.fetchReport(source.encounterId);
    if (!report.base64 || report.error) {
      return {
        admission: unverifiedAdmission,
        conflict: evidenceConflict(
          admission,
          report.error || 'la trazabilidad de camas no estuvo disponible.'
        ),
      };
    }
    const text = await extractText(decodePdfBase64(report.base64));
    if (patientRunFromFlowReport(text) !== normalizeRut(source.run)) {
      return {
        admission: unverifiedAdmission,
        conflict: evidenceConflict(admission, 'el RUN del informe de trazabilidad no coincide.'),
      };
    }
    const movement = latestPatientFlowMovement(text, {
      notBefore: admissionStamp,
      notAfter: secondBefore(`${nextDay}T${nightEnd}:00`),
    });
    if (!movement) {
      return {
        admission: unverifiedAdmission,
        conflict: evidenceConflict(
          admission,
          'el informe no confirma una cama antes del cierre del turno nocturno.'
        ),
      };
    }
    return {
      admission: {
        ...admission,
        source: {
          ...source,
          verifiedBedPlacement: {
            source: 'patient-flow-report',
            bedId: movement.bedId,
            changedAt: movement.changedAt,
          },
        },
      },
    };
  } catch {
    return {
      admission: unverifiedAdmission,
      conflict: evidenceConflict(admission, 'falló la lectura del informe de trazabilidad.'),
    };
  }
};

export const verifyPreviousDayAdmissionPlacements = async (
  diff: CensusImportDiff,
  censusDay: string,
  dependencies: EvidenceDependencies
): Promise<CensusImportDiff> => {
  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  const candidates = [
    ...diff.admissions,
    ...(diff.previousDayAdmissionCandidates ?? []),
    ...supplementalCandidates(diff, censusDay, dependencies),
  ];
  const results = await Promise.all(
    candidates.map(admission => verifyCandidate(admission, censusDay, dependencies, extractText))
  );
  const evidenceConflicts = results.flatMap(result => (result.conflict ? [result.conflict] : []));
  const conflicts = diff.conflicts.filter(
    conflict => conflict.code !== 'historical-admission-evidence'
  );
  for (const conflict of evidenceConflicts) {
    const key = conflictKey(conflict);
    const alreadyPresent = conflicts.some(current => conflictKey(current) === key);
    if (!alreadyPresent) conflicts.push(conflict);
  }
  const admissions = results.map(result => result.admission);
  return {
    ...diff,
    admissions: admissions.slice(0, diff.admissions.length),
    previousDayAdmissionCandidates: admissions.slice(diff.admissions.length),
    conflicts,
    summary: { ...diff.summary, conflicts: conflicts.length },
  };
};
