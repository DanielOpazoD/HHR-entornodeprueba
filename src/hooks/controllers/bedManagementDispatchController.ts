import type {
  ApplyDailyRecordPatch,
  DailyRecord,
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

    // Wrong-day guard: only after we know there is a real patch (no prompt on no-ops)
    // and before any local/remote mutation, so a cancel aborts cleanly.
    if (ensureStaleDayEditAllowed && !(await ensureStaleDayEditAllowed(currentRecord.date))) {
      return false;
    }

    try {
      if (validatedAction.type === 'CLEAR_PATIENT') {
        await patchRecord(patch, {
          consistency: 'remote_confirmed',
          intentionalBedClear: {
            bedId: validatedAction.bedId,
            confirmedLastUpdated: validatedAction.confirmedLastUpdated ?? currentRecord.lastUpdated,
            confirmedOccupant:
              validatedAction.confirmedOccupant ??
              buildConfirmedBedOccupantIdentity(currentRecord.beds[validatedAction.bedId]),
          },
        });
      } else {
        await patchRecord(patch);
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
