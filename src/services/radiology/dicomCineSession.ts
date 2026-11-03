import type { StackViewport } from '@cornerstonejs/core';
import type { createProgressiveStack } from './dicomProgressiveStack';
import type { DicomCineSession } from './dicomCine';
import type { DicomOrientation } from './dicomRuntimeTypes';
import { waitForDicomRender } from './dicomRenderReady';
import { lockDicomInput } from './dicomInputLock';

/** Owns the original viewport while producing verified, rendered frames. No DOM overlays.
 * With restoreSlice, closing returns to the cut shown before the session (MP4 export). */
export const openDicomCineSession = (
  target: StackViewport,
  stack: ReturnType<typeof createProgressiveStack>,
  sessionSignal: AbortSignal,
  ensureActive: () => void,
  {
    total,
    orientation = () => undefined,
    restoreSlice = false,
  }: { total: number; orientation?: () => DicomOrientation | undefined; restoreSlice?: boolean }
): DicomCineSession => {
  ensureActive();
  if (stack.state().pending || stack.state().error) throw new Error('Espera al corte actual.');
  const initialSize = [target.getCanvas().width, target.getCanvas().height];
  const initialSlice = stack.state().current;
  let closed = false;
  let frameBusy = false;
  const controller = new AbortController();
  const unlock = lockDicomInput([target.element.parentElement ?? target.element]);
  stack.lock(true);
  return {
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
      stack.lock(false);
      unlock();
      try {
        ensureActive();
        stack.select(
          restoreSlice && initialSlice !== null
            ? initialSlice
            : (stack.state().current ?? stack.state().requested)
        );
      } catch {
        /* Closed session. */
      }
    },
    frame: async (index, signal) => {
      if (closed || frameBusy) throw new Error('La sesión de cine no está disponible.');
      frameBusy = true;
      const combined = AbortSignal.any([signal, sessionSignal, controller.signal]);
      try {
        combined.throwIfAborted();
        ensureActive();
        await stack.selectAndWait(index, combined);
        combined.throwIfAborted();
        ensureActive();
        const state = stack.state();
        if (state.pending || state.error || state.current !== index)
          throw new Error('No se pudo verificar el corte para cine.');
        await waitForDicomRender([target.element], () => target.render(), combined);
        combined.throwIfAborted();
        ensureActive();
        if (stack.state() !== state) throw new Error('La selección cambió durante el cine.');
        const canvas = target.getCanvas();
        if (canvas.width !== initialSize[0] || canvas.height !== initialSize[1])
          throw new Error('El tamaño de la vista cambió. Vuelve a iniciar el cine.');
        if (!canvas.width || !canvas.height) throw new Error('Imagen no disponible.');
        return { canvas, label: `Corte ${index + 1}/${total}`, edges: orientation() };
      } finally {
        frameBusy = false;
      }
    },
  };
};
