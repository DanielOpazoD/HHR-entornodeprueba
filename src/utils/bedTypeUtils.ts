/**
 * Bed Type Utilities
 * Logic for calculating final bed types with overrides.
 */

import { BedDefinition, DailyRecord, BedType } from '@/types';

/**
 * Calculates the final bed type for a given bed, considering daily overrides.
 * @param bed - The static bed definition
 * @param record - The current daily record containing overrides
 * @returns The active BedType (UTI, UCI, or MEDIA)
 */
export const getBedTypeForRecord = (
    bed: BedDefinition,
    record: DailyRecord | null
): BedType => {
    if (record?.bedTypeOverrides?.[bed.id]) {
        return record.bedTypeOverrides[bed.id] as BedType;
    }
    return bed.type;
};

/**
 * Checks if a bed type is considered intensive/critical (UTI or UCI).
 */
export const isIntensiveBedType = (type: BedType): boolean => {
    return type === BedType.UTI || type === BedType.UCI;
};
