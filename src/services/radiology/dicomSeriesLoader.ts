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

export const loadDicomSeries = async (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void
): Promise<LoadedDicomSeries> => {
  if (series.instances.some(item => item.frames !== 1))
    throw new Error('Esta serie multicuadro requiere el visor externo de MMRAD.');
  if (
    series.instances.length > 1024 ||
    series.rows * series.columns * series.instances.length > MAX_VOXELS
  )
    throw new Error(
      'La serie supera el límite de memoria del visor. Abre una serie más pequeña o el visor externo.'
    );
  const ids: string[] = [];
  const geometry: SliceGeometry[] = [];
  const localizers: boolean[] = [];
  const release = () => {
    for (const id of ids) {
      if (!id) continue;
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
      wadouri.dataSetCacheManager.unload(id.split(':')[1]);
      wadouri.fileManager.remove(Number(id.split(':')[1]));
    }
  };
  let resamplingSupported = true;
  let cursor = 0;
  let loaded = 0;
  let rawBytes = 0;
  let voxels = 0;
  let failure: unknown;
  const worker = async () => {
    while (!signal.aborted && !failure && cursor < series.instances.length) {
      const index = cursor++;
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
      } catch (error) {
        // Cornerstone wraps decode errors together with the parsed dataset. Never propagate
        // that dataset into error boundaries or diagnostics.
        const detail = error && typeof error === 'object' && 'error' in error ? error.error : error;
        failure =
          detail instanceof Error
            ? detail
            : new Error('No se pudo decodificar una imagen DICOM. Utiliza el visor externo.');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, series.instances.length) }, worker));
  if (failure || signal.aborted) {
    release();
    throw failure || signal.reason;
  }
  return {
    imageIds: ids,
    geometry,
    volumeGeometry: geometry.filter((_, index) => !localizers[index]),
    resamplingSupported,
    release,
  };
};
