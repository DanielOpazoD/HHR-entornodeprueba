import { parseCudyrCensusSource } from './cudyrCensusParser';
import { parseCudyrSupplementBinary, readCudyrWorkbookMatrix } from './cudyrSupplementBinary';
import { parseCudyrSupplementMatrix } from './cudyrSupplementParser';
import { parseCudyrDischargeReport } from './cudyrDischargeReportParser';

// Keep one optional XLS worker for archive import and local-only reconciliation.
self.onmessage = (
  event: MessageEvent<
    ArrayBuffer | { buffer: ArrayBuffer; kind: 'categories' | 'discharges' | 'census' }
  >
) => {
  try {
    if (event.data instanceof ArrayBuffer) {
      self.postMessage({ result: parseCudyrSupplementBinary(event.data) });
      return;
    }
    const matrix = readCudyrWorkbookMatrix(event.data.buffer);
    if (event.data.kind === 'census') {
      self.postMessage({ kind: 'census', report: parseCudyrCensusSource(matrix) });
    } else if (event.data.kind === 'discharges') {
      self.postMessage({ kind: 'discharges', report: parseCudyrDischargeReport(matrix) });
    } else {
      const result = parseCudyrSupplementMatrix(matrix);
      if (!result.ok) throw new Error('Formato de categorización no reconocido.');
      self.postMessage({ kind: 'categories', report: result.report });
    }
  } catch {
    self.postMessage({
      error: 'No se pudo leer el XLS/XLSX. Revise formato, fechas, fórmulas y límites del archivo.',
    });
  }
};
