import type {
  SavedBedTransform,
  SavedLayout,
} from '@/features/census/controllers/hospitalFloorMapRuntimeController';

export const applyHospitalFloorBedTransform = (
  layout: SavedLayout,
  bedId: string,
  transform: SavedBedTransform
): SavedLayout => ({
  ...layout,
  beds: {
    ...layout.beds,
    [bedId]: transform,
  },
});

export const patchHospitalFloorLayoutConfig = (
  layout: SavedLayout,
  configPatch: Partial<SavedLayout['config']>
): SavedLayout => ({
  ...layout,
  config: {
    ...layout.config,
    ...configPatch,
  },
});
