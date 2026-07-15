import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
  tombstoneMovementById,
} from './movementTombstonePolicy';
import {
  buildCmaFromDischarge,
  buildCmaFromTransfer,
  buildDischargeFromCma,
  buildDischargeFromTransfer,
  buildTransferFromCma,
  buildTransferFromDischarge,
  DEFAULT_HOME_DISCHARGE_TYPE,
  hasOriginalBed,
} from './movementReclassificationBuilders';
import type {
  MovementCreateId,
  MovementReclassificationContext,
} from './movementReclassificationBuilders';
import type { MovementClassification } from '@/types/domain/movements';

export type { MovementReclassificationContext } from './movementReclassificationBuilders';

export interface MovementReclassificationSummary {
  movementId: string;
  previousMovementId: string;
  patientName: string;
  rut: string;
  from: string;
  to: string;
  lineageId: string;
  clinicalEpisodeId?: string;
}

const CLASSIFICATION_LABEL: Record<MovementClassification, string> = {
  discharge: 'Alta domicilio',
  transfer: 'Traslado',
  cma: 'CMA',
};

const findActiveDischargeById = (record: DailyRecord, id: string): DischargeData | undefined =>
  getActiveDischarges(record.discharges).find(item => item.id === id);

const findActiveCmaById = (record: DailyRecord, id: string): CMAData | undefined =>
  getActiveCma(record.cma).find(item => item.id === id);

const findActiveTransferById = (record: DailyRecord, id: string): TransferData | undefined =>
  getActiveTransfers(record.transfers).find(item => item.id === id);

const appendMovementOnce = <T extends { id: string }>(items: T[] | undefined, item: T): T[] => {
  const current = items ?? [];
  return current.some(existing => existing.id === item.id) ? current : [...current, item];
};

export const selectMovementReclassificationSummary = (
  record: DailyRecord,
  previousMovementId: string
): MovementReclassificationSummary | null => {
  const candidates: Array<{
    movement: DischargeData | TransferData | CMAData;
    classification: MovementClassification;
  }> = [
    ...(record.discharges ?? []).map(movement => ({
      movement,
      classification: 'discharge' as const,
    })),
    ...(record.transfers ?? []).map(movement => ({
      movement,
      classification: 'transfer' as const,
    })),
    ...(record.cma ?? []).map(movement => ({ movement, classification: 'cma' as const })),
  ];
  const target = candidates.find(
    candidate =>
      !candidate.movement.deletedAt &&
      candidate.movement.movementProvenance?.previousMovementId === previousMovementId
  );
  const provenance = target?.movement.movementProvenance;
  if (!target || !provenance?.previousClassification) return null;
  return {
    movementId: target.movement.id,
    previousMovementId,
    patientName: target.movement.patientName,
    rut: target.movement.rut,
    from: CLASSIFICATION_LABEL[provenance.previousClassification],
    to: CLASSIFICATION_LABEL[target.classification],
    lineageId: provenance.lineageId,
    clinicalEpisodeId: target.movement.clinicalEpisodeId,
  };
};

export const canReclassifyHomeDischarge = (
  discharge: Pick<DischargeData, 'status' | 'dischargeType'>
): boolean =>
  discharge.status === 'Vivo' && discharge.dischargeType === DEFAULT_HOME_DISCHARGE_TYPE;

/** Backward-compatible name used by existing callers. */
export const canConvertDischargeToCma = canReclassifyHomeDischarge;

export const convertDischargeToCmaRecord = (
  record: DailyRecord,
  dischargeId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const discharge = findActiveDischargeById(record, dischargeId);
  if (!discharge || !canReclassifyHomeDischarge(discharge)) {
    return record;
  }

  return {
    ...record,
    discharges: tombstoneMovementById(record.discharges, dischargeId, {
      deletedReason: 'converted_to_cma',
      deletedBy: context?.actor,
    }),
    cma: appendMovementOnce(record.cma, buildCmaFromDischarge(discharge, createId, context)),
  };
};

export const convertDischargeToTransferRecord = (
  record: DailyRecord,
  dischargeId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const discharge = findActiveDischargeById(record, dischargeId);
  if (!discharge || !canReclassifyHomeDischarge(discharge)) return record;

  return {
    ...record,
    discharges: tombstoneMovementById(record.discharges, dischargeId, {
      deletedReason: 'converted_to_transfer',
      deletedBy: context?.actor,
    }),
    transfers: appendMovementOnce(
      record.transfers,
      buildTransferFromDischarge(discharge, createId, context)
    ),
  };
};

export const convertCmaToHomeDischargeRecord = (
  record: DailyRecord,
  cmaId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const item = findActiveCmaById(record, cmaId);
  if (!hasOriginalBed(item)) {
    return record;
  }

  return {
    ...record,
    cma: tombstoneMovementById(record.cma, cmaId, {
      deletedReason: 'converted_to_discharge',
      deletedBy: context?.actor,
    }),
    discharges: appendMovementOnce(
      record.discharges,
      buildDischargeFromCma(item, record, createId, context)
    ),
  };
};

export const convertCmaToTransferRecord = (
  record: DailyRecord,
  cmaId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const item = findActiveCmaById(record, cmaId);
  if (!hasOriginalBed(item)) return record;

  return {
    ...record,
    cma: tombstoneMovementById(record.cma, cmaId, {
      deletedReason: 'converted_to_transfer',
      deletedBy: context?.actor,
    }),
    transfers: appendMovementOnce(
      record.transfers,
      buildTransferFromCma(item, record, createId, context)
    ),
  };
};

export const convertTransferToHomeDischargeRecord = (
  record: DailyRecord,
  transferId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const item = findActiveTransferById(record, transferId);
  if (!item) return record;

  return {
    ...record,
    transfers: tombstoneMovementById(record.transfers, transferId, {
      deletedReason: 'converted_to_discharge',
      deletedBy: context?.actor,
    }),
    discharges: appendMovementOnce(
      record.discharges,
      buildDischargeFromTransfer(item, createId, context)
    ),
  };
};

export const convertTransferToCmaRecord = (
  record: DailyRecord,
  transferId: string,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DailyRecord => {
  const item = findActiveTransferById(record, transferId);
  if (!item) return record;

  return {
    ...record,
    transfers: tombstoneMovementById(record.transfers, transferId, {
      deletedReason: 'converted_to_cma',
      deletedBy: context?.actor,
    }),
    cma: appendMovementOnce(record.cma, buildCmaFromTransfer(item, createId, context)),
  };
};
