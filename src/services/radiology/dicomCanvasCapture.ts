import type { Types } from '@cornerstonejs/core';
import type { DicomPlane } from './dicomTypes';

/** Captures rendered pixels only; interactive measurements and reference lines remain transient. */
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
  const sliceLabel =
    originalLabel ||
    (resampled && mode !== 'original' ? 'Remuestreado · ' : '') +
      (mode === '3d'
        ? 'Volumen 3D'
        : `Corte ${target.getSliceIndex() + 1}/${target.getNumberOfSlices()}`);
  context.font = '14px sans-serif';
  context.fillStyle = 'rgba(0,0,0,.7)';
  context.fillRect(
    8,
    canvas.height - 28,
    Math.min(canvas.width - 16, context.measureText(sliceLabel).width + 12),
    22
  );
  context.fillStyle = 'white';
  context.fillText(sliceLabel, 14, canvas.height - 12);
  if (edges) {
    const size = Math.max(12, Math.min(22, canvas.width / 35));
    context.font = `bold ${size}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [label, x, y] of [
      [edges.top, canvas.width / 2, size],
      [edges.bottom, canvas.width / 2, canvas.height - size],
      [edges.left, size, canvas.height / 2],
      [edges.right, canvas.width - size, canvas.height / 2],
    ] as const) {
      context.fillStyle = 'rgba(0,0,0,.7)';
      context.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
      context.fillStyle = 'white';
      context.fillText(label, x, y);
    }
  }
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
