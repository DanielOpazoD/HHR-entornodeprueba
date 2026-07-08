/**
 * Adoption facade for the existing transfer pipeline (`usePatient
 * Transfers.addTransfer` →  movement entry in `transfers[]` + bed
 * clear). Mirrors `dischargeCanonicalAdoptionController` and adds the
 * canonical contract on top of the legacy persistence:
 *
 *   1. Anonymous-actor rejection.
 *   2. Typed outcome (RuntimeOperationStatus + ApplicationOutcome).
 *   3. PATIENT_TRANSFERRED audit emission via the canonical
 *      writeAuditEventUseCase.
 *
 * Keeps the rich transfers persistence machinery untouched while
 * exposing the canonical surface to the caller. See
 * ADR_CANONICAL_WRITE_ADOPTION_FACADES.
 */

import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';
import { isAnonymousActor } from '@/application/audit/auditActorPolicy';
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

export interface TransferCanonicalAuditEntry {
  bedId: string;
  patientName: string;
  rut: string;
  /** Receiving center (typed under the legacy `destination` field). */
  destination: string;
}

export interface TransferCanonicalDispatchInput {
  actor: string;
  recordDate: string;
  entry: TransferCanonicalAuditEntry;
  /**
   * Caller-provided "do the actual write" function. Typically wraps
   * `usePatientTransfers.addTransfer`. Persistence stays in the legacy
   * pipeline; the facade only adds anon gating, outcome typing, and
   * canonical audit emission.
   */
  performLegacyPersist: () => Promise<void> | void;
}

export interface TransferCanonicalDispatchOutcome {
  status: RuntimeOperationStatusSnapshot;
  applicationOutcome: ApplicationOutcome<TransferCanonicalAuditEntry | null>;
}

export interface TransferCanonicalDispatchDeps {
  writeAuditEvent?: WriteAuditEvent;
}

export const dispatchCanonicalTransfer = async (
  input: TransferCanonicalDispatchInput,
  deps: TransferCanonicalDispatchDeps = {}
): Promise<TransferCanonicalDispatchOutcome> => {
  if (isAnonymousActor(input.actor)) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'permission',
          message: 'Traslado bloqueado: el actor no se puede atribuir a un usuario autenticado.',
        },
      ]),
    };
  }

  if (!input.entry.destination?.trim()) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'validation',
          message: 'Traslado bloqueado: el centro receptor es requerido.',
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
            error instanceof Error ? error.message : 'Error desconocido al persistir el traslado.',
        },
      ]),
    };
  }

  const writeAudit = deps.writeAuditEvent ?? (await loadExecuteWriteAuditEvent());
  const auditOutcome = await writeAudit({
    userId: input.actor,
    action: 'PATIENT_TRANSFERRED',
    entityType: 'transfer',
    entityId: input.entry.bedId,
    details: {
      patientName: input.entry.patientName,
      destination: input.entry.destination,
      bedId: input.entry.bedId,
      rut: input.entry.rut,
    },
    patientRut: input.entry.rut,
    recordDate: input.recordDate,
  });

  if (auditOutcome.status === 'failed') {
    return {
      status: buildRuntimeOperationStatusSnapshot('degraded'),
      applicationOutcome: createApplicationDegraded(input.entry, auditOutcome.issues, {
        userSafeMessage: 'Traslado registrado, pero el evento de auditoría no pudo registrarse.',
      }),
    };
  }

  return {
    status: buildRuntimeOperationStatusSnapshot('ready'),
    applicationOutcome: createApplicationSuccess(input.entry),
  };
};
