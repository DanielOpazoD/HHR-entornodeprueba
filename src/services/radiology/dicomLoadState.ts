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
