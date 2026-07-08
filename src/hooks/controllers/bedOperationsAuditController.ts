import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import {
  buildActiveExtraBeds,
  buildBlockedReasonPatch,
  buildMoveOrCopyPatch,
  buildToggleBedTypePatch,
  buildToggleBlockedPatch,
} from '@/hooks/useBedOperationsController';
import { buildBedMovementAuditDetails } from '@/services/admin/auditClinicalEventCatalog';

interface BedOperationNoop {
  kind: 'noop';
  warning: string;
}

interface BedOperationApply {
  kind: 'apply';
  patch: DailyRecordPatch;
  audit: {
    action: 'PATIENT_MODIFIED' | 'BED_BLOCKED' | 'BED_UNBLOCKED' | 'EXTRA_BED_TOGGLED';
    entityType: 'patient' | 'dailyRecord';
    entityId: string;
    details: Record<string, unknown>;
    patientRut?: string;
    recordDate: string;
  };
}

export type BedOperationResolution = BedOperationNoop | BedOperationApply;

export type BedOperationAuditArgs = [
  action: BedOperationApply['audit']['action'],
  entityType: BedOperationApply['audit']['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut: string | undefined,
  recordDate: string,
];

export const toBedOperationAuditArgs = (
  resolvedOperation: BedOperationApply
): BedOperationAuditArgs => [
  resolvedOperation.audit.action,
  resolvedOperation.audit.entityType,
  resolvedOperation.audit.entityId,
  resolvedOperation.audit.details,
  resolvedOperation.audit.patientRut,
  resolvedOperation.audit.recordDate,
];

export const resolveMoveOrCopyOperation = (
  record: DailyRecord,
  type: 'move' | 'copy',
  sourceBedId: string,
  targetBedId: string
): BedOperationResolution => {
  const sourceData = record.beds[sourceBedId];

  if (!sourceData?.patientName) {
    return {
      kind: 'noop',
      warning: `Cannot ${type} empty patient from ${sourceBedId}`,
    };
  }

  const patch = buildMoveOrCopyPatch(record, type, sourceBedId, targetBedId);
  if (!patch) {
    return {
      kind: 'noop',
      warning: `Cannot ${type} patient from ${sourceBedId}`,
    };
  }

  return {
    kind: 'apply',
    patch,
    audit: {
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: targetBedId,
      patientRut: sourceData.rut,
      recordDate: record.date,
      details: buildBedMovementAuditDetails({
        movementKind: type,
        patientName: sourceData.patientName,
        sourceBed: sourceBedId,
        targetBed: targetBedId,
        diagnosis: sourceData.pathology,
        previousLocation: type === 'move' ? record.beds[sourceBedId].location : 'N/A',
        newLocation: record.beds[targetBedId].location,
      }),
    },
  };
};

export const resolveToggleBlockedOperation = (
  record: DailyRecord,
  bedId: string,
  reason?: string
): BedOperationApply => {
  const { patch, newIsBlocked } = buildToggleBlockedPatch(record, bedId, reason);

  return {
    kind: 'apply',
    patch,
    audit: {
      action: newIsBlocked ? 'BED_BLOCKED' : 'BED_UNBLOCKED',
      entityType: 'patient',
      entityId: bedId,
      recordDate: record.date,
      details: {
        bedId,
        reason: newIsBlocked ? reason || '' : '',
      },
    },
  };
};

export const resolveBlockedReasonUpdate = (
  record: DailyRecord,
  bedId: string,
  reason: string
): BedOperationResolution => {
  const currentBed = record.beds[bedId];
  if (!currentBed.isBlocked) {
    return {
      kind: 'noop',
      warning: `Cannot update blocked reason for unblocked bed ${bedId}`,
    };
  }

  return {
    kind: 'apply',
    patch: buildBlockedReasonPatch(bedId, reason),
    audit: {
      action: 'BED_BLOCKED',
      entityType: 'patient',
      entityId: bedId,
      recordDate: record.date,
      details: {
        bedId,
        reason: reason || '',
        updateOnly: true,
      },
    },
  };
};

export const resolveToggleExtraBedOperation = (
  record: DailyRecord,
  bedId: string
): BedOperationApply => {
  const currentExtras = record.activeExtraBeds || [];
  const newExtras = buildActiveExtraBeds(currentExtras, bedId);
  const isActive = newExtras.includes(bedId);

  return {
    kind: 'apply',
    patch: { activeExtraBeds: newExtras },
    audit: {
      action: 'EXTRA_BED_TOGGLED',
      entityType: 'dailyRecord',
      entityId: record.date,
      recordDate: record.date,
      details: {
        bedId,
        active: isActive,
      },
    },
  };
};

export const resolveToggleBedTypeOperation = (
  record: DailyRecord,
  bedId: string
): BedOperationResolution => {
  const togglePatch = buildToggleBedTypePatch(record, bedId);
  if (!togglePatch) {
    return {
      kind: 'noop',
      warning: `Cannot toggle bed type for unknown bed ${bedId}`,
    };
  }

  return {
    kind: 'apply',
    patch: togglePatch.patch,
    audit: {
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: bedId,
      patientRut: record.beds[bedId]?.rut,
      recordDate: record.date,
      details: {
        action: 'toggle_bed_type',
        from: togglePatch.currentType,
        to: togglePatch.nextType,
      },
    },
  };
};
