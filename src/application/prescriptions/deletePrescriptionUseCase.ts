/**
 * Use case: hard-delete a single prescription before its 30-day TTL.
 *
 * Reserved for authenticated admin or nursing callers. External uploaders
 * that only hold the QR PIN cannot reach this client-side use case. The
 * role check itself is enforced by Firestore rules; this use case records
 * an attributable clinical audit event before deleting so manual deletion
 * never happens without traceability.
 */

import {
  loadExecuteWriteAuditEvent,
  type WriteAuditEvent,
} from '@/application/audit/writeAuditEventUseCaseLoader';
import {
  defaultPrescriptionPort,
  type PrescriptionPort,
} from '@/application/ports/prescriptionPort';

export interface DeletePrescriptionInput {
  prescriptionId: string;
  hospitalId?: string;
  deletedBy: string;
  deletedAt?: string;
}

interface DeletePrescriptionDeps {
  prescriptionPort?: PrescriptionPort;
  writeAuditEvent?: WriteAuditEvent;
}

const resolveRecordDate = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

export const executeDeletePrescription = async (
  input: DeletePrescriptionInput,
  dependencies: DeletePrescriptionDeps = {}
): Promise<void> => {
  const port = dependencies.prescriptionPort || defaultPrescriptionPort;
  const writeAuditEvent = dependencies.writeAuditEvent || (await loadExecuteWriteAuditEvent());
  const record = await port.get(input.prescriptionId, input.hospitalId);
  const deletedAt = input.deletedAt || new Date().toISOString();
  const auditOutcome = await writeAuditEvent({
    userId: input.deletedBy,
    action: 'PRESCRIPTION_MANUAL_DELETED',
    entityType: 'prescription',
    entityId: input.prescriptionId,
    patientRut: record?.patientRut,
    recordDate: resolveRecordDate(record?.createdAt),
    details: {
      prescriptionId: input.prescriptionId,
      prescriptionType: record?.prescriptionType,
      bedId: record?.bedId,
      patientName: record?.patientName,
      patientRut: record?.patientRut,
      createdAt: record?.createdAt,
      expiresAt: record?.expiresAt,
      deletedAt,
      deletedBy: input.deletedBy,
      deletionMode: 'manual',
    },
  });

  if (auditOutcome.status === 'failed') {
    throw new Error('No se eliminó la receta porque no se pudo registrar la auditoría.');
  }

  await port.delete(input.prescriptionId, input.hospitalId);
};
