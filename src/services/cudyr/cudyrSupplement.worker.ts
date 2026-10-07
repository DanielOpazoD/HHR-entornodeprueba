import { parseCudyrSupplementBinary } from './cudyrSupplementBinary';
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ result: parseCudyrSupplementBinary(event.data) });
  } catch {
    self.postMessage({
      error: 'No se pudo leer el XLS/XLSX. Revise formato, fórmulas y límites del archivo.',
    });
  }
};
