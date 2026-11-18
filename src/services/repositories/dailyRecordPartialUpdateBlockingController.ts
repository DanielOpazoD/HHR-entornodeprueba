import {
  applyRecoveryDecisionToState,
  buildBlockedPartialUpdateResult,
  type RemoteWriteState,
} from '@/services/repositories/dailyRecordWriteState';
import type { FieldShrinkage } from '@/services/repositories/dailyRecordFieldShrinkageGuard';
import { DataRegressionError } from '@/utils/integrityGuard';

interface MissingBasePartialUpdateInput {
  date: string;
  state: RemoteWriteState;
}

interface ValidationBlockedPartialUpdateInput {
  date: string;
  state: RemoteWriteState;
  changedPaths: string[];
  error: Error;
}

interface FieldShrinkageBlockedPartialUpdateInput {
  date: string;
  state: RemoteWriteState;
  shrinkages: FieldShrinkage[];
}

const MISSING_BASE_MESSAGE = 'No se encontró un registro local válido para aplicar el cambio.';

export const buildMissingBasePartialUpdateResult = ({
  date,
  state,
}: MissingBasePartialUpdateInput) => {
  applyRecoveryDecisionToState(state, {
    consistencyState: 'unrecoverable',
    conflictSummary: {
      kind: 'remote_missing',
      sourceOfTruth: 'none',
      message: MISSING_BASE_MESSAGE,
    },
    observabilityTags: ['daily_record', 'write', 'missing_local_record'],
    userSafeMessage: MISSING_BASE_MESSAGE,
  });

  return buildBlockedPartialUpdateResult(date, state);
};

export const buildValidationBlockedPartialUpdateResult = ({
  date,
  state,
  changedPaths,
  error,
}: ValidationBlockedPartialUpdateInput) => {
  applyRecoveryDecisionToState(
    state,
    {
      consistencyState: 'blocked_validation',
      conflictSummary: {
        kind: 'validation_blocked',
        sourceOfTruth: 'none',
        changedPaths,
        message: error.message,
      },
      observabilityTags: ['daily_record', 'write', 'validation_blocked'],
      userSafeMessage: error.message,
    },
    error
  );

  return buildBlockedPartialUpdateResult(date, state);
};

export const buildFieldShrinkageBlockedPartialUpdateResult = ({
  date,
  state,
  shrinkages,
}: FieldShrinkageBlockedPartialUpdateInput) => {
  const firstShrinkage = shrinkages[0];
  const error = new DataRegressionError(
    `Se bloqueó una reducción sospechosa de texto clínico (${firstShrinkage.prevLength} -> ${firstShrinkage.nextLength} caracteres). Recarga antes de reintentar para evitar pérdida de información.`,
    firstShrinkage.nextLength,
    firstShrinkage.prevLength
  );

  applyRecoveryDecisionToState(
    state,
    {
      consistencyState: 'blocked_regression',
      conflictSummary: {
        kind: 'regression_blocked',
        sourceOfTruth: 'none',
        changedPaths: shrinkages.map(item => item.path),
        message: error.message,
      },
      observabilityTags: ['daily_record', 'write', 'field_shrinkage_blocked'],
      userSafeMessage: error.message,
    },
    error
  );

  return buildBlockedPartialUpdateResult(date, state);
};
