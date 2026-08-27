/**
 * Bed Configuration Constants
 * Hospital bed definitions and capacity
 */

import { BedDefinition, BedType } from '@/types/domain/beds';

export const HOSPITAL_CAPACITY = 18;

export const BEDS: BedDefinition[] = [
  // UTI (4 beds)
  { id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false },
  { id: 'R2', name: 'R2', type: BedType.UTI, isCuna: false },
  { id: 'R3', name: 'R3', type: BedType.UTI, isCuna: false },
  { id: 'R4', name: 'R4', type: BedType.UTI, isCuna: false },
  // Neonatology (2 beds)
  { id: 'NEO1', name: 'NEO 1', type: BedType.MEDIA, isCuna: false },
  { id: 'NEO2', name: 'NEO 2', type: BedType.MEDIA, isCuna: false },
  // General Hospitalization (12 beds)
  { id: 'H1C1', name: 'H1C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H1C2', name: 'H1C2', type: BedType.MEDIA, isCuna: false },
  { id: 'H2C1', name: 'H2C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H2C2', name: 'H2C2', type: BedType.MEDIA, isCuna: false },
  { id: 'H3C1', name: 'H3C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H3C2', name: 'H3C2', type: BedType.MEDIA, isCuna: false },
  { id: 'H4C1', name: 'H4C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H4C2', name: 'H4C2', type: BedType.MEDIA, isCuna: false },
  { id: 'H5C1', name: 'H5C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H5C2', name: 'H5C2', type: BedType.MEDIA, isCuna: false },
  { id: 'H6C1', name: 'H6C1', type: BedType.MEDIA, isCuna: false },
  { id: 'H6C2', name: 'H6C2', type: BedType.MEDIA, isCuna: false },
  // Extra Beds (overflow)
  { id: 'E1', name: 'E1', type: BedType.MEDIA, isCuna: false, isExtra: true },
  { id: 'E2', name: 'E2', type: BedType.MEDIA, isCuna: false, isExtra: true },
  { id: 'E3', name: 'E3', type: BedType.MEDIA, isCuna: false, isExtra: true },
  { id: 'E4', name: 'E4', type: BedType.MEDIA, isCuna: false, isExtra: true },
  { id: 'E5', name: 'E5', type: BedType.MEDIA, isCuna: false, isExtra: true },
  // Virtual beds for hospitalized patients who remain physically in Urgencias.
  // Visibility follows the occupied HHR census: synchronization adds/removes verified encounters,
  // while day carryover keeps a patient visible until a safe reconciliation confirms a change.
  {
    id: 'BOX1',
    name: 'BOX 1 UEA',
    type: BedType.MEDIA,
    isCuna: false,
    isExtra: true,
    activationMode: 'occupied',
  },
  {
    id: 'BOX2',
    name: 'BOX 2 UEA',
    type: BedType.MEDIA,
    isCuna: false,
    isExtra: true,
    activationMode: 'occupied',
  },
];

export const EXTRA_BEDS = BEDS.filter(b => b.isExtra);
export const OCCUPANCY_ONLY_EXTRA_BEDS = EXTRA_BEDS.filter(
  bed => bed.activationMode === 'occupied'
);
export const OCCUPANCY_ONLY_EXTRA_BED_IDS = new Set(OCCUPANCY_ONLY_EXTRA_BEDS.map(bed => bed.id));
export const REGULAR_BEDS = BEDS.filter(b => !b.isExtra);
export const UTI_BEDS = BEDS.filter(b => b.type === BedType.UTI);
export const MEDIA_BEDS = BEDS.filter(b => b.type === BedType.MEDIA && !b.isExtra);
