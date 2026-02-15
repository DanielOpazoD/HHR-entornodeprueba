import { MovementCreationErrorCode } from '@/features/census/controllers/patientMovementCreationController';

export type MovementKind = 'discharge' | 'transfer';

export const getMovementCreationWarningMessage = (
  kind: MovementKind,
  code: MovementCreationErrorCode,
  bedId: string
): string => {
  if (kind === 'discharge') {
    return code === 'SOURCE_BED_EMPTY'
      ? `Attempted to discharge empty bed: ${bedId}`
      : `Attempted to discharge unknown bed: ${bedId}`;
  }

  return code === 'SOURCE_BED_EMPTY'
    ? `Attempted to transfer empty bed: ${bedId}`
    : `Attempted to transfer unknown bed: ${bedId}`;
};
