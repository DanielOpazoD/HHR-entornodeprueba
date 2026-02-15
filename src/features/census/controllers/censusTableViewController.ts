import { BedDefinition, BedType, PatientData } from '@/types';
import {
    BedTypesById,
    CensusBedRows,
    OccupiedBedRow
} from '@/features/census/types/censusTableTypes';

interface BuildVisibleBedsParams {
    allBeds: BedDefinition[];
    activeExtraBeds: string[];
}

interface BuildBedRowsParams {
    visibleBeds: BedDefinition[];
    beds: Record<string, PatientData> | null | undefined;
}

interface ResolveBedTypesParams {
    visibleBeds: BedDefinition[];
    overrides: Record<string, string> | null | undefined;
}

const isAllowedBedTypeOverride = (value: string | undefined): value is BedType =>
    value === BedType.UTI || value === BedType.UCI || value === BedType.MEDIA;

export const buildVisibleBeds = ({
    allBeds,
    activeExtraBeds
}: BuildVisibleBedsParams): BedDefinition[] => {
    return allBeds.filter((bed) => !bed.isExtra || activeExtraBeds.includes(bed.id));
};

export const buildCensusBedRows = ({
    visibleBeds,
    beds
}: BuildBedRowsParams): CensusBedRows => {
    const occupiedRows: OccupiedBedRow[] = [];
    const emptyBeds: BedDefinition[] = [];

    visibleBeds.forEach((bed) => {
        const bedData = beds?.[bed.id];
        const hasPatient = Boolean(bedData?.patientName || bedData?.isBlocked);

        if (!hasPatient || !bedData) {
            emptyBeds.push(bed);
            return;
        }

        occupiedRows.push({
            id: bed.id,
            bed,
            data: bedData,
            isSubRow: false
        });

        if (bedData.clinicalCrib && !bedData.isBlocked) {
            occupiedRows.push({
                id: `${bed.id}-cuna`,
                bed,
                data: bedData.clinicalCrib,
                isSubRow: true
            });
        }
    });

    return {
        occupiedRows,
        emptyBeds
    };
};

export const resolveVisibleBedTypes = ({
    visibleBeds,
    overrides
}: ResolveBedTypesParams): BedTypesById => {
    const bedTypes: BedTypesById = {};

    visibleBeds.forEach((bed) => {
        const override = overrides?.[bed.id];
        bedTypes[bed.id] = isAllowedBedTypeOverride(override) ? override : bed.type;
    });

    return bedTypes;
};
