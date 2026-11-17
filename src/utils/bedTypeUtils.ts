/**
 * Bed Type Utilities
 * Logic for calculating final bed types with overrides.
 */

import { BedDefinition, BedType } from '@/types/domain/beds';
import type { DailyRecordBedLayoutState } from '@/types/domain/dailyRecordSlices';

/**
 * Calculates the final bed type for a given bed, considering daily overrides.
 * @param bed - The static bed definition
 * @param record - The current daily record containing overrides
 * @returns The active BedType (UTI, UCI, or MEDIA)
 */
export const getBedTypeForRecord = (
  bed: BedDefinition,
  record: DailyRecordBedLayoutState | null
): BedType => {
  if (record?.bedTypeOverrides?.[bed.id]) {
    return record.bedTypeOverrides[bed.id] as BedType;
  }
  return bed.type;
};
