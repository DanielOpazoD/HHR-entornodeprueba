import type { Types } from '@cornerstonejs/core';
import type { DicomPlane } from './dicomTypes';
import { drawDicomFrameLabels } from './dicomFrameOverlay';
import { drawMeasurementOverlay, measurementOverlayFor } from './dicomMeasurementOverlay';

/**
 * Captures the rendered image with the measurements visible on it (they are still never saved);
 * crosshairs and reference lines stay out.
 */
export const captureDicomCanvas = async (
  target: Types.IStackViewport | Types.IVolumeViewport,
  mode: 'original' | 'mpr' | '3d',
  plane: number,
  resampled: boolean,
  edges?: { top: string; right: string; bottom: string; left: string },
  originalLabel?: string
): Promise<{
  png: Uint8Array;
  width: number;
  height: number;
  plane: DicomPlane;
  sliceLabel: string;
}> => {
  const source = target.getCanvas();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 2048 / source.width, 2048 / source.height);
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no permite capturar esta vista.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const measurements = measurementOverlayFor(target);
  if (measurements)
    await drawMeasurementOverlay(context, measurements, canvas.width, canvas.height);
  const sliceLabel =
    originalLabel ||
    (resampled && mode !== 'original' ? 'Remuestreado · ' : '') +
      (mode === '3d'
        ? 'Volumen 3D'
        : `Corte ${target.getSliceIndex() + 1}/${target.getNumberOfSlices()}`);
  drawDicomFrameLabels(context, canvas.width, canvas.height, sliceLabel, edges);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      value => (value ? resolve(value) : reject(new Error('No se pudo capturar la vista.'))),
      'image/png'
    )
  );
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
    sliceLabel,
    plane:
      mode === 'original'
        ? 'original'
        : mode === '3d'
          ? '3d'
          : (['axial', 'coronal', 'sagittal'] as const)[plane],
  };
};
