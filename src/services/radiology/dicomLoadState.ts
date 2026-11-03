export interface DicomLoadState {
  total: number;
  downloaded: number;
  ready: number;
  failed: number[];
  available: Array<[number, number]>;
  activeDownloads: number;
  activeDecodes: number;
  concurrency: number;
  limit: number;
  retries: number;
  rawBytes: number;
  networkBytes?: number;
  firstReadyMs: number | null;
  elapsedMs: number;
  timings: {
    headers: number;
    transfer: number;
    serverAuth?: number;
    upstreamHeaders?: number;
    upstreamBody?: number;
    serverSamples?: number;
    upstream: number;
    upstreamSamples: number;
    decode: number;
    volume: number;
  };
  volumeBuilding: boolean;
}
export const availableDicomRanges = (ready: boolean[]): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  ready.forEach((value, i) => {
    if (!value) return;
    const last = ranges.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else ranges.push([i, i]);
  });
  return ranges;
};
export class DicomTransferError extends Error {
  constructor(
    public readonly transient: boolean,
    public readonly retryAfterMs = 0
  ) {
    super(
      transient
        ? 'La conexión DICOM falló temporalmente.'
        : 'No se pudo obtener el corte. Vuelve a abrir el estudio.'
    );
  }
}
/** The server recognised an authentic instance ticket whose time ran out (`ticket-expired`). */
export class DicomTicketExpiredError extends DicomTransferError {
  constructor() {
    super(false);
  }
}
/** The original exceeds what the HHR bridge can carry (`too-large`); MMRAD's viewer can show it. */
export class DicomOriginalTooLargeError extends DicomTransferError {
  constructor(public readonly bytes?: number) {
    super(false);
    // Shown only when the Santiago function could not bring it either, or it exceeds 30 MB.
    const size = bytes ? ` (${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB)` : '';
    this.message = `No se pudo traer completa esta imagen${size}. Ábrela con el botón «MMRAD», que usa el Visualizador Universitas.`;
  }
}
