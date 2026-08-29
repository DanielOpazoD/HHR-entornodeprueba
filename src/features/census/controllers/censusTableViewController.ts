import { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import { hasMeaningfulPatientIdentity } from '@/features/census/controllers/patientIdentityController';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import {
  BedTypesById,
  CensusBedRows,
  UnifiedBedRow,
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

const hasVisibleBedOccupant = (bedData: PatientData | null | undefined): bedData is PatientData =>
  Boolean(bedData && (bedData.isBlocked || hasMeaningfulPatientIdentity(bedData)));

const hasVisibleClinicalCrib = (clinicalCrib: PatientData | null | undefined): boolean =>
  Boolean(
    clinicalCrib &&
    (hasMeaningfulPatientIdentity(clinicalCrib) ||
      (clinicalCrib.bedMode === 'Cuna' && clinicalCrib.identityStatus === 'provisional'))
  );

const buildOccupiedBedRows = (bed: BedDefinition, bedData: PatientData): UnifiedBedRow[] => {
  const occupiedRows: UnifiedBedRow[] = [
    {
      kind: 'occupied',
      id: bed.id,
      bed,
      data: bedData,
      isSubRow: false,
    },
  ];

  if (bedData.clinicalCrib && !bedData.isBlocked && hasVisibleClinicalCrib(bedData.clinicalCrib)) {
    occupiedRows.push({
      kind: 'occupied',
      id: `${bed.id}-cuna`,
      bed,
      data: bedData.clinicalCrib,
      isSubRow: true,
    });
  }

  return occupiedRows;
};

export const buildVisibleBeds = ({
  allBeds,
  activeExtraBeds,
}: BuildVisibleBedsParams): BedDefinition[] => {
  return allBeds.filter(bed => !bed.isExtra || activeExtraBeds.includes(bed.id));
};

export const buildCensusBedRows = ({ visibleBeds, beds }: BuildBedRowsParams): CensusBedRows => {
  const unifiedRows: UnifiedBedRow[] = [];
  let emptyBedCount = 0;

  visibleBeds.forEach(bed => {
    const bedData = beds?.[bed.id];
    if (!hasVisibleBedOccupant(bedData)) {
      unifiedRows.push({ kind: 'empty', id: bed.id, bed });
      emptyBedCount++;
      return;
    }

    unifiedRows.push(...buildOccupiedBedRows(bed, bedData));
  });

  return {
    unifiedRows,
    emptyBedCount,
  };
};

export const resolveVisibleBedTypes = ({
  visibleBeds,
  overrides,
}: ResolveBedTypesParams): BedTypesById => {
  const bedTypes: BedTypesById = {};

  visibleBeds.forEach(bed => {
    const override = overrides?.[bed.id];
    bedTypes[bed.id] = isAllowedBedTypeOverride(override) ? override : bed.type;
  });

  return bedTypes;
};
