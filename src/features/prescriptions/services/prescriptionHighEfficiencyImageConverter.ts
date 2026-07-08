import {
  HeicConverterLoadFailure,
  loadHeicConverter,
} from '@/features/prescriptions/services/prescriptionHeicConverterLoader';

const HIGH_EFFICIENCY_IMAGE_DECODE_ERROR =
  'La foto está en formato HEIC/HEIF y este navegador no pudo convertirla. En Samsung, cambia "Imágenes de alta eficiencia" a desactivado o comparte la foto como JPEG e intenta nuevamente.';

const HIGH_EFFICIENCY_IMAGE_CONVERTER_LOAD_ERROR =
  'No se pudo cargar el conversor HEIC/HEIF. Revisa la conexión, abre la app con internet e intenta nuevamente.';

const dynamicImportLoadErrorPattern =
  /chunkloaderror|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [^ ]+ failed/i;

export const buildHighEfficiencyImageDecodeError = (cause?: unknown): Error =>
  new Error(HIGH_EFFICIENCY_IMAGE_DECODE_ERROR, { cause });

export const buildHighEfficiencyImageConverterLoadError = (cause?: unknown): Error =>
  new Error(HIGH_EFFICIENCY_IMAGE_CONVERTER_LOAD_ERROR, { cause });

const findDynamicImportLoadError = (error: unknown): unknown | null => {
  if (error instanceof TypeError && dynamicImportLoadErrorPattern.test(error.message)) {
    return error;
  }

  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof TypeError && dynamicImportLoadErrorPattern.test(cause.message)) {
    return cause;
  }

  return null;
};

export const withJpegExtension = (fileName: string): string => {
  const baseName = fileName.includes('.') ? fileName.replace(/\.[^.]+$/, '') : fileName;
  return `${baseName}.jpg`;
};

export const convertHighEfficiencyImageToJpeg = async (file: File): Promise<File> => {
  try {
    const heic2any = await loadHeicConverter();
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob || blob.size === 0) {
      throw new Error('empty HEIC conversion');
    }

    return new File([blob], withJpegExtension(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    });
  } catch (error) {
    if (error instanceof HeicConverterLoadFailure) {
      throw buildHighEfficiencyImageConverterLoadError(
        findDynamicImportLoadError(error.cause) ?? error.cause ?? error
      );
    }

    const loadError = findDynamicImportLoadError(error);
    if (loadError) {
      throw buildHighEfficiencyImageConverterLoadError(loadError);
    }

    throw buildHighEfficiencyImageDecodeError(error);
  }
};
