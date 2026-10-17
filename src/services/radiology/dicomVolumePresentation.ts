import { CONSTANTS, utilities, type Types, type VolumeViewport3D } from '@cornerstonejs/core';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import {
  adjustTransfer,
  normalizeVolumePresentation,
  type VolumePresentation,
} from '@/services/radiology/dicomPresentation';

export const applyVolumePresentation = (
  viewport: VolumeViewport3D,
  requested: VolumePresentation,
  modality: string
) => {
  const value = normalizeVolumePresentation(requested, modality);
  const preset = CONSTANTS.VIEWPORT_PRESETS.find(item => item.name === value.preset);
  const actor = viewport.getDefaultActor()?.actor as Types.VolumeActor | undefined;
  if (!actor || !preset) return;
  utilities.applyPreset(actor, {
    ...preset,
    colorTransfer: adjustTransfer(preset.colorTransfer, 4, value.shift),
    scalarOpacity: adjustTransfer(preset.scalarOpacity, 2, value.shift, value.opacity / 100),
    shade: value.shading ? '1' : '0',
  });
  const mapper = actor.getMapper();
  if (!mapper) return;
  mapper.removeAllClippingPlanes();
  if (value.clipAxis !== 'none' && value.clipPercent > 0) {
    const axis = { x: 0, y: 1, z: 2 }[value.clipAxis];
    const bounds = actor.getBounds();
    const fraction = value.clipPercent / 100;
    const origin: Types.Point3 = [0, 0, 0];
    const normal: Types.Point3 = [0, 0, 0];
    origin[axis] = value.clipReverse
      ? bounds[axis * 2 + 1] - (bounds[axis * 2 + 1] - bounds[axis * 2]) * fraction
      : bounds[axis * 2] + (bounds[axis * 2 + 1] - bounds[axis * 2]) * fraction;
    normal[axis] = value.clipReverse ? -1 : 1;
    mapper.addClippingPlane(vtkPlane.newInstance({ origin, normal }));
  }
  viewport.render();
};
