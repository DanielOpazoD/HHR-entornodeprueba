import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';
import type {
  EvaluateSyncConvergenceInput,
  SyncConvergenceDiagnostic,
  SyncConvergenceFinding,
  SyncConvergenceFindingType,
  SyncConvergenceStatus,
  SyncSnapshotRecoveryContext,
} from '@/services/observability/syncConvergenceDiagnosticTypes';
import {
  collectMedicalHandoffFindings,
  collectNursingHandoffFindings,
} from '@/services/observability/syncConvergenceHandoffDiagnostics';
import {
  describePatient,
  hasPendingOutboxForPath,
  normalizeIdentity,
  normalizeText,
} from '@/services/observability/syncConvergenceSharedHelpers';

export type {
  EvaluateSyncConvergenceInput,
  SyncConvergenceDiagnostic,
  SyncConvergenceFinding,
  SyncConvergenceFindingType,
  SyncConvergenceSeverity,
  SyncConvergenceStatus,
  SyncSnapshotRecoveryContext,
  SyncSnapshotRecoveryStatus,
} from '@/services/observability/syncConvergenceDiagnosticTypes';

const DEFAULT_STALE_OUTBOX_MS = 45 * 60 * 1000;
const MOVEMENT_FIELDS = ['discharges', 'transfers', 'cma'] as const;

type MovementField = (typeof MOVEMENT_FIELDS)[number];

const isDeletedMovement = (movement: { deletedAt?: unknown } | undefined): boolean =>
  normalizeText(movement?.deletedAt).length > 0;

const resolvePatientIdentityKey = (patient: DailyRecord['beds'][string] | undefined): string => {
  const rut = normalizeIdentity(patient?.rut);
  if (rut) return `rut:${rut}`;
  const episode = normalizeIdentity(patient?.clinicalEpisodeId);
  if (episode) return `episode:${episode}`;
  const name = normalizeIdentity(patient?.patientName);
  return name ? `name:${name}` : '';
};

const collectDuplicateActivePatientFindings = (
  record: DailyRecord | null | undefined
): SyncConvergenceFinding[] => {
  const seen = new Map<string, string>();
  const findings: SyncConvergenceFinding[] = [];

  Object.entries(record?.beds || {}).forEach(([bedId, patient]) => {
    const key = resolvePatientIdentityKey(patient);
    if (!key) return;

    const previousBedId = seen.get(key);
    if (!previousBedId) {
      seen.set(key, bedId);
      return;
    }

    findings.push({
      type: 'duplicate_active_patient',
      status: 'unsafe',
      severity: 'critical',
      path: `beds.${bedId}`,
      module: 'censo',
      affectedPatient: describePatient(patient, bedId),
      message: `Paciente activo duplicado en ${previousBedId} y ${bedId}.`,
      evidence: {
        identityKey: key,
        firstBedId: previousBedId,
        duplicateBedId: bedId,
      },
    });
  });

  return findings;
};

const getMovementItems = (
  record: DailyRecord | null | undefined,
  field: MovementField
): Array<{ id?: string; patientName?: string; deletedAt?: unknown }> =>
  Array.isArray(record?.[field])
    ? (record[field] as Array<{ id?: string; patientName?: string; deletedAt?: unknown }>)
    : [];

const collectMovementFindings = ({
  localRecord,
  remoteRecord,
  outbox,
}: Required<Pick<EvaluateSyncConvergenceInput, 'outbox'>> &
  Pick<EvaluateSyncConvergenceInput, 'localRecord' | 'remoteRecord'>): SyncConvergenceFinding[] => {
  if (!localRecord || !remoteRecord) return [];
  const findings: SyncConvergenceFinding[] = [];

  MOVEMENT_FIELDS.forEach(field => {
    const remoteIds = new Set(
      getMovementItems(remoteRecord, field)
        .filter(movement => movement.id && !isDeletedMovement(movement))
        .map(movement => movement.id as string)
    );

    getMovementItems(localRecord, field)
      .filter(movement => movement.id && !isDeletedMovement(movement))
      .forEach(movement => {
        const id = movement.id as string;
        if (remoteIds.has(id)) return;
        const path = `${field}.${id}`;
        const pendingOutbox = hasPendingOutboxForPath(outbox, path);
        findings.push({
          type: 'movement_not_reflected',
          status: pendingOutbox ? 'recoverable' : 'needs_review',
          severity: pendingOutbox ? 'warning' : 'critical',
          path,
          module: 'censo',
          affectedPatient: normalizeText(movement.patientName) || undefined,
          message: `Movimiento ${field}.${id} existe localmente pero no está reflejado en el registro remoto.`,
          evidence: {
            date: localRecord.date,
            field,
            movementId: id,
            pendingOutbox,
          },
        });
      });
  });

  return findings;
};

const collectOutboxFindings = (
  outbox: SyncQueueOperationSnapshot[],
  nowMs: number,
  staleOutboxMs: number
): SyncConvergenceFinding[] => {
  const findings: SyncConvergenceFinding[] = [];

  outbox.forEach(operation => {
    const ageMs = Math.max(0, nowMs - operation.timestamp);
    if (
      ageMs >= staleOutboxMs &&
      (operation.status === 'PENDING' || operation.status === 'PROCESSING')
    ) {
      findings.push({
        type: 'stale_outbox',
        status: 'recoverable',
        severity: 'warning',
        path: operation.key || `syncQueue.${operation.id || operation.type}`,
        module: 'sync',
        message: 'Operación local pendiente excede el umbral de antigüedad del outbox.',
        evidence: {
          operationId: operation.id,
          key: operation.key,
          ageMs,
          status: operation.status,
          changedPaths: operation.syncContract?.changedPaths || [],
        },
      });
    }
  });

  const byMutationId = new Map<string, SyncQueueOperationSnapshot[]>();
  outbox.forEach(operation => {
    const mutationId = normalizeText(operation.syncContract?.mutationId);
    if (!mutationId) return;
    const current = byMutationId.get(mutationId) || [];
    current.push(operation);
    byMutationId.set(mutationId, current);
  });

  byMutationId.forEach((operations, mutationId) => {
    if (operations.length < 2) return;
    findings.push({
      type: 'repeated_replay',
      status: 'recoverable',
      severity: 'warning',
      path: `syncContract.mutationId.${mutationId}`,
      module: 'sync',
      message: 'La misma mutación aparece más de una vez en operaciones recientes del outbox.',
      evidence: {
        mutationId,
        operationIds: operations.map(operation => operation.id).filter(Boolean),
        count: operations.length,
      },
    });
  });

  return findings;
};

const collectSnapshotFindings = (
  snapshotRecovery: SyncSnapshotRecoveryContext | null | undefined
): SyncConvergenceFinding[] => {
  if (!snapshotRecovery || snapshotRecovery.status === 'available') return [];

  return [
    {
      type: 'snapshot_missing',
      status: 'needs_review',
      severity: snapshotRecovery.status === 'permission_denied' ? 'critical' : 'warning',
      path: 'conflictSnapshot',
      module: 'recovery',
      message: 'No hay snapshot de recuperación confiable para explicar o revertir el conflicto.',
      evidence: {
        snapshotStatus: snapshotRecovery.status,
        reason: snapshotRecovery.reason,
      },
    },
  ];
};

const resolveStatus = (findings: SyncConvergenceFinding[]): SyncConvergenceStatus => {
  if (findings.some(finding => finding.status === 'unsafe')) return 'unsafe';
  if (findings.some(finding => finding.status === 'needs_review')) return 'needs_review';
  if (findings.some(finding => finding.status === 'recoverable')) return 'recoverable';
  return 'healthy';
};

const buildSummary = (
  status: SyncConvergenceStatus,
  findings: SyncConvergenceFinding[]
): string => {
  if (status === 'healthy') return 'Sincronización clínica convergida sin hallazgos activos.';
  const counts = findings.reduce<Record<SyncConvergenceFindingType, number>>(
    (acc, finding) => ({
      ...acc,
      [finding.type]: (acc[finding.type] || 0) + 1,
    }),
    {} as Record<SyncConvergenceFindingType, number>
  );
  return `Sincronización clínica ${status}: ${Object.entries(counts)
    .map(([type, count]) => `${type}=${count}`)
    .join(', ')}.`;
};

export const evaluateSyncConvergence = ({
  localRecord = null,
  remoteRecord = null,
  outbox = [],
  lastAuditEvent = null,
  snapshotRecovery = null,
  nowMs = Date.now(),
  staleOutboxMs = DEFAULT_STALE_OUTBOX_MS,
}: EvaluateSyncConvergenceInput): SyncConvergenceDiagnostic => {
  const findings = [
    ...collectDuplicateActivePatientFindings(localRecord || remoteRecord),
    ...collectMovementFindings({ localRecord, remoteRecord, outbox }),
    ...collectNursingHandoffFindings({ localRecord, remoteRecord, outbox }),
    ...collectMedicalHandoffFindings({ localRecord, remoteRecord, outbox }),
    ...collectOutboxFindings(outbox, nowMs, staleOutboxMs),
    ...collectSnapshotFindings(snapshotRecovery),
  ];
  const status = resolveStatus(findings);

  return {
    status,
    summary: buildSummary(status, findings),
    findings,
    checkedAt: new Date(nowMs).toISOString(),
    latestAuditEventAt: lastAuditEvent?.timestamp,
  };
};
