import type { createMprTools, DicomReference } from './dicomMprTools';
import { Enums, type RenderingEngine, type VolumeViewport, type Types } from '@cornerstonejs/core';
import type { CrosshairsTool } from '@cornerstonejs/tools';
import type { DicomVolumePlan } from '@/domain/radiology/dicomGeometry';
import {
  defaultMprSettings,
  validateMprSettings,
  slabCoverage,
  isObliqueNormal,
  slabLabels,
  type MprSettings,
} from '@/domain/radiology/dicomReconstruction';

export interface MprReconstructionState extends MprSettings {
  planes: Array<{ oblique: boolean; label: string; clipped: boolean }>;
  quantitative: boolean;
}

/** No extra volume or transferred image. GPU projections use the original physical affine. */
export const createMprReconstruction = (
  engine: RenderingEngine,
  viewportIds: string[],
  plan: DicomVolumePlan,
  crosshairs: CrosshairsTool,
  notify: (state: MprReconstructionState | null) => void
) => {
  const viewports = viewportIds.map(id => engine.getViewport(id) as VolumeViewport);
  const initial = viewports.map(viewport => viewport.getCamera());
  let settings = defaultMprSettings();
  let frame = 0;
  let disposed = false;
  const state = (): MprReconstructionState => {
    const planes = viewports.map(viewport => {
      const camera = viewport.getCamera();
      const normal = camera.viewPlaneNormal!;
      const oblique = isObliqueNormal(normal);
      const clipped =
        settings.thickness > 0 &&
        slabCoverage(plan, camera.focalPoint!, normal, settings.thickness) <
          settings.thickness - 0.01;
      return {
        oblique,
        clipped,
        label: `${oblique ? 'Oblicuo · ' : ''}${
          settings.thickness
            ? `${slabLabels[settings.mode]} · ${settings.thickness} mm${clipped ? ' · Parcial' : ''}`
            : 'Corte fino'
        }`,
      };
    });
    return {
      ...settings,
      planes,
      quantitative: settings.thickness === 0 && !planes.some(plane => plane.oblique),
    };
  };
  const publish = () => {
    if (!disposed) notify(state());
  };
  const changed = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        publish();
      });
  };
  viewports.forEach(viewport =>
    viewport.element.addEventListener(Enums.Events.CAMERA_MODIFIED, changed)
  );
  const apply = () => {
    const blends = {
      average: Enums.BlendModes.AVERAGE_INTENSITY_BLEND,
      mip: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
      minip: Enums.BlendModes.MINIMUM_INTENSITY_BLEND,
    };
    viewports.forEach(viewport => {
      viewport.setBlendMode(
        settings.thickness ? blends[settings.mode] : Enums.BlendModes.COMPOSITE
      );
      // Core 4.22 clips at focalPoint +/- slabThickness. UI always means FULL width in mm.
      if (settings.thickness) viewport.setSlabThickness(settings.thickness / 2);
      else viewport.resetSlabThickness();
    });
    engine.renderViewports(viewportIds);
    publish();
  };
  publish();
  return {
    state,
    update: (patch: Partial<MprSettings>) => {
      settings = validateMprSettings({ ...settings, ...patch });
      apply();
    },
    reset: () => {
      settings = defaultMprSettings();
      viewports.forEach((viewport, i) => {
        const { viewPlaneNormal, viewUp } = initial[i];
        viewport.setOrientation(
          { viewPlaneNormal: viewPlaneNormal!, viewUp: viewUp! } as Types.OrientationVectors,
          false
        );
      });
      crosshairs.resetCrosshairs();
      apply();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      viewports.forEach(viewport =>
        viewport.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, changed)
      );
      notify(null);
    },
  };
};

/** Keeps only reconstruction controls and the physical intersection within this verified series. */
export const createMprMemory = () => {
  let saved: MprReconstructionState | undefined;
  let point: DicomReference | null = null;
  return {
    remember: (state: MprReconstructionState | undefined, reference: DicomReference | null) => {
      if (state) {
        saved = state;
        point = reference;
      }
    },
    restore: (
      reconstruction: ReturnType<typeof createMprReconstruction>,
      mpr: ReturnType<typeof createMprTools>,
      crosshairs: CrosshairsTool
    ) => {
      if (!saved) return;
      reconstruction.update(saved);
      mpr.oblique(saved.rotate);
      if (point) crosshairs.setToolCenter(point.point);
    },
  };
};
