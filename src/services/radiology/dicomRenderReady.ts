import { Enums } from '@cornerstonejs/core';

/** Subscribe before scheduling rendering; every viewport must have copied its image to the canvas. */
export const waitForDicomRender = async (
  elements: HTMLElement[],
  render: () => void,
  signal: AbortSignal
): Promise<void> => {
  signal.throwIfAborted();
  if (!elements.length) throw new Error('No hay una vista DICOM disponible.');
  return new Promise((resolve, reject) => {
    const pending = new Set(elements);
    const listeners = new Map<HTMLElement, EventListener>();
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      listeners.forEach((listener, element) =>
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, listener)
      );
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(
      () => finish(new Error('No se completó la imagen del visor. Vuelve a abrir el estudio.')),
      15_000
    );
    signal.addEventListener('abort', abort, { once: true });
    pending.forEach(element => {
      const listener = (event: Event) => {
        if (event.target === element && pending.delete(element) && !pending.size) finish();
      };
      listeners.set(element, listener);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, listener);
    });
    try {
      render();
    } catch (error) {
      finish(error);
    }
  });
};
