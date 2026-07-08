/**
 * Prescription Image Compression Service
 *
 * Pure browser-side helper that turns the raw camera/file capture into
 * the two compressed JPEGs the upload Cloud Function expects:
 *
 *   - **Full**: max 1200px on the longest side, JPEG quality 0.7. Target
 *     size around 150–400 KB.
 *   - **Thumbnail**: max 360px on the longest side, JPEG quality 0.6.
 *     Used by the visor's listing.
 *
 * Server still validates the resulting bytes (size cap 4 MB per blob).
 */
import {
  buildHighEfficiencyImageDecodeError,
  convertHighEfficiencyImageToJpeg,
} from '@/features/prescriptions/services/prescriptionHighEfficiencyImageConverter';

export const PRESCRIPTION_FULL_IMAGE_MAX_DIMENSION = 1200;
export const PRESCRIPTION_THUMBNAIL_IMAGE_MAX_DIMENSION = 360;
export const PRESCRIPTION_FULL_IMAGE_QUALITY = 0.7;
export const PRESCRIPTION_THUMBNAIL_IMAGE_QUALITY = 0.6;

export interface CompressedPrescriptionImage {
  /** Base64 (no data-URL prefix) ready to be sent to the Cloud Function. */
  base64: string;
  width: number;
  height: number;
  /** Decoded byte length (for validation + UI feedback). */
  byteSize: number;
}

export interface CompressedPrescriptionImageBundle {
  full: CompressedPrescriptionImage;
  thumbnail: CompressedPrescriptionImage;
  /** Object URL to preview the compressed JPEG in the form before submit. */
  previewObjectUrl: string;
}

const ACCEPTED_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Releases the preview URL once the form no longer needs it. */
export const releaseCompressedPrescriptionImagePreview = (objectUrl: string): void => {
  if (typeof URL === 'undefined') return;
  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Object URLs are best-effort; the browser eventually GCs them.
  }
};

interface DecodedPrescriptionImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

const isHighEfficiencyImage = (file: File): boolean =>
  file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name);

const buildImageDecodeError = (file: File): Error => {
  if (isHighEfficiencyImage(file)) {
    return buildHighEfficiencyImageDecodeError();
  }

  return new Error(
    'No se pudo decodificar la imagen capturada. Intenta compartirla como JPEG o tomar una nueva foto desde la cámara.'
  );
};

const assertSupportedFileType = (file: File): void => {
  if (file.type && !ACCEPTED_FILE_TYPES.has(file.type)) {
    throw new Error(`Formato no soportado: ${file.type}.`);
  }
};

const normalizePrescriptionImageFile = async (file: File): Promise<File> => {
  if (!isHighEfficiencyImage(file)) {
    return file;
  }

  return convertHighEfficiencyImageToJpeg(file);
};

const loadImageElementFromFile = (file: File): Promise<DecodedPrescriptionImage> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(buildImageDecodeError(file));
    };
    image.src = objectUrl;
  });

const loadImageBitmapFromFile = async (file: File): Promise<DecodedPrescriptionImage> => {
  const createBitmap = globalThis.createImageBitmap?.bind(globalThis);
  if (!createBitmap) {
    throw buildImageDecodeError(file);
  }

  try {
    const bitmap = await createBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    };
  } catch {
    throw buildImageDecodeError(file);
  }
};

/**
 * Decodes a `File` into a drawable browser image source ready for canvas.
 * Some mobile gallery images fail through `<img>` object URLs but decode
 * through `createImageBitmap`, so keep both paths.
 */
const loadImageFromFile = async (file: File): Promise<DecodedPrescriptionImage> => {
  assertSupportedFileType(file);

  try {
    return await loadImageElementFromFile(file);
  } catch {
    return loadImageBitmapFromFile(file);
  }
};

const computeScaledDimensions = (
  image: Pick<DecodedPrescriptionImage, 'width' | 'height'>,
  maxDimension: number
): { width: number; height: number } => {
  const ratio = Math.min(1, maxDimension / Math.max(image.width, image.height));
  return {
    width: Math.max(1, Math.round(image.width * ratio)),
    height: Math.max(1, Math.round(image.height * ratio)),
  };
};

const drawCompressedJpeg = async (
  image: DecodedPrescriptionImage,
  maxDimension: number,
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> => {
  const { width, height } = computeScaledDimensions(image, maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo crear el contexto de canvas para comprimir la imagen.');
  }
  context.drawImage(image.source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('La compresión de la imagen devolvió un blob vacío.'));
          return;
        }
        resolve({ blob, width, height });
      },
      'image/jpeg',
      quality
    );
  });
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      // Strip the `data:image/jpeg;base64,` prefix.
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(new Error('No se pudo leer el blob comprimido.'));
    reader.readAsDataURL(blob);
  });

/**
 * Compresses a raw camera/file capture into both full + thumbnail JPEGs
 * encoded as base64, plus a preview object URL the form can render
 * before submit. Caller must call `releaseCompressedPrescriptionImagePreview`
 * once it no longer needs the preview URL.
 */
export const compressPrescriptionImage = async (
  file: File
): Promise<CompressedPrescriptionImageBundle> => {
  const normalizedFile = await normalizePrescriptionImageFile(file);
  const image = await loadImageFromFile(normalizedFile);
  try {
    const fullDraw = await drawCompressedJpeg(
      image,
      PRESCRIPTION_FULL_IMAGE_MAX_DIMENSION,
      PRESCRIPTION_FULL_IMAGE_QUALITY
    );
    const thumbDraw = await drawCompressedJpeg(
      image,
      PRESCRIPTION_THUMBNAIL_IMAGE_MAX_DIMENSION,
      PRESCRIPTION_THUMBNAIL_IMAGE_QUALITY
    );
    const fullBase64 = await blobToBase64(fullDraw.blob);
    const thumbBase64 = await blobToBase64(thumbDraw.blob);
    const previewObjectUrl = URL.createObjectURL(fullDraw.blob);
    image.release();

    return {
      full: {
        base64: fullBase64,
        width: fullDraw.width,
        height: fullDraw.height,
        byteSize: fullDraw.blob.size,
      },
      thumbnail: {
        base64: thumbBase64,
        width: thumbDraw.width,
        height: thumbDraw.height,
        byteSize: thumbDraw.blob.size,
      },
      previewObjectUrl,
    };
  } catch (error) {
    image.release();
    throw error;
  }
};
