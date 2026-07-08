import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { defaultAuditPort, type AuditPort } from '@/application/ports/auditPort';
import { isAnonymousActor, isClinicalAuditAction } from '@/application/audit/auditActorPolicy';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export interface WriteAuditEventInput {
  userId: string;
  action: AuditAction;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
  details: Record<string, unknown>;
  patientRut?: string;
  recordDate?: string;
  authors?: string;
}

export interface WriteAuditEventDependencies {
  auditPort?: AuditPort;
}

export const ANONYMOUS_CLINICAL_AUDIT_REJECTION_KIND = 'permission' as const;

export const buildAnonymousClinicalAuditRejectionMessage = (
  action: AuditAction,
  entityId: string
): string =>
  `No se persistió evento clínico ${action} (entidad ${entityId}): el actor de auditoría no es atribuible a un usuario autenticado.`;

export const executeWriteAuditEvent = async (
  input: WriteAuditEventInput,
  dependencies: WriteAuditEventDependencies = {}
): Promise<ApplicationOutcome<null>> => {
  if (isClinicalAuditAction(input.action) && isAnonymousActor(input.userId)) {
    return createApplicationFailed(null, [
      {
        kind: ANONYMOUS_CLINICAL_AUDIT_REJECTION_KIND,
        message: buildAnonymousClinicalAuditRejectionMessage(input.action, input.entityId),
      },
    ]);
  }

  const auditPort = dependencies.auditPort || defaultAuditPort;
  try {
    await auditPort.writeEvent(
      input.userId,
      input.action,
      input.entityType,
      input.entityId,
      input.details,
      input.patientRut,
      input.recordDate,
      input.authors
    );
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'No se pudo registrar el evento de auditoría.',
      },
    ]);
  }
};
