import type { SyncTaskContract, SyncTaskResolution } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveDailyRecordConflictWithTrace,
  type ConflictResolutionResult,
} from '@/services/repositories/conflictResolutionMatrix';
import {
  evaluateDailyRecordConflictPostMergeInvariants,
  type DailyRecordConflictPostMergeInvariantViolation,
} from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';

type ClinicalSyncReplayStatus =
  | Extract<SyncTaskResolution, 'accepted' | 'blocked' | 'already_applied'>
  | 'auto_merged';

type ClinicalSyncModule = 'censo' | 'entrega_enfermeria' | 'entrega_medica' | 'sistema';

interface ClinicalSyncMutationOptions {
  changedPaths: string[];
  module: ClinicalSyncModule;
  label?: string;
}

interface ClinicalSyncSimulatorOptions {
  initialRecord: DailyRecord;
  clients: string[];
}

interface ClinicalSyncClientState {
  clientId: string;
  tabId: string;
  knownVersion: string;
  local: DailyRecord;
  outbox: ClinicalSyncQueuedMutation[];
}

interface ClinicalSyncQueuedMutation {
  mutationId: string;
  label: string;
  module: ClinicalSyncModule;
  baseRecord: DailyRecord;
  localRecord: DailyRecord;
  syncContract: SyncTaskContract;
}

export interface ClinicalSyncAffectedSummary {
  bedId?: string;
  patientName?: string;
  rut?: string;
}

export interface ClinicalSyncAuditEvent {
  action: 'queued' | ClinicalSyncReplayStatus;
  recordDate: string;
  clientId: string;
  tabId: string;
  mutationId: string;
  module: ClinicalSyncModule;
  changedPaths: string[];
  expectedVersion?: string;
  acceptedVersion?: string;
  affected?: ClinicalSyncAffectedSummary;
  reason: string;
  invariantViolations: DailyRecordConflictPostMergeInvariantViolation[];
}

export interface ClinicalSyncReplayResult {
  status: ClinicalSyncReplayStatus;
  record: DailyRecord;
  mutationId?: string;
  trace?: ConflictResolutionResult['trace'];
  invariantViolations: DailyRecordConflictPostMergeInvariantViolation[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createVersion = (revision: number): string => `rev-${revision}`;

export const createClinicalSyncSimulator = ({
  initialRecord,
  clients,
}: ClinicalSyncSimulatorOptions): ClinicalSyncSimulator => {
  return new ClinicalSyncSimulator(initialRecord, clients);
};

export class ClinicalSyncSimulator {
  private remote: DailyRecord;
  private revision = 1;
  private mutationCounter = 1;
  private restartCounter = 1;
  private readonly clients = new Map<string, ClinicalSyncClientState>();
  private readonly auditEvents: ClinicalSyncAuditEvent[] = [];
  private readonly appliedMutationIds = new Set<string>();

  constructor(initialRecord: DailyRecord, clientIds: string[]) {
    this.remote = clone(initialRecord);
    clientIds.forEach(clientId => {
      this.clients.set(clientId, this.createClientState(clientId));
    });
  }

  getRemote(): DailyRecord {
    return clone(this.remote);
  }

  getClient(clientId: string): ClinicalSyncClientState {
    return clone(this.requireClient(clientId));
  }

  getAuditEvents(): ClinicalSyncAuditEvent[] {
    return clone(this.auditEvents);
  }

  mutate(
    clientId: string,
    options: ClinicalSyncMutationOptions,
    mutateRecord: (record: DailyRecord) => void
  ): ClinicalSyncQueuedMutation {
    const client = this.requireClient(clientId);
    const baseRecord = clone(client.local);
    const nextLocal = clone(client.local);
    mutateRecord(nextLocal);
    client.local = nextLocal;

    const mutationId = `${clientId}-mutation-${this.mutationCounter++}`;
    const mutation: ClinicalSyncQueuedMutation = {
      mutationId,
      label: options.label || mutationId,
      module: options.module,
      baseRecord,
      localRecord: clone(nextLocal),
      syncContract: {
        mutationId,
        clientId,
        tabId: client.tabId,
        expectedVersion: client.knownVersion,
        changedPaths: [...options.changedPaths],
      },
    };
    client.outbox.push(mutation);
    this.auditEvents.push(this.buildAuditEvent('queued', mutation, []));
    return clone(mutation);
  }

  enqueueRetry(clientId: string, mutation: ClinicalSyncQueuedMutation): ClinicalSyncQueuedMutation {
    const client = this.requireClient(clientId);
    const retry = clone(mutation);
    retry.syncContract = {
      ...retry.syncContract,
      tabId: client.tabId,
    };
    client.outbox.push(retry);
    return clone(retry);
  }

  restartClient(clientId: string): ClinicalSyncClientState {
    const client = this.requireClient(clientId);
    this.restartCounter += 1;
    client.tabId = `${clientId}-tab-${this.restartCounter}`;
    client.outbox = client.outbox.map(mutation => ({
      ...mutation,
      syncContract: {
        ...mutation.syncContract,
        tabId: client.tabId,
      },
    }));
    return clone(client);
  }

  refreshClient(clientId: string): ClinicalSyncClientState {
    const client = this.requireClient(clientId);
    client.local = clone(this.remote);
    client.knownVersion = createVersion(this.revision);
    return clone(client);
  }

  replayNext(clientId: string): ClinicalSyncReplayResult {
    const client = this.requireClient(clientId);
    const mutation = client.outbox[0];
    if (!mutation) {
      return {
        status: 'already_applied',
        record: clone(this.remote),
        invariantViolations: [],
      };
    }

    if (this.appliedMutationIds.has(mutation.mutationId)) {
      client.outbox.shift();
      this.auditEvents.push(this.buildAuditEvent('already_applied', mutation, []));
      return {
        status: 'already_applied',
        mutationId: mutation.mutationId,
        record: clone(this.remote),
        invariantViolations: [],
      };
    }

    const currentVersion = createVersion(this.revision);
    if (
      mutation.syncContract.expectedVersion !== currentVersion &&
      this.hasIncompatibleStaleFieldEdit(mutation)
    ) {
      this.auditEvents.push(this.buildAuditEvent('blocked', mutation, []));
      return {
        status: 'blocked',
        mutationId: mutation.mutationId,
        record: clone(this.remote),
        invariantViolations: [],
      };
    }

    const conflictResult = resolveDailyRecordConflictWithTrace(this.remote, mutation.localRecord, {
      changedPaths: mutation.syncContract.changedPaths,
    });
    const invariantResult = evaluateDailyRecordConflictPostMergeInvariants({
      remote: this.remote,
      local: mutation.localRecord,
      resolved: conflictResult.record,
      context: {
        date: this.remote.date,
        phase: 'sync_publish',
      },
    });

    if (invariantResult.status === 'blocked') {
      this.auditEvents.push(this.buildAuditEvent('blocked', mutation, invariantResult.violations));
      return {
        status: 'blocked',
        mutationId: mutation.mutationId,
        record: clone(this.remote),
        trace: conflictResult.trace,
        invariantViolations: invariantResult.violations,
      };
    }

    this.revision += 1;
    this.remote = {
      ...invariantResult.record,
      lastUpdated: mutation.localRecord.lastUpdated || invariantResult.record.lastUpdated,
    };
    const acceptedVersion = createVersion(this.revision);
    this.appliedMutationIds.add(mutation.mutationId);
    client.outbox.shift();
    client.local = clone(this.remote);
    client.knownVersion = acceptedVersion;

    const status: ClinicalSyncReplayStatus =
      mutation.syncContract.expectedVersion === currentVersion ? 'accepted' : 'auto_merged';
    this.auditEvents.push(this.buildAuditEvent(status, mutation, [], acceptedVersion));

    return {
      status,
      mutationId: mutation.mutationId,
      record: clone(this.remote),
      trace: conflictResult.trace,
      invariantViolations: [],
    };
  }

  replayAll(clientId: string): ClinicalSyncReplayResult[] {
    const results: ClinicalSyncReplayResult[] = [];
    while (this.requireClient(clientId).outbox.length > 0) {
      const result = this.replayNext(clientId);
      results.push(result);
      if (result.status === 'blocked') break;
    }
    return results;
  }

  private createClientState(clientId: string): ClinicalSyncClientState {
    return {
      clientId,
      tabId: `${clientId}-tab-1`,
      knownVersion: createVersion(this.revision),
      local: clone(this.remote),
      outbox: [],
    };
  }

  private requireClient(clientId: string): ClinicalSyncClientState {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Clinical sync client ${clientId} is not registered.`);
    }
    return client;
  }

  private buildAuditEvent(
    action: ClinicalSyncAuditEvent['action'],
    mutation: ClinicalSyncQueuedMutation,
    invariantViolations: DailyRecordConflictPostMergeInvariantViolation[],
    acceptedVersion?: string
  ): ClinicalSyncAuditEvent {
    return {
      action,
      recordDate: this.remote.date,
      clientId: String(mutation.syncContract.clientId || ''),
      tabId: String(mutation.syncContract.tabId || ''),
      mutationId: mutation.mutationId,
      module: mutation.module,
      changedPaths: [...(mutation.syncContract.changedPaths || [])],
      expectedVersion: mutation.syncContract.expectedVersion,
      acceptedVersion,
      affected: this.buildAffectedSummary(mutation),
      reason: this.buildReason(action, mutation, invariantViolations),
      invariantViolations,
    };
  }

  private hasIncompatibleStaleFieldEdit(mutation: ClinicalSyncQueuedMutation): boolean {
    return (mutation.syncContract.changedPaths || []).some(path => {
      const baseValue = this.readPath(mutation.baseRecord, path);
      const localValue = this.readPath(mutation.localRecord, path);
      const remoteValue = this.readPath(this.remote, path);

      if (path.startsWith('medicalHandoffBySpecialty.')) {
        return (
          !this.areEqual(baseValue, localValue) &&
          !this.areEqual(baseValue, remoteValue) &&
          !this.areEqual(localValue, remoteValue)
        );
      }

      if (
        !this.isComparableFieldValue(baseValue) ||
        !this.isComparableFieldValue(localValue) ||
        !this.isComparableFieldValue(remoteValue)
      ) {
        return false;
      }
      if (this.areEqual(baseValue, localValue)) return false;
      if (this.areEqual(baseValue, remoteValue)) return false;
      return !this.areEqual(localValue, remoteValue);
    });
  }

  private buildAffectedSummary(
    mutation: ClinicalSyncQueuedMutation
  ): ClinicalSyncAffectedSummary | undefined {
    const bedIds = Array.from(
      new Set(
        (mutation.syncContract.changedPaths || [])
          .filter(path => path.startsWith('beds.'))
          .map(path => path.split('.')[1])
          .filter((bedId): bedId is string => Boolean(bedId))
      )
    );
    if (bedIds.length === 0) return undefined;

    for (const bedId of bedIds) {
      if (this.hasEpisodeMismatchForBed(mutation, bedId)) {
        const remoteBed = this.remote.beds?.[bedId];
        if (remoteBed?.patientName || remoteBed?.rut) {
          return {
            bedId,
            patientName: remoteBed.patientName || undefined,
            rut: remoteBed.rut || undefined,
          };
        }
      }

      const candidates = [
        mutation.localRecord.beds?.[bedId],
        this.remote.beds?.[bedId],
        mutation.baseRecord.beds?.[bedId],
      ];
      const bed = candidates.find(candidate => candidate?.patientName || candidate?.rut);
      if (bed) {
        return {
          bedId,
          patientName: bed.patientName || undefined,
          rut: bed.rut || undefined,
        };
      }
    }

    return { bedId: bedIds[0] };
  }

  private buildReason(
    action: ClinicalSyncAuditEvent['action'],
    mutation: ClinicalSyncQueuedMutation,
    invariantViolations: DailyRecordConflictPostMergeInvariantViolation[]
  ): string {
    if (action === 'queued') return 'mutacion clinica encolada para replay';
    if (action === 'already_applied') return 'replay idempotente: mutationId ya aplicado';
    if (action === 'accepted') return 'mutacion aceptada por version vigente';
    if (this.hasAnyEpisodeMismatch(mutation)) {
      if (action === 'blocked' && invariantViolations.length > 0) {
        return 'bloqueado por invariantes post-merge y proteccion por episodio clinico distinto';
      }
      if (action === 'blocked') {
        return 'conflicto clinico incompatible por episodio clinico distinto requiere revision';
      }
      return 'intencion clinica compatible con proteccion por episodio clinico distinto';
    }
    if (action === 'blocked' && invariantViolations.length > 0) {
      return 'bloqueado por invariantes post-merge de seguridad clinica';
    }
    if (action === 'blocked') return 'conflicto clinico incompatible requiere revision';
    if (action === 'auto_merged') {
      return 'auto-merge por intencion clinica compatible e invariantes visibles';
    }
    return 'resultado de sincronizacion clinica registrado';
  }

  private hasAnyEpisodeMismatch(mutation: ClinicalSyncQueuedMutation): boolean {
    return (mutation.syncContract.changedPaths || [])
      .filter(path => path.startsWith('beds.'))
      .map(path => path.split('.')[1])
      .filter((bedId): bedId is string => Boolean(bedId))
      .some(bedId => this.hasEpisodeMismatchForBed(mutation, bedId));
  }

  private hasEpisodeMismatchForBed(mutation: ClinicalSyncQueuedMutation, bedId: string): boolean {
    const localEpisode = mutation.localRecord.beds?.[bedId]?.clinicalEpisodeId;
    const remoteEpisode = this.remote.beds?.[bedId]?.clinicalEpisodeId;
    return Boolean(localEpisode && remoteEpisode && localEpisode !== remoteEpisode);
  }

  private readPath(record: DailyRecord, path: string): unknown {
    return path.split('.').reduce<unknown>((value, segment) => {
      if (value === null || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[segment];
    }, record);
  }

  private areEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private isComparableFieldValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    return ['boolean', 'number', 'string'].includes(typeof value);
  }
}
