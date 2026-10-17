import { parseDicom } from 'dicom-parser';
import { imageLoader, cache } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { fetchDicomInstance } from '@/services/radiology/mmradDicomService';
import { type DicomSeries, type DicomStudy } from '@/services/radiology/dicomTypes';
import type { SliceGeometry } from '@/domain/radiology/dicomGeometry';
import { validateDicomInstanceIdentity } from './dicomInstanceIdentity';
import { supportsDicomResampling } from './dicomPixelMapping';
import { isDicomCtLocalizer } from './dicomLocalizer';

const MAX_RAW_BYTES = 256 * 1024 * 1024;
const MAX_VOXELS = 128 * 1024 * 1024;
export interface LoadedDicomSeries {
  imageIds: string[];
  geometry: SliceGeometry[];
  /** Explicit CT localizers remain in Original, but are not cross-sectional volume sources. */
  volumeGeometry: SliceGeometry[];
  resamplingSupported: boolean;
  release: () => void;
}

export const startDicomSeries = (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void
): ProgressiveDicomSeries => {
  if (series.instances.some(item => item.frames !== 1))
    throw new Error('Esta serie multicuadro requiere el visor externo de MMRAD.');
  if (
    series.instances.length > 1024 ||
    series.rows * series.columns * series.instances.length > MAX_VOXELS
  )
    throw new Error(
      'La serie supera el límite de memoria del visor. Abre una serie más pequeña o el visor externo.'
    );
  const controller = new AbortController();
  const parentSignal = signal;
  signal = AbortSignal.any([signal, controller.signal]);
  const ids: string[] = [];
  const geometry: SliceGeometry[] = [];
  const localizers: boolean[] = [];
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const id of ids) {
      if (!id) continue;
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
      wadouri.dataSetCacheManager.unload(id.split(':')[1]);
      wadouri.fileManager.remove(Number(id.split(':')[1]));
    }
  };
  let resamplingSupported = true;
  let priority = Math.floor(series.instances.length / 2);
  const queue = series.instances.map((_, index) => index);
  const pending = series.instances.map(() => {
    let resolve!: (id: string) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => undefined); // Background slices need no individual consumer.
    return { promise, resolve, reject };
  });
  let loaded = 0;
  let rawBytes = 0;
  let voxels = 0;
  let failure: unknown;
  let rejectSession!: (error: unknown) => void;
  const failed = new Promise<never>((_, reject) => {
    rejectSession = reject;
  });
  const worker = async () => {
    while (!signal.aborted && !failure && queue.length) {
      queue.sort((a, b) => Math.abs(a - priority) - Math.abs(b - priority) || a - b);
      const index = queue.shift()!;
      const instance = series.instances[index];
      try {
        const bytes = await fetchDicomInstance(instance.ticket, signal);
        signal.throwIfAborted();
        rawBytes += bytes.byteLength;
        if (rawBytes > MAX_RAW_BYTES)
          throw new Error('La serie supera el límite de memoria de originales (256 MB).');
        const data = parseDicom(bytes, { untilTag: 'x7fe00010' });
        validateDicomInstanceIdentity(data, study, series, instance);
        const frames = Number(data.string('x00280008') || 1);
        const rows = data.uint16('x00280010') || 0;
        const columns = data.uint16('x00280011') || 0;
        const samples = data.uint16('x00280002') || 1;
        voxels += rows * columns * samples;
        if (frames !== 1 || rows <= 0 || columns <= 0 || voxels > MAX_VOXELS)
          throw new Error('El original DICOM no es compatible con los límites del visor.');
        localizers[index] = series.modality === 'CT' && isDicomCtLocalizer(data);
        if (!localizers[index] && !supportsDicomResampling(data)) resamplingSupported = false;
        const id = wadouri.fileManager.add(
          new Blob([new Uint8Array(bytes)], { type: 'application/dicom' })
        );
        ids[index] = id;
        const vector = (tag: string) =>
          (data.string(tag) || '').split('\\').filter(Boolean).map(Number);
        geometry[index] = {
          imageId: id,
          position: vector('x00200032'),
          orientation: vector('x00200037'),
          spacing: vector('x00280030'),
          frame: data.string('x00200052') || '',
          rows,
          columns,
        };
        await imageLoader.loadAndCacheImage(id);
        signal.throwIfAborted();
        progress(++loaded, series.instances.length);
        pending[index].resolve(id);
      } catch (error) {
        // Cornerstone wraps decode errors together with the parsed dataset. Never propagate
        // that dataset into error boundaries or diagnostics.
        const detail = error && typeof error === 'object' && 'error' in error ? error.error : error;
        failure ??=
          detail instanceof Error
            ? detail
            : new Error('No se pudo decodificar una imagen DICOM. Utiliza el visor externo.');
        rejectSession(failure);
        controller.abort();
        pending.forEach(item => item.reject(failure));
      }
    }
  };
  const draining = Promise.resolve().then(async () => {
    await Promise.all(Array.from({ length: Math.min(4, series.instances.length) }, worker));
    if (failure || signal.aborted) {
      const error = failure || signal.reason;
      pending.forEach(item => item.reject(error));
      release();
      throw error;
    }
    return {
      imageIds: ids,
      geometry,
      volumeGeometry: geometry.filter((_, index) => !localizers[index]),
      resamplingSupported,
      release,
    };
  });
  const completion = Promise.race([draining, failed]);
  const settled = draining.then(
    () => undefined,
    () => undefined
  );
  void completion.catch(() => undefined);
  const abort = () => {
    controller.abort();
    rejectSession(failure || signal.reason);
    pending.forEach(item => item.reject(failure || signal.reason));
  };
  parentSignal.addEventListener('abort', abort, { once: true });
  void settled
    .finally(() => parentSignal.removeEventListener('abort', abort))
    .catch(() => undefined);
  return {
    completion,
    settled,
    initialIndex: priority,
    hasOrientation: index => geometry[index]?.orientation.length === 6,
    request: index => {
      signal.throwIfAborted();
      if (!Number.isInteger(index) || index < 0 || index >= pending.length)
        throw new Error('Corte fuera de la serie.');
      priority = index;
      return pending[index].promise;
    },
    cancel: () => {
      abort();
      void settled.finally(release).catch(() => undefined);
    },
  };
};

export interface ProgressiveDicomSeries {
  initialIndex: number;
  hasOrientation: (index: number) => boolean;
  completion: Promise<LoadedDicomSeries>;
  /** Resolves only after in-flight decodes drain; resource cleanup must wait for this. */
  settled: Promise<void>;
  request: (index: number) => Promise<string>;
  cancel: () => void;
}

/** Complete-series consumer retained for volume validation and focused tests. */
export const loadDicomSeries = (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void
): Promise<LoadedDicomSeries> => startDicomSeries(study, series, signal, progress).completion;
