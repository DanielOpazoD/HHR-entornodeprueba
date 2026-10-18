import type { StackViewport } from '@cornerstonejs/core';
import type { createProgressiveStack } from './dicomProgressiveStack';
import type { DicomCineSession } from './dicomCine';
import { waitForDicomRender } from './dicomRenderReady';

/** Owns the original viewport while producing verified, rendered frames. No DOM overlays. */
export const openDicomCineSession = (
  target: StackViewport,
  stack: ReturnType<typeof createProgressiveStack>,
  sessionSignal: AbortSignal,
  ensureActive: () => void
): DicomCineSession => {
  ensureActive();
  if (stack.state().pending || stack.state().error) throw new Error('Espera al corte actual.');
  const initialSize = [target.getCanvas().width, target.getCanvas().height];
  let closed = false;
  let frameBusy = false;
  const controller = new AbortController();
  const element = target.element.parentElement ?? target.element;
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const events = ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'keydown'];
  events.forEach(name => element.addEventListener(name, block, { capture: true, passive: false }));
  stack.lock(true);
  return {
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
      stack.lock(false);
      events.forEach(name => element.removeEventListener(name, block, true));
      try {
        ensureActive();
        stack.select(stack.state().current ?? stack.state().requested);
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
        const source = target.getCanvas();
        if (source.width !== initialSize[0] || source.height !== initialSize[1])
          throw new Error('El tamaño de la vista cambió. Vuelve a iniciar el cine.');
        const canvas = document.createElement('canvas');
        // Stable even dimensions, bounded memory, no upscaling.
        const scale = Math.min(1, 1280 / source.width, 720 / source.height);
        canvas.width = Math.max(2, Math.floor((source.width * scale) / 2) * 2);
        canvas.height = Math.max(2, Math.floor((source.height * scale) / 2) * 2);
        const context = canvas.getContext('2d');
        if (!context || !source.width || !source.height) throw new Error('Imagen no disponible.');
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
      } finally {
        frameBusy = false;
      }
    },
  };
};
