import { buildBlockedWriteResult } from '@/services/repositories/dailyRecordWriteState';
import type { FieldShrinkage } from '@/services/repositories/dailyRecordFieldShrinkageGuard';
import { DataRegressionError } from '@/utils/integrityGuard';

export const buildMissingBasePartialUpdateResult = (date: string) =>
  buildBlockedWriteResult(date, 'No se encontró un registro local válido para aplicar el cambio.');

export const buildFieldShrinkageBlockedPartialUpdateResult = (
  date: string,
  shrinkages: FieldShrinkage[]
) => {
  const firstShrinkage = shrinkages[0];
  const error = new DataRegressionError(
    `Se bloqueó una reducción sospechosa de texto clínico (${firstShrinkage.prevLength} -> ${firstShrinkage.nextLength} caracteres). Recarga antes de reintentar para evitar pérdida de información.`,
    firstShrinkage.nextLength,
    firstShrinkage.prevLength
  );
  return buildBlockedWriteResult(date, error.message, error);
};
