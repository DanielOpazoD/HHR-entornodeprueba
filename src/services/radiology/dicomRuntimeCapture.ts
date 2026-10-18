import type { RenderingEngine, StackViewport, VolumeViewport } from '@cornerstonejs/core';
import type { DicomMode, DicomOrientation } from './dicomRuntimeTypes';
import type { DicomSeries } from './dicomTypes';
import type { createProgressiveStack } from './dicomProgressiveStack';
import { captureDicomCanvas } from './dicomCanvasCapture';
import { waitForDicomRender } from './dicomRenderReady';

export const captureRuntimeView = async ({
  engine,
  stack,
  series,
  mode,
  plane,
  signal,
  ensureActive,
  resampled,
  orientations,
}: {
  engine?: RenderingEngine;
  stack: ReturnType<typeof createProgressiveStack>;
  series: DicomSeries;
  mode: DicomMode;
  plane: number;
  signal: AbortSignal;
  ensureActive: () => void;
  resampled: boolean;
  orientations: () => DicomOrientation[];
}) => {
  ensureActive();
  const selection = stack.state();
  if (mode === 'original' && (selection.pending || selection.error || selection.current === null))
    throw new Error('Espera a que termine de cargar el corte solicitado.');
  const target = engine?.getViewports()[plane];
  if (!target) throw new Error('Selecciona una vista cargada.');
  await waitForDicomRender([target.element], () => target.render(), signal);
  ensureActive();
  const captured = await captureDicomCanvas(
    target as StackViewport | VolumeViewport,
    mode,
    plane,
    resampled,
    orientations()[plane],
    mode === 'original' ? `Corte ${selection.current! + 1}/${series.instances.length}` : undefined
  );
  ensureActive();
  if (mode === 'original' && stack.state() !== selection)
    throw new DOMException('Captura cancelada', 'AbortError');
  return captured;
};
