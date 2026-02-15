import type { BedDefinition } from '@/types';
import type {
  SavedBedTransform,
  SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';

export const HOSPITAL_FLOOR_STORAGE_KEY = 'hhr_3d_layout_v2';

export const DEFAULT_HOSPITAL_FLOOR_LAYOUT: Record<string, SavedBedTransform> = {
  R1: { x: -2.5, z: -6.0, rotation: 0 },
  R2: { x: -0.8, z: -6.0, rotation: 0 },
  R3: { x: 2.5, z: -6.0, rotation: 0 },
  R4: { x: 4.2, z: -6.0, rotation: 0 },

  NEO1: { x: 2.5, z: -3.5, rotation: 0 },
  NEO2: { x: 4.2, z: -3.5, rotation: 0 },

  H1C1: { x: 2.5, z: -0.5, rotation: 0 },
  H1C2: { x: 4.2, z: -0.5, rotation: 0 },
  H2C1: { x: 2.5, z: 2.2, rotation: 0 },
  H2C2: { x: 4.2, z: 2.2, rotation: 0 },
  H3C1: { x: 2.5, z: 4.9, rotation: 0 },
  H3C2: { x: 4.2, z: 4.9, rotation: 0 },

  H4C1: { x: -4.2, z: -0.5, rotation: 0 },
  H4C2: { x: -2.5, z: -0.5, rotation: 0 },
  H5C1: { x: -4.2, z: 2.2, rotation: 0 },
  H5C2: { x: -2.5, z: 2.2, rotation: 0 },
  H6C1: { x: -4.2, z: 4.9, rotation: 0 },
  H6C2: { x: -2.5, z: 4.9, rotation: 0 },
};

const DEFAULT_BED_COLUMNS = 4;
const DEFAULT_GRID_SPACING_X = 2.5;
const DEFAULT_GRID_SPACING_Z = 4;

const ZOOM_BASE_DISTANCE = 12;
const ZOOM_MIN_VALUE = 10;
const ZOOM_MAX_VALUE = 500;

export const ZOOM_IN_SCALE_FACTOR = 0.9;
export const ZOOM_OUT_SCALE_FACTOR = 1.1;

export interface HospitalFloorBedItem {
  bed: BedDefinition;
  transform: SavedBedTransform;
}

export const createDefaultSavedLayout = (): SavedLayout => ({
  beds: {},
  config: {
    bedWidth: 1.5,
    bedLength: 2.2,
    colorOccupied: '#10b981',
    colorFree: '#94a3b8',
  },
});

interface ResolveHospitalFloorBedItemsParams {
  beds: BedDefinition[];
  savedBeds: Record<string, SavedBedTransform>;
}

const resolveFallbackTransformByIndex = (index: number, totalBeds: number): SavedBedTransform => {
  const row = Math.floor(index / DEFAULT_BED_COLUMNS);
  const col = index % DEFAULT_BED_COLUMNS;
  const x = (col - (DEFAULT_BED_COLUMNS - 1) / 2) * DEFAULT_GRID_SPACING_X;
  const z = (row - (Math.ceil(totalBeds / DEFAULT_BED_COLUMNS) - 1) / 2) * DEFAULT_GRID_SPACING_Z;

  return { x, z, rotation: 0 };
};

export const resolveHospitalFloorBedItems = ({
  beds,
  savedBeds,
}: ResolveHospitalFloorBedItemsParams): HospitalFloorBedItem[] =>
  beds.map((bed, index) => {
    const savedTransform = savedBeds[bed.id];
    if (savedTransform) {
      return { bed, transform: savedTransform };
    }

    const defaultTransform = DEFAULT_HOSPITAL_FLOOR_LAYOUT[bed.id];
    if (defaultTransform) {
      return { bed, transform: defaultTransform };
    }

    return {
      bed,
      transform: resolveFallbackTransformByIndex(index, beds.length),
    };
  });

export const resolveZoomValueFromDistance = (distance: number): number => {
  if (!Number.isFinite(distance) || distance <= 0) {
    return ZOOM_MIN_VALUE;
  }

  const rawPercentage = Math.round((ZOOM_BASE_DISTANCE / distance) * 100);
  return Math.max(ZOOM_MIN_VALUE, Math.min(ZOOM_MAX_VALUE, rawPercentage));
};
