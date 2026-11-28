import { BEDS } from '@/constants/beds';
import { buildCensusBedRows } from '@/features/census/controllers/censusTableViewController';
import type { BedDefinition } from '@/types/domain/beds';
import type { PatientData } from '@/types/domain/patient';

export const buildTestCensusRows = (
  beds: Record<string, PatientData>,
  visibleBeds: BedDefinition[] = BEDS.filter(bed => !bed.isExtra)
) => buildCensusBedRows({ visibleBeds, beds }).unifiedRows;
