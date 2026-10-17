import { cache, metaData, utilities, volumeLoader, type Types } from '@cornerstonejs/core';
import { planDicomVolume, type SliceGeometry } from '@/domain/radiology/dicomGeometry';
import { resampleDicomVolume } from '@/domain/radiology/dicomResampling';

export interface DicomVolumeHandle {
  resampled: boolean;
  release: () => void;
}

/** Only called after every original passed PatientID + Study/Series/SOP identity validation. */
export const createDicomVolume = async (
  volumeId: string,
  geometry: SliceGeometry[],
  modality: string,
  resamplingSupported: boolean,
  signal: AbortSignal
): Promise<DicomVolumeHandle> => {
  const plan = planDicomVolume(geometry);
  const derivedIds: string[] = [];
  const release = () => {
    if (cache.getVolumeLoadObject(volumeId)) cache.removeVolumeLoadObject(volumeId);
    for (const id of derivedIds) {
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
      // Core 4.22 has no per-image metadata removal. Clear values immediately;
      // the runtime clears the provider entirely when its last user closes.
      for (const type of [
        'imagePlaneModule',
        'imagePixelModule',
        'voiLutModule',
        'generalSeriesModule',
      ])
        utilities.genericMetadataProvider.add(id, { type, metadata: {} });
    }
  };
  try {
    signal.throwIfAborted();
    const ordered = plan.slices.map(slice => slice.imageId);
    if (!plan.resampled) {
      await volumeLoader.createAndCacheVolumeFromImages(volumeId, ordered);
    } else {
      if (!resamplingSupported)
        throw new Error(
          'La serie tiene relleno o una escala de píxeles no compatible con el remuestreo; utiliza la vista original.'
        );
      const bytes = plan.dimensions.reduce((a, b) => a * b, 4);
      const checkMemory = () => {
        // Do not let Cornerstone evict originals to make room for a derived volume.
        if (bytes > cache.getBytesAvailable())
          throw new Error('No hay memoria suficiente para remuestrear conservando los originales.');
      };
      checkMemory();
      const scalarData = await resampleDicomVolume(
        plan,
        slice => {
          const image = cache.getImage(slice.imageId);
          const pixel = metaData.get('imagePixelModule', slice.imageId);
          const scaling = metaData.get('modalityLutModule', slice.imageId);
          const general = metaData.get('generalSeriesModule', slice.imageId);
          const slope = scaling?.rescaleSlope ?? 1;
          const intercept = scaling?.rescaleIntercept ?? 0;
          if (
            !image ||
            image.rows !== slice.rows ||
            image.columns !== slice.columns ||
            image.color ||
            image.numberOfComponents !== 1 ||
            pixel?.photometricInterpretation !== 'MONOCHROME2' ||
            general?.modality !== modality ||
            image.modalityLUT ||
            scaling?.modalityLUTSequence?.length ||
            (image.preScale?.scaled &&
              (image.preScale.scalingParameters?.rescaleSlope !== slope ||
                image.preScale.scalingParameters?.rescaleIntercept !== intercept))
          )
            throw new Error(
              'La escala o el formato de imagen no admite remuestreo seguro; utiliza la vista original.'
            );
          return {
            pixels: image.getPixelData(),
            slope,
            intercept,
            preScaled: image.preScale?.scaled === true,
          };
        },
        signal
      );
      signal.throwIfAborted();
      checkMemory();
      // Register all IDs before creation so a partial allocation is also released on failure.
      derivedIds.push(...ordered.map((_, i) => `${volumeId}_slice_${i}`));
      const metadata = utilities.makeVolumeMetadata(ordered);
      const volume = volumeLoader.createLocalVolume(volumeId, {
        ...plan,
        direction: plan.direction as Types.Mat3,
        scalarData,
        metadata: {
          ...metadata,
          BitsAllocated: 32,
          BitsStored: 32,
          HighBit: 31,
          PixelRepresentation: 1,
          Rows: plan.dimensions[1],
          Columns: plan.dimensions[0],
          PixelSpacing: [plan.spacing[1], plan.spacing[0]],
        },
      });
      volume.isPreScaled = true;
      volume.referencedImageIds = ordered;
      const voi = metaData.get('voiLutModule', ordered[0]);
      derivedIds.forEach((id, z) => {
        const plane = metaData.get('imagePlaneModule', id);
        utilities.genericMetadataProvider.add(id, {
          type: 'imagePlaneModule',
          metadata: {
            ...plane,
            imageOrientationPatient: plan.direction.slice(0, 6),
            frameOfReferenceUID: plan.slices[0].frame,
            imagePositionPatient: plan.origin.map(
              (value, i) => value + z * plan.spacing[2] * plan.direction[i + 6]
            ),
          },
        });
        utilities.genericMetadataProvider.add(id, { type: 'voiLutModule', metadata: voi || {} });
        utilities.genericMetadataProvider.add(id, {
          type: 'generalSeriesModule',
          metadata: { modality },
        });
      });
    }
    signal.throwIfAborted();
    return { resampled: plan.resampled, release };
  } catch (error) {
    release();
    throw error;
  }
};
