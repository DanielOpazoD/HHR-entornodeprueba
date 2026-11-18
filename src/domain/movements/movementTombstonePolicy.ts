import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';

export type TombstonableMovement = DischargeData | TransferData | CMAData;

export interface TombstoneMovementOptions {
  deletedAt?: string;
  deletedBy?: string;
  deletedReason?: string;
}

const DEFAULT_DELETED_REASON = 'manual_delete';

export const isMovementDeleted = (movement: { deletedAt?: unknown }): boolean =>
  Boolean(String(movement.deletedAt || '').trim());

export const getActiveMovements = <TMovement extends object>(
  movements: readonly TMovement[] | null | undefined
): TMovement[] =>
  (movements || []).filter(movement => !isMovementDeleted(movement as { deletedAt?: unknown }));

export const getActiveDischarges = getActiveMovements<DischargeData>;

export const isClinicalCribDischarge = (movement: DischargeData): boolean =>
  movement.isNested === true || (movement.originalData?.bedMode || movement.bedType) === 'Cuna';

/**
 * Crib departures stay visible for traceability, including standalone cribs. A newborn in its
 * own hospital bed follows that classification; neonatal age alone never excludes its departure.
 */
export const getStatisticalDischarges = (
  movements: readonly DischargeData[] | null | undefined
): DischargeData[] =>
  getActiveDischarges(movements).filter(movement => !isClinicalCribDischarge(movement));

export const getActiveTransfers = getActiveMovements<TransferData>;

export const getActiveCma = getActiveMovements<CMAData>;

export const tombstoneMovement = <TMovement extends TombstonableMovement>(
  movement: TMovement,
  options: TombstoneMovementOptions = {}
): TMovement => {
  if (isMovementDeleted(movement)) {
    return movement;
  }

  return {
    ...movement,
    deletedAt: options.deletedAt || new Date().toISOString(),
    deletedBy: options.deletedBy,
    deletedReason: options.deletedReason || DEFAULT_DELETED_REASON,
  };
};

export const tombstoneMovementById = <TMovement extends TombstonableMovement>(
  movements: readonly TMovement[] | null | undefined,
  id: string,
  options: TombstoneMovementOptions = {}
): TMovement[] =>
  (movements || []).map(movement =>
    movement.id === id ? tombstoneMovement(movement, options) : movement
  );

export const tombstoneMovementsWhere = <TMovement extends TombstonableMovement>(
  movements: readonly TMovement[] | null | undefined,
  predicate: (movement: TMovement) => boolean,
  options: TombstoneMovementOptions = {}
): TMovement[] =>
  (movements || []).map(movement =>
    predicate(movement) ? tombstoneMovement(movement, options) : movement
  );
