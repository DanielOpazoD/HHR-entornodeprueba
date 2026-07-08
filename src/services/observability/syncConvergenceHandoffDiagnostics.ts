import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';
import type { SyncConvergenceFinding } from '@/services/observability/syncConvergenceDiagnosticTypes';
import {
  describePatient,
  hasPendingOutboxForPath,
  normalizeIdentity,
  normalizeText,
} from '@/services/observability/syncConvergenceSharedHelpers';

const HANDOFF_FIELDS = ['handoffNoteDayShift', 'handoffNoteNightShift'] as const;

type Patient = DailyRecord['beds'][string];
type MedicalSpecialtyKey = keyof NonNullable<DailyRecord['medicalHandoffBySpecialty']>;

interface CollectHandoffFindingsInput {
  localRecord?: DailyRecord | null;
  remoteRecord?: DailyRecord | null;
  outbox: SyncQueueOperationSnapshot[];
}

const valuesDiffer = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

const sameClinicalEpisode = (left: Patient | undefined, right: Patient | undefined): boolean => {
  if (!left || !right) return false;
  const leftEpisode = normalizeText(left.clinicalEpisodeId);
  const rightEpisode = normalizeText(right.clinicalEpisodeId);
  if (leftEpisode || rightEpisode) return leftEpisode.length > 0 && leftEpisode === rightEpisode;
  const leftRut = normalizeIdentity(left.rut);
  const rightRut = normalizeIdentity(right.rut);
  if (leftRut || rightRut) return leftRut.length > 0 && leftRut === rightRut;
  return normalizeIdentity(left.patientName) === normalizeIdentity(right.patientName);
};

const buildPatientEvidence = (record: DailyRecord, bedId: string, patient?: Patient) => ({
  date: record.date,
  bedId,
  rut: normalizeText(patient?.rut) || undefined,
  clinicalEpisodeId: normalizeText(patient?.clinicalEpisodeId) || undefined,
});

const findRemotePatientByEpisode = (
  remoteRecord: DailyRecord,
  localPatient: Patient | undefined
): { bedId: string; patient: Patient } | null => {
  const match = Object.entries(remoteRecord.beds || {}).find(([, remotePatient]) =>
    sameClinicalEpisode(localPatient, remotePatient)
  );
  return match ? { bedId: match[0], patient: match[1] } : null;
};

export const collectNursingHandoffFindings = ({
  localRecord,
  remoteRecord,
  outbox,
}: CollectHandoffFindingsInput): SyncConvergenceFinding[] => {
  if (!localRecord || !remoteRecord) return [];
  const bedIds = new Set([
    ...Object.keys(localRecord.beds || {}),
    ...Object.keys(remoteRecord.beds || {}),
  ]);
  const findings: SyncConvergenceFinding[] = [];

  bedIds.forEach(bedId => {
    const localPatient = localRecord.beds?.[bedId];
    const remotePatient = remoteRecord.beds?.[bedId];
    if (!sameClinicalEpisode(localPatient, remotePatient)) return;

    HANDOFF_FIELDS.forEach(field => {
      if (!valuesDiffer(localPatient?.[field], remotePatient?.[field])) return;
      const path = `beds.${bedId}.${field}`;
      const pendingOutbox = hasPendingOutboxForPath(outbox, path);
      findings.push({
        type: 'handoff_divergent',
        status: pendingOutbox ? 'recoverable' : 'needs_review',
        severity: pendingOutbox ? 'warning' : 'critical',
        path,
        module: 'nursing_handoff',
        affectedPatient: describePatient(localPatient ?? remotePatient, bedId),
        message: `Entrega de enfermería divergente en ${path} para el mismo episodio clínico.`,
        evidence: {
          ...buildPatientEvidence(localRecord, bedId, localPatient ?? remotePatient),
          field,
          pendingOutbox,
          localHasValue: normalizeText(localPatient?.[field]).length > 0,
          remoteHasValue: normalizeText(remotePatient?.[field]).length > 0,
        },
      });
    });
  });

  return findings;
};

const getMedicalEntries = (patient: Patient | undefined) =>
  Array.isArray(patient?.medicalHandoffEntries) ? patient.medicalHandoffEntries : [];

export const collectMedicalHandoffFindings = ({
  localRecord,
  remoteRecord,
  outbox,
}: CollectHandoffFindingsInput): SyncConvergenceFinding[] => {
  if (!localRecord || !remoteRecord) return [];
  const findings: SyncConvergenceFinding[] = [];

  const specialtyKeys = new Set([
    ...Object.keys(localRecord.medicalHandoffBySpecialty || {}),
    ...Object.keys(remoteRecord.medicalHandoffBySpecialty || {}),
  ]);
  specialtyKeys.forEach(specialty => {
    const specialtyKey = specialty as MedicalSpecialtyKey;
    const localEntry = localRecord.medicalHandoffBySpecialty?.[specialtyKey];
    const remoteEntry = remoteRecord.medicalHandoffBySpecialty?.[specialtyKey];
    if (!valuesDiffer(localEntry?.note, remoteEntry?.note)) return;
    const path = `medicalHandoffBySpecialty.${specialty}.note`;
    const pendingOutbox = hasPendingOutboxForPath(outbox, path);
    findings.push({
      type: 'handoff_divergent',
      status: pendingOutbox ? 'recoverable' : 'needs_review',
      severity: pendingOutbox ? 'warning' : 'critical',
      path,
      module: 'medical_handoff',
      message: `Entrega médica divergente en ${path}.`,
      evidence: {
        date: localRecord.date,
        specialty,
        pendingOutbox,
        localHasValue: normalizeText(localEntry?.note).length > 0,
        remoteHasValue: normalizeText(remoteEntry?.note).length > 0,
      },
    });
  });

  if (valuesDiffer(localRecord.medicalHandoffNovedades, remoteRecord.medicalHandoffNovedades)) {
    const path = 'medicalHandoffNovedades';
    const pendingOutbox = hasPendingOutboxForPath(outbox, path);
    findings.push({
      type: 'handoff_divergent',
      status: pendingOutbox ? 'recoverable' : 'needs_review',
      severity: pendingOutbox ? 'warning' : 'critical',
      path,
      module: 'medical_handoff',
      message: 'Novedades de entrega médica divergentes.',
      evidence: {
        date: localRecord.date,
        pendingOutbox,
        localHasValue: normalizeText(localRecord.medicalHandoffNovedades).length > 0,
        remoteHasValue: normalizeText(remoteRecord.medicalHandoffNovedades).length > 0,
      },
    });
  }

  Object.entries(localRecord.beds || {}).forEach(([localBedId, localPatient]) => {
    const remoteMatch = findRemotePatientByEpisode(remoteRecord, localPatient);
    if (!remoteMatch) return;
    const remoteEntries = new Map(
      getMedicalEntries(remoteMatch.patient)
        .filter(entry => normalizeText(entry.id))
        .map(entry => [normalizeText(entry.id), entry])
    );
    const localEntries = new Map(
      getMedicalEntries(localPatient)
        .filter(entry => normalizeText(entry.id))
        .map(entry => [normalizeText(entry.id), entry])
    );
    const entryIds = new Set([...localEntries.keys(), ...remoteEntries.keys()]);

    entryIds.forEach(entryId => {
      const localEntry = localEntries.get(entryId);
      const remoteEntry = remoteEntries.get(entryId);
      if (!valuesDiffer(localEntry?.note, remoteEntry?.note)) return;
      const path = `beds.${remoteMatch.bedId}.medicalHandoffEntries.${entryId}`;
      const pendingOutbox = hasPendingOutboxForPath(outbox, path);
      findings.push({
        type: 'handoff_divergent',
        status: pendingOutbox ? 'recoverable' : 'needs_review',
        severity: pendingOutbox ? 'warning' : 'critical',
        path,
        module: 'medical_handoff',
        affectedPatient: describePatient(localPatient, localBedId),
        message: `Entrada médica divergente para ${describePatient(localPatient, localBedId)}.`,
        evidence: {
          ...buildPatientEvidence(localRecord, remoteMatch.bedId, localPatient),
          entryId,
          specialty: normalizeText(localEntry?.specialty || remoteEntry?.specialty) || undefined,
          pendingOutbox,
          localHasValue: normalizeText(localEntry?.note).length > 0,
          remoteHasValue: normalizeText(remoteEntry?.note).length > 0,
        },
      });
    });
  });

  return findings;
};
