import type { PatientData } from '@/types/domain/patient';

import { BedDefinition } from '@/types/domain/beds';
import { BedType } from '@/types/domain/beds';
import { hasMeaningfulPatientIdentity } from '@/features/census/controllers/patientIdentityController';
import { buildClinicalCribScopeOwner } from '@/features/census/controllers/patientRowInputController';

import {
  BedTypesById,
  CensusBedRows,
  UnifiedBedRow,
} from '@/features/census/types/censusTableTypes';

interface BuildVisibleBedsParams {
  beds?: Record<string, PatientData> | null;
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

const hasVisibleBedOccupant = (bedData: PatientData | null | undefined): boolean =>
  Boolean(bedData && (bedData.isBlocked || hasMeaningfulPatientIdentity(bedData)));

const hasVisibleClinicalCrib = (clinicalCrib: PatientData | null | undefined): boolean =>
  Boolean(
    clinicalCrib &&
    (hasMeaningfulPatientIdentity(clinicalCrib) ||
      (clinicalCrib.bedMode === 'Cuna' && clinicalCrib.identityStatus === 'provisional'))
  );

const buildClinicalCribRows = (bed: BedDefinition, bedData: PatientData): UnifiedBedRow[] =>
  bedData.clinicalCrib && !bedData.isBlocked && hasVisibleClinicalCrib(bedData.clinicalCrib)
    ? [
        {
          kind: 'occupied',
          id: `${bed.id}-cuna`,
          bed,
          data: bedData.clinicalCrib,
          isSubRow: true,
          saveScopeOwner: buildClinicalCribScopeOwner(bedData),
        },
      ]
    : [];

const buildOccupiedBedRows = (bed: BedDefinition, bedData: PatientData): UnifiedBedRow[] => [
  { kind: 'occupied', id: bed.id, bed, data: bedData, isSubRow: false },
  ...buildClinicalCribRows(bed, bedData),
];

export const buildVisibleBeds = ({
  allBeds,
  activeExtraBeds,
  beds,
}: BuildVisibleBedsParams): BedDefinition[] => {
  return allBeds.filter(bed => {
    if (!bed.isExtra || activeExtraBeds.includes(bed.id)) return true;
    const data = beds?.[bed.id];
    return (
      bed.activationMode === 'historical' &&
      (hasVisibleBedOccupant(data) || hasVisibleClinicalCrib(data?.clinicalCrib))
    );
  });
};

export const buildCensusBedRows = ({ visibleBeds, beds }: BuildBedRowsParams): CensusBedRows => {
  const unifiedRows: UnifiedBedRow[] = [];
  let emptyBedCount = 0;

  visibleBeds.forEach(bed => {
    const bedData = beds?.[bed.id];
    if (!bedData || !hasVisibleBedOccupant(bedData)) {
      if (bed.activationMode !== 'historical') {
        unifiedRows.push({ kind: 'empty', id: bed.id, bed });
        emptyBedCount++;
      }
      if (bedData) unifiedRows.push(...buildClinicalCribRows(bed, bedData));
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
