/**
 * Adoption facade that bridges the existing rich discharge pipeline
 * (`usePatientDischarges.addDischarge` →  movement entries in
 * `discharges[]` + bed clear) to the canonical command contract
 * (anonymous rejection, validation, typed RuntimeOperationStatus +
 * ApplicationOutcome). See ADR_CANONICAL_WRITE_COMMANDS for the
 * canonical contract; the only living reference implementation of a
 * canonical command + port is `admitPatientCommand`.
 *
 * Why this exists:
 *
 * The discharge modal handles a richer payload (movement metadata,
 * crib status, target, audit context) than would fit cleanly behind a
 * thin canonical port. Re-implementing the persistence inside such a
 * port would duplicate the existing pipeline for no gain. This facade
 * keeps the persistence side unchanged (the legacy `addDischarge` is
 * invoked exactly as today) and adds the canonical contract only
 * where it provides real value:
 *
 *   1. Anonymous-actor rejection (consistent with the audit policy,
 *      previously skipped by the modal flow).
 *   2. Typed outcome the modal can switch on instead of fire-and-
 *      forget.
 *   3. PATIENT_DISCHARGED audit emission goes through the canonical
 *      writeAuditEventUseCase (the legacy `logDischargeEntries` path
 *      is suppressed in the caller when the flag is on).
 */

import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';
import { buildPatientDischargedAuditDetails } from '@/services/admin/auditClinicalEventCatalog';
import { isAnonymousActor } from '@/application/audit/auditActorPolicy';
import { executeLockClinicalDocumentsByEpisode } from '@/application/clinical-documents/lockClinicalDocumentsByEpisodeUseCase';
import { resolveClinicalEpisodeIdentifier } from '@/application/patient-flow/clinicalEpisode';
import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  buildRuntimeOperationStatusSnapshot,
  type RuntimeOperationStatusSnapshot,
} from '@/shared/contracts/runtimeOperationStatus';

export interface DischargeCanonicalAuditEntry {
  bedId: string;
  patientName: string;
  rut: string;
  status: 'Vivo' | 'Fallecido';
  movementDate?: string;
  time?: string;
  diagnosis?: string;
  dischargeType?: string;
  dischargeTypeOther?: string;
  dischargeTarget?: string;
  /**
   * Hospitalization-episode identifier (`patientRut__admissionDate`).
   * When present, every clinical document under that episode is locked
   * automatically as part of the discharge — no manual admin action
   * required. Caller may omit it for callers that do not have access to
   * the patient's admission date; the lock step is then a no-op.
   */
  episodeKey?: string;
  /** Optional hospital scope override; defaults to the active hospital. */
  hospitalId?: string;
}

interface DischargeCanonicalPatientSnapshot {
  bedId?: string;
  patientName?: string;
  rut?: string;
  pathology?: string;
  admissionDate?: string;
  firstSeenDate?: string;
  admissionTime?: string;
  clinicalEpisodeId?: string;
}

export interface DischargeCanonicalAuditEntriesInput {
  record:
    | {
        date?: string;
        beds?: Record<string, DischargeCanonicalPatientSnapshot | undefined>;
      }
    | null
    | undefined;
  bedId?: string | null;
  status?: string;
  movementDate?: string;
  time?: string;
  diagnosis?: string;
  dischargeType?: string;
  dischargeTypeOther?: string;
  dischargeTarget?: string;
}

export interface DischargeCanonicalDispatchInput {
  actor: string;
  recordDate: string;
  entries: DischargeCanonicalAuditEntry[];
  /**
   * Caller-provided "do the actual write" function. Typically wraps
   * `usePatientDischarges.addDischarge`. The facade does not touch
   * persistence; it only gates anon access, runs the persist callback,
   * and emits the canonical audit on success.
   */
  performLegacyPersist: () => Promise<void> | void;
}

export interface DischargeCanonicalDispatchOutcome {
  status: RuntimeOperationStatusSnapshot;
  applicationOutcome: ApplicationOutcome<DischargeCanonicalAuditEntry[] | null>;
}

export const buildDischargeCanonicalAuditEntries = ({
  record,
  bedId,
  status,
  movementDate,
  time,
  diagnosis,
  dischargeType,
  dischargeTypeOther,
  dischargeTarget,
}: DischargeCanonicalAuditEntriesInput): DischargeCanonicalAuditEntry[] => {
  if (!bedId) return [];
  const bed = record?.beds?.[bedId];
  if (!bed) return [];
  if (status !== 'Vivo' && status !== 'Fallecido') return [];

  return [
    {
      bedId,
      patientName: bed.patientName ?? '',
      rut: bed.rut ?? '',
      status,
      episodeKey: resolveClinicalEpisodeIdentifier(bed),
      movementDate,
      time,
      diagnosis: diagnosis ?? bed.pathology,
      dischargeType,
      dischargeTypeOther,
      dischargeTarget,
    },
  ];
};

const buildDischargeAuditEvent = (
  actor: string,
  recordDate: string,
  entry: DischargeCanonicalAuditEntry
) => {
  return {
    userId: actor,
    action: 'PATIENT_DISCHARGED' as const,
    entityType: 'discharge' as const,
    entityId: entry.bedId,
    details: buildPatientDischargedAuditDetails(entry),
    patientRut: entry.rut,
    recordDate,
  };
};

const buildClinicalDocumentLockedAuditEvent = (
  actor: string,
  recordDate: string,
  entry: DischargeCanonicalAuditEntry,
  documentId: string
) => ({
  userId: actor,
  action: 'CLINICAL_DOCUMENT_LOCKED' as const,
  entityType: 'clinicalDocument' as const,
  entityId: documentId,
  details: {
    episodeKey: entry.episodeKey,
    reason: 'episode_closed' as const,
    dischargeStatus: entry.status,
    bedId: entry.bedId,
    rut: entry.rut,
  },
  patientRut: entry.rut,
  recordDate,
});

export interface DischargeCanonicalDispatchDeps {
  writeAuditEvent?: WriteAuditEvent;
  /**
   * Allows tests (or future alternate implementations) to inject a
   * different lock implementation. Defaults to the production use case.
   */
  lockDocumentsByEpisodeKey?: (
    episodeKey: string,
    hospitalId: string | undefined,
    options: { lockedAt?: string }
  ) => Promise<string[]>;
}

const defaultLockDocumentsByEpisodeKey = (
  episodeKey: string,
  hospitalId: string | undefined,
  options: { lockedAt?: string }
): Promise<string[]> =>
  executeLockClinicalDocumentsByEpisode({
    episodeKey,
    hospitalId,
    lockedAt: options.lockedAt,
  });

export const dispatchCanonicalDischarge = async (
  input: DischargeCanonicalDispatchInput,
  deps: DischargeCanonicalDispatchDeps = {}
): Promise<DischargeCanonicalDispatchOutcome> => {
  if (isAnonymousActor(input.actor)) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'permission',
          message: 'Alta bloqueada: el actor no se puede atribuir a un usuario autenticado.',
        },
      ]),
    };
  }

  if (input.entries.length === 0) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'validation',
          message: 'Alta bloqueada: no hay entradas de alta para registrar.',
        },
      ]),
    };
  }

  try {
    await input.performLegacyPersist();
  } catch (error) {
    return {
      status: buildRuntimeOperationStatusSnapshot('failed'),
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'Error desconocido al persistir el alta.',
        },
      ]),
    };
  }

  const writeAudit = deps.writeAuditEvent ?? (await loadExecuteWriteAuditEvent());
  const lockDocuments = deps.lockDocumentsByEpisodeKey ?? defaultLockDocumentsByEpisodeKey;
  const auditFailures: string[] = [];
  const lockFailures: string[] = [];

  // Phase 1: lock clinical documents under each closed episode. Failure to
  // lock degrades the outcome but does not roll back the discharge — the
  // physical egreso already happened and the canonical audit must still
  // record it. The lock can be retried by an admin later; the alternative
  // (rolling back the discharge) would leave the bed in a worse state.
  const lockedAt = new Date().toISOString();
  for (const entry of input.entries) {
    if (!entry.episodeKey) continue;
    try {
      const newlyLocked = await lockDocuments(entry.episodeKey, entry.hospitalId, { lockedAt });
      for (const documentId of newlyLocked) {
        const auditOutcome = await writeAudit(
          buildClinicalDocumentLockedAuditEvent(input.actor, input.recordDate, entry, documentId)
        );
        if (auditOutcome.status === 'failed') {
          auditFailures.push(...auditOutcome.issues.map(issue => issue.message));
        }
      }
    } catch (error) {
      lockFailures.push(
        error instanceof Error
          ? error.message
          : 'Error desconocido al bloquear los documentos clínicos del episodio.'
      );
    }
  }

  for (const entry of input.entries) {
    const auditOutcome = await writeAudit(
      buildDischargeAuditEvent(input.actor, input.recordDate, entry)
    );
    if (auditOutcome.status === 'failed') {
      auditFailures.push(...auditOutcome.issues.map(issue => issue.message));
    }
  }

  if (auditFailures.length > 0 || lockFailures.length > 0) {
    const userSafeMessage =
      lockFailures.length > 0 && auditFailures.length === 0
        ? 'Alta registrada, pero los documentos clínicos del episodio no pudieron bloquearse automáticamente.'
        : lockFailures.length > 0
          ? 'Alta registrada, pero hubo fallos bloqueando los documentos clínicos y/o registrando auditoría.'
          : 'Alta registrada, pero uno o más eventos de auditoría no pudieron registrarse.';

    return {
      status: buildRuntimeOperationStatusSnapshot('degraded'),
      applicationOutcome: createApplicationDegraded(
        input.entries,
        [
          ...lockFailures.map(message => ({ kind: 'unknown' as const, message })),
          ...auditFailures.map(message => ({ kind: 'unknown' as const, message })),
        ],
        { userSafeMessage }
      ),
    };
  }

  return {
    status: buildRuntimeOperationStatusSnapshot('ready'),
    applicationOutcome: createApplicationSuccess(input.entries),
  };
};
