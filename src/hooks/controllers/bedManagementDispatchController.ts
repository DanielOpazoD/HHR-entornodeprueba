import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  DailyRecordPatch,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { PatientFieldValue } from '@/types/valueTypes';
import { BEDS } from '@/constants/beds';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { BedType } from '@/types/domain/beds';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { bedManagementDispatchLogger } from '@/hooks/controllers/hookControllerLoggers';
import { buildBedMovementAuditDetails } from '@/services/admin/auditClinicalEventCatalog';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { buildBedPatchFailureTelemetryEvent } from '@/hooks/controllers/bedManagementHealthTelemetry';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';
import { isClinicalAuthorityCallablePatchPath } from '@/services/storage/dailyRecordAuthorityContract';
export interface BedManagementValidationPort {
  processFieldValue: (
    field: keyof PatientData,
    value: PatientFieldValue
  ) => { valid: boolean; value: PatientFieldValue; error?: string };
}

export interface BedManagementAuditPort {
  auditPatientChange: (
    bedId: string,
    field: keyof PatientData,
    oldPatient: PatientData,
    newValue: PatientFieldValue
  ) => void;
  auditCudyrChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
  auditCribCudyrChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
  auditPatientCleared: (bedId: string, patientName: string, rut?: string) => void;
  auditPatientModified: (bedId: string, details: Record<string, unknown>) => void;
  auditPatientMovement: (bedId: string, details: Record<string, unknown>, rut?: string) => void;
}

interface ExecuteBedManagementActionInput {
  currentRecord: DailyRecord | null;
  action: BedAction;
  validation: BedManagementValidationPort;
  bedAudit: BedManagementAuditPort;
  patchRecord: ApplyDailyRecordPatch;
  /**
   * Optional gate: when the edited record's day is not the clinical "today", asks
   * the user to confirm editing a previous day. Returning false aborts before any
   * mutation. Receives the record date being edited.
   */
  ensureStaleDayEditAllowed?: (recordDate: string) => Promise<boolean>;
}

const MULTIPLE_PATIENT_AUDIT_FIELD_PRIORITY = ['rut', 'patientName'];

// Sobre clínico = CONTRATO ÚNICO de autoridad: la misma definición que usan
// el enrutamiento, el aplanador y las functions. La divergencia histórica de
// este splitter (no conocía bedTypeOverrides) dejaba la clasificación UPC a
// medias — verificado en vivo 31-08.
const isClinicalEnvelopeBedFieldPath = isClinicalAuthorityCallablePatchPath;

/**
 * Con la autoridad clínica enforced, un patch que mezcla campos clínicos
 * (diagnóstico, estado, especialidad…) con campos estructurales/identidad es
 * rechazado por el servidor («debe guardarse por separado») y, al ser una
 * escritura local-first, quedaba reintentando para siempre en el outbox: así se
 * perdía en silencio una admisión con diagnóstico. Este split convierte ese
 * guardado en dos comandos secuenciales válidos.
 */
export const splitMixedClinicalStructuralPatch = (
  patch: DailyRecordPatch
): { structural: DailyRecordPatch; clinical: DailyRecordPatch } | null => {
  const entries = Object.entries(patch);
  const clinicalEntries = entries.filter(([path]) => isClinicalEnvelopeBedFieldPath(path));
  if (clinicalEntries.length === 0 || clinicalEntries.length === entries.length) {
    return null;
  }
  return {
    structural: Object.fromEntries(
      entries.filter(([path]) => !isClinicalEnvelopeBedFieldPath(path))
    ) as DailyRecordPatch,
    clinical: Object.fromEntries(clinicalEntries) as DailyRecordPatch,
  };
};

const getOrderedPatientAuditFields = (
  fields: Partial<PatientData>
): [keyof PatientData, PatientFieldValue][] =>
  Object.entries(fields)
    .sort(([fieldA], [fieldB]) => {
      const priorityA = MULTIPLE_PATIENT_AUDIT_FIELD_PRIORITY.indexOf(fieldA);
      const priorityB = MULTIPLE_PATIENT_AUDIT_FIELD_PRIORITY.indexOf(fieldB);
      if (priorityA === -1 && priorityB === -1) return 0;
      if (priorityA === -1) return 1;
      if (priorityB === -1) return -1;
      return priorityA - priorityB;
    })
    .map(([field, value]) => [field as keyof PatientData, value as PatientFieldValue]);

const validateAction = (
  action: BedAction,
  validation: BedManagementValidationPort
): BedAction | null => {
  if (action.type === 'UPDATE_PATIENT') {
    const result = validation.processFieldValue(action.field, action.value);
    if (!result.valid) {
      bedManagementDispatchLogger.warn(`Validation failed for ${action.field}`, result.error);
      return null;
    }

    return {
      ...action,
      value: result.value,
    };
  }

  if (action.type === 'UPDATE_PATIENT_MULTIPLE') {
    const validatedFields: Partial<PatientData> = {};
    for (const [key, value] of Object.entries(action.fields)) {
      const result = validation.processFieldValue(
        key as keyof PatientData,
        value as PatientFieldValue
      );
      if (result.valid) {
        (validatedFields as Record<string, unknown>)[key] = result.value;
      }
    }

    return {
      ...action,
      fields: validatedFields,
    };
  }

  return action;
};

const auditActionIntent = (
  action: BedAction,
  currentRecord: DailyRecord,
  bedAudit: BedManagementAuditPort
) => {
  switch (action.type) {
    case 'UPDATE_PATIENT':
      bedAudit.auditPatientChange(
        action.bedId,
        action.field,
        currentRecord.beds[action.bedId],
        action.value
      );
      break;
    case 'UPDATE_PATIENT_MULTIPLE': {
      const patientSnapshot = currentRecord.beds[action.bedId];
      if (!patientSnapshot) {
        break;
      }

      const auditSnapshot: PatientData = { ...patientSnapshot };
      getOrderedPatientAuditFields(action.fields).forEach(([field, value]) => {
        const previousSnapshot: PatientData = { ...auditSnapshot };
        bedAudit.auditPatientChange(action.bedId, field, previousSnapshot, value);
        Object.assign(auditSnapshot, { [field]: value });
      });
      break;
    }
    case 'UPDATE_CUDYR':
      bedAudit.auditCudyrChange(action.bedId, action.field, action.value);
      break;
    case 'UPDATE_CUDYR_MULTIPLE':
      Object.entries(action.fields).forEach(([field, value]) => {
        bedAudit.auditCudyrChange(action.bedId, field as keyof CudyrScore, Number(value));
      });
      break;
    case 'UPDATE_CUDYR_BATCH':
      Object.entries(action.changes.beds ?? {}).forEach(([bedId, fields]) => {
        Object.entries(fields).forEach(([field, value]) => {
          bedAudit.auditCudyrChange(bedId, field as keyof CudyrScore, Number(value));
        });
      });
      Object.entries(action.changes.clinicalCribs ?? {}).forEach(([bedId, fields]) => {
        Object.entries(fields).forEach(([field, value]) => {
          bedAudit.auditCribCudyrChange(bedId, field as keyof CudyrScore, Number(value));
        });
      });
      break;
    case 'UPDATE_CLINICAL_CRIB_CUDYR':
      bedAudit.auditCribCudyrChange(action.bedId, action.field, action.value);
      break;
    case 'UPDATE_CLINICAL_CRIB_CUDYR_MULTIPLE':
      Object.entries(action.fields).forEach(([field, value]) => {
        bedAudit.auditCribCudyrChange(action.bedId, field as keyof CudyrScore, Number(value));
      });
      break;
    case 'CLEAR_PATIENT': {
      const bed = currentRecord.beds[action.bedId];
      if (bed.patientName) {
        bedAudit.auditPatientCleared(action.bedId, bed.patientName, bed.rut);
      }
      if (bed.clinicalCrib?.patientName) {
        bedAudit.auditPatientCleared(
          `${action.bedId} (cuna RN)`,
          bed.clinicalCrib.patientName,
          bed.clinicalCrib.rut
        );
      }
      break;
    }
    case 'REMOVE_CLINICAL_CRIB': {
      const crib = currentRecord.beds[action.bedId]?.clinicalCrib;
      if (crib?.patientName) {
        bedAudit.auditPatientCleared(`${action.bedId} (cuna RN)`, crib.patientName, crib.rut);
      }
      break;
    }
    case 'MOVE_PATIENT':
    case 'COPY_PATIENT': {
      const sourceBed = currentRecord.beds[action.sourceBedId];
      if (!sourceBed?.patientName) {
        break;
      }

      bedAudit.auditPatientMovement(
        action.targetBedId,
        buildBedMovementAuditDetails({
          movementKind: action.type === 'MOVE_PATIENT' ? 'move' : 'copy',
          sourceBed: action.sourceBedId,
          targetBed: action.targetBedId,
          patientName: sourceBed.patientName,
          diagnosis: sourceBed.pathology,
          previousLocation: action.type === 'MOVE_PATIENT' ? sourceBed.location : undefined,
          newLocation: currentRecord.beds[action.targetBedId]?.location,
        }),
        sourceBed.rut
      );
      break;
    }
    case 'TOGGLE_BED_TYPE': {
      const bedDef = BEDS.find(bed => bed.id === action.bedId);
      if (!bedDef) {
        break;
      }

      const fromType = getBedTypeForRecord(bedDef, currentRecord);
      const toType = fromType === BedType.UTI ? BedType.UCI : BedType.UTI;
      bedAudit.auditPatientModified(action.bedId, {
        action: 'toggle_bed_type',
        from: fromType,
        to: toType,
      });
      break;
    }
  }
};

export const executeBedManagementAction = async ({
  currentRecord,
  action,
  validation,
  bedAudit,
  patchRecord,
  ensureStaleDayEditAllowed,
}: ExecuteBedManagementActionInput): Promise<boolean> => {
  if (!currentRecord) {
    return false;
  }

  const validatedAction = validateAction(action, validation);
  if (!validatedAction) {
    return false;
  }

  try {
    const patch = bedManagementReducer(currentRecord, validatedAction);
    if (!patch) {
      return false;
    }
    if (Object.keys(patch).length === 0) {
      // Diff vacío: el gesto no cambia nada respecto del registro vigente.
      // No hay nada que escribir, auditar ni confirmar (tampoco prompt de día
      // anterior) — el gesto se considera aplicado.
      return true;
    }

    // Wrong-day guard: only after we know there is a real patch (no prompt on no-ops)
    // and before any local/remote mutation, so a cancel aborts cleanly.
    if (ensureStaleDayEditAllowed && !(await ensureStaleDayEditAllowed(currentRecord.date))) {
      return false;
    }

    try {
      if (validatedAction.type === 'CLEAR_PATIENT') {
        const currentBed = currentRecord.beds[validatedAction.bedId]!;
        await patchRecord(patch, {
          consistency: 'remote_confirmed',
          optimisticRemoteConfirmed: true,
          intentionalBedClear: {
            bedId: validatedAction.bedId,
            confirmedLastUpdated: validatedAction.confirmedLastUpdated ?? currentRecord.lastUpdated,
            confirmedOccupant:
              validatedAction.confirmedOccupant ?? buildConfirmedBedOccupantIdentity(currentBed),
            ...(validatedAction.confirmedAssociatedCrib !== undefined
              ? { confirmedAssociatedCrib: validatedAction.confirmedAssociatedCrib }
              : {}),
          },
        });
      } else if (validatedAction.type === 'REMOVE_CLINICAL_CRIB') {
        if (!validatedAction.confirmedLastUpdated || !validatedAction.confirmedOccupant) {
          return false;
        }
        const confirmedCrib = currentRecord.beds[validatedAction.bedId]?.clinicalCrib;
        if (!confirmedCrib) {
          return false;
        }
        await patchRecord(patch, {
          consistency: 'remote_confirmed',
          optimisticRemoteConfirmed: true,
          intentionalBedClear: {
            bedId: validatedAction.bedId,
            target: 'clinicalCrib',
            confirmedLastUpdated: validatedAction.confirmedLastUpdated,
            confirmedOccupant: validatedAction.confirmedOccupant,
          },
        });
      } else if (validatedAction.type === 'CREATE_CLINICAL_CRIB') {
        // Reflect the reversible row immediately, while remote authority remains the only durable
        // source and a rejection restores the previous census.
        await patchRecord(patch, {
          consistency: 'remote_confirmed',
          optimisticRemoteConfirmed: true,
          clinicalCribCreate: {
            bedId: validatedAction.bedId,
            confirmedLastUpdated: currentRecord.lastUpdated,
            confirmedParent: buildConfirmedBedOccupantIdentity(
              currentRecord.beds[validatedAction.bedId]!
            ),
          },
        });
      } else {
        const mixedSplit = splitMixedClinicalStructuralPatch(patch);
        if (mixedSplit) {
          // Estructural/identidad primero (ancla el episodio), clínico después.
          // La cola por fecha serializa ambos comandos en orden.
          await patchRecord(mixedSplit.structural);
          await patchRecord(mixedSplit.clinical);
        } else {
          await patchRecord(patch);
        }
      }
      try {
        auditActionIntent(validatedAction, currentRecord, bedAudit);
      } catch (error) {
        bedManagementDispatchLogger.error('Audit logging failed', error);
      }
      return true;
    } catch (error) {
      bedManagementDispatchLogger.warn('Bed management patch failed', error);
      recordOperationalTelemetry(
        buildBedPatchFailureTelemetryEvent(currentRecord, validatedAction, error)
      );
      return false;
    }
  } catch (error) {
    bedManagementDispatchLogger.warn('Bed management action failed', error);
    return false;
  }
};
