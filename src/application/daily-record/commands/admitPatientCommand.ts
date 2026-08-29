/**
 * Pilot of the DailyRecord command layer (PDF audit, mejora estructural #4.1).
 *
 * The clinical aggregate today is mutated from many places: hooks call
 * repositories directly, side-effects (audit, sync) are scattered across the
 * UI tree, and the outcome is exposed as untyped booleans. This command is
 * a single, isolated example of the canonical write contract every clinical
 * mutation should follow:
 *
 *   1. Reject anonymous actors up front (consistent with the audit policy).
 *   2. Validate the input deterministically.
 *   3. Persist via an injected port — no Firestore / IndexedDB knowledge here.
 *   4. Audit the result through executeWriteAuditEvent (which already
 *      enforces the actor policy on the audit side too).
 *   5. Return a typed AdmitPatientOutcome that carries both the canonical
 *      ApplicationOutcome and a runtime status snapshot UI can render
 *      without re-deriving severity / blocking semantics.
 *
 * No existing caller is migrated yet: this commit only establishes the
 * pattern and proves it end-to-end with tests. Follow-up bloques can move
 * useBedAudit / patient-flow hooks onto it without rewriting the contract.
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
import { resolveClinicalEpisodeIdForAdmission } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { EloisaManualImportAudit } from '@/shared/contracts/eloisaManualImport';

export interface EloisaManualAdmissionSource {
  method: 'eloisa_manual_code';
  capturedAt: string;
  formatVersion: 1;
  encounterId: string;
}

export interface AdmitPatientInput {
  bedId: string;
  patientName: string;
  rut: string;
  pathology?: string;
  admissionDate: string;
  admissionTime?: string;
  firstName?: string;
  lastName?: string;
  secondLastName?: string;
  birthDate?: string;
  biologicalSex?: 'Masculino' | 'Femenino' | 'Indeterminado';
  devices?: string[];
  clinicalEpisodeId?: string;
  eloisaManualAdmissionSource?: EloisaManualAdmissionSource;
  eloisaManualImportAudit?: EloisaManualImportAudit;
  baseRecord?: DailyRecord | null;
  recordDate: string;
  /** uid / email of the authenticated actor performing the admission. */
  actor: string;
}

export interface AdmittedPatientSnapshot {
  bedId: string;
  patientName: string;
  rut: string;
  admissionDate: string;
  clinicalEpisodeId: string;
  recordDate: string;
}

export interface AdmitPatientPort {
  persistAdmission: (input: AdmitPatientInput) => Promise<AdmittedPatientSnapshot>;
}

export interface AdmitPatientCommandDependencies {
  port: AdmitPatientPort;
  writeAuditEvent?: WriteAuditEvent;
  createClinicalEpisodeId?: () => string;
  now?: () => Date;
}

export interface AdmitPatientOutcome {
  status: RuntimeOperationStatusSnapshot;
  patient: AdmittedPatientSnapshot | null;
  applicationOutcome: ApplicationOutcome<AdmittedPatientSnapshot | null>;
}

export type AdmitPatientValidation =
  | { ok: true }
  | { ok: false; field: keyof AdmitPatientInput; message: string };

export const validateAdmitPatientInput = (input: AdmitPatientInput): AdmitPatientValidation => {
  if (!input.bedId.trim()) return { ok: false, field: 'bedId', message: 'bedId es requerido' };
  if (!input.patientName.trim())
    return { ok: false, field: 'patientName', message: 'patientName es requerido' };
  if (!input.rut.trim()) return { ok: false, field: 'rut', message: 'rut es requerido' };
  if (!input.admissionDate.trim())
    return { ok: false, field: 'admissionDate', message: 'admissionDate es requerido' };
  if (!input.recordDate.trim())
    return { ok: false, field: 'recordDate', message: 'recordDate es requerido' };
  return { ok: true };
};

export const executeAdmitPatientCommand = async (
  input: AdmitPatientInput,
  deps: AdmitPatientCommandDependencies
): Promise<AdmitPatientOutcome> => {
  if (isAnonymousActor(input.actor)) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      patient: null,
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'permission',
          message: 'Admisión bloqueada: el actor no se puede atribuir a un usuario autenticado.',
        },
      ]),
    };
  }

  const validation = validateAdmitPatientInput(input);
  if (!validation.ok) {
    return {
      status: buildRuntimeOperationStatusSnapshot('blocked'),
      patient: null,
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'validation',
          message: validation.message,
          technicalContext: { field: validation.field },
        },
      ]),
    };
  }

  let snapshot: AdmittedPatientSnapshot;
  const inputWithEpisodeId: AdmitPatientInput = {
    ...input,
    clinicalEpisodeId: resolveClinicalEpisodeIdForAdmission(input, deps.createClinicalEpisodeId),
    ...(input.eloisaManualAdmissionSource
      ? {
          eloisaManualImportAudit: {
            ...input.eloisaManualAdmissionSource,
            importedBy: input.actor,
            importedAt: (deps.now?.() ?? new Date()).toISOString(),
          },
        }
      : {}),
  };
  try {
    snapshot = await deps.port.persistAdmission(inputWithEpisodeId);
  } catch (error) {
    return {
      status: buildRuntimeOperationStatusSnapshot('failed'),
      patient: null,
      applicationOutcome: createApplicationFailed(null, [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'Error desconocido al persistir la admisión.',
        },
      ]),
    };
  }

  const writeAudit = deps.writeAuditEvent ?? (await loadExecuteWriteAuditEvent());
  const auditOutcome = await writeAudit({
    userId: input.actor,
    action: 'PATIENT_ADMITTED',
    entityType: 'patient',
    entityId: input.bedId,
    details: {
      patientName: input.patientName,
      bedId: input.bedId,
      rut: input.rut,
      pathology: input.pathology ?? '',
      clinicalEpisodeId: inputWithEpisodeId.clinicalEpisodeId,
      ...(input.eloisaManualAdmissionSource
        ? {
            admissionMethod: input.eloisaManualAdmissionSource.method,
            formatVersion: input.eloisaManualAdmissionSource.formatVersion,
          }
        : {}),
    },
    patientRut: input.rut,
    recordDate: input.recordDate,
  });

  if (auditOutcome.status === 'failed') {
    return {
      status: buildRuntimeOperationStatusSnapshot('degraded'),
      patient: snapshot,
      applicationOutcome: createApplicationDegraded<AdmittedPatientSnapshot | null>(
        snapshot,
        auditOutcome.issues,
        {
          userSafeMessage: 'Paciente admitido, pero el evento de auditoría no pudo registrarse.',
        }
      ),
    };
  }

  return {
    status: buildRuntimeOperationStatusSnapshot('ready'),
    patient: snapshot,
    applicationOutcome: createApplicationSuccess<AdmittedPatientSnapshot | null>(snapshot),
  };
};
