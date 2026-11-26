/**
 * Client-side Image Compression Utility
 *
 * Compresses camera photos before uploading to Firebase Storage.
 * Critical for Rapa Nui's limited connectivity — mobile camera photos
 * can be 5–12 MB; this reduces them to ~200–500 KB.
 */

// ============================================================================
// Types
// ============================================================================

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Max dimension for compressed photos (pixels). */
const PHOTO_MAX_DIMENSION = 1920;

/** Max dimension for thumbnails (pixels). */
const THUMBNAIL_MAX_DIMENSION = 200;

/** Compression quality for photos (0-1). */
const PHOTO_QUALITY = 0.8;

/** Compression quality for thumbnails (0-1). */
const THUMBNAIL_QUALITY = 0.6;

const PHOTO_DEFAULTS: Required<CompressionOptions> = {
  maxWidth: PHOTO_MAX_DIMENSION,
  maxHeight: PHOTO_MAX_DIMENSION,
  quality: PHOTO_QUALITY,
};

const THUMBNAIL_DEFAULTS: Required<CompressionOptions> = {
  maxWidth: THUMBNAIL_MAX_DIMENSION,
  maxHeight: THUMBNAIL_MAX_DIMENSION,
  quality: THUMBNAIL_QUALITY,
};

const PREFERRED_OUTPUT_TYPE = 'image/webp';
const FALLBACK_OUTPUT_TYPE = 'image/jpeg';

// ============================================================================
// Internal helpers
// ============================================================================

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`No se pudo cargar la imagen: ${file.name}`));
    };
    img.src = url;
  });

/**
 * Calculate scaled dimensions preserving aspect ratio.
 */
export const calculateScaledDimensions = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } => {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

/**
 * Detect whether the browser supports encoding to the given MIME type.
 */
const supportsOutputType = (type: string): boolean => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const dataUrl = canvas.toDataURL(type);
    return dataUrl.startsWith(`data:${type}`);
  } catch {
    return false;
  }
};

const resolveOutputType = (): string =>
  supportsOutputType(PREFERRED_OUTPUT_TYPE) ? PREFERRED_OUTPUT_TYPE : FALLBACK_OUTPUT_TYPE;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      type,
      quality
    );
  });

const compressWithOptions = async (
  file: File,
  options: Required<CompressionOptions>
): Promise<CompressedImage> => {
  const img = await loadImageFromFile(file);
  const { width, height } = calculateScaledDimensions(
    img.width,
    img.height,
    options.maxWidth,
    options.maxHeight
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo obtener contexto 2D del canvas');
  }

  ctx.drawImage(img, 0, 0, width, height);

  const outputType = resolveOutputType();
  const blob = await canvasToBlob(canvas, outputType, options.quality);

  return {
    blob,
    width,
    height,
    originalSize: file.size,
    compressedSize: blob.size,
  };
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Compress an image file for upload. Scales to max 1920px, quality 0.8.
 */
export const compressImage = (file: File, options?: CompressionOptions): Promise<CompressedImage> =>
  compressWithOptions(file, { ...PHOTO_DEFAULTS, ...options });

/**
 * Generate a small thumbnail for gallery display. Scales to max 200px, quality 0.6.
 */
export const generateThumbnail = (
  file: File,
  options?: CompressionOptions
): Promise<CompressedImage> => compressWithOptions(file, { ...THUMBNAIL_DEFAULTS, ...options });
