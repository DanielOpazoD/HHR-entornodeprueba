import { CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES } from '@/features/clinical-documents/controllers/clinicalAttachmentFilePolicy';

export type ClinicalAttachmentImageCompressionResult =
  | { status: 'not_needed'; file: File }
  | {
      status: 'compressed';
      file: File;
      originalSizeBytes: number;
      compressedSizeBytes: number;
      quality: number;
    }
  | { status: 'failed'; reason: string };

export interface ClinicalAttachmentImageCompressionOptions {
  targetBytes?: number;
  maxWidth?: number;
  quality?: number;
  createImageBitmap?: (file: File) => Promise<ImageBitmap>;
  createCanvas?: () => HTMLCanvasElement;
}

const withImageExtension = (fileName: string, contentType: string): string => {
  if (contentType !== 'image/jpeg') return fileName;
  const baseName = fileName.includes('.') ? fileName.replace(/\.[^.]+$/, '') : fileName;
  return `${baseName}.jpg`;
};

const createCompressedFile = (blob: Blob, originalFile: File): File =>
  new File([blob], withImageExtension(originalFile.name, blob.type || originalFile.type), {
    type: blob.type || originalFile.type || 'image/jpeg',
    lastModified: Date.now(),
  });

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  contentType: string,
  quality: number
): Promise<Blob | null> =>
  new Promise(resolve => {
    canvas.toBlob(resolve, contentType || 'image/jpeg', quality);
  });

const buildQualityAttempts = (initialQuality: number): number[] => {
  const attempts = [initialQuality, initialQuality - 0.12, initialQuality - 0.24, 0.5];
  return [...new Set(attempts.map(quality => Math.max(0.5, Number(quality.toFixed(2)))))];
};

const buildContentTypeAttempts = (fileType: string): string[] => {
  const preferredType = fileType || 'image/jpeg';
  if (preferredType === 'image/jpeg') return ['image/jpeg'];
  return [preferredType, 'image/jpeg'];
};

export const compressClinicalAttachmentImage = async (
  file: File,
  options: ClinicalAttachmentImageCompressionOptions = {}
): Promise<ClinicalAttachmentImageCompressionResult> => {
  const targetBytes = options.targetBytes ?? CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES;
  if (file.size <= targetBytes) {
    return { status: 'not_needed', file };
  }

  const createBitmap = options.createImageBitmap ?? globalThis.createImageBitmap?.bind(globalThis);
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'));
  if (!createBitmap || typeof document === 'undefined') {
    return { status: 'failed', reason: 'Este navegador no permite comprimir la imagen.' };
  }

  try {
    const bitmap = await createBitmap(file);
    const maxWidth = options.maxWidth ?? 1800;
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return { status: 'failed', reason: 'No se pudo preparar la compresion de imagen.' };
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const qualityAttempts = buildQualityAttempts(options.quality ?? 0.82);

    const contentTypeAttempts = buildContentTypeAttempts(file.type);

    for (const quality of qualityAttempts) {
      for (const contentType of contentTypeAttempts) {
        const blob = await canvasToBlob(canvas, contentType, quality);
        if (!blob) {
          return { status: 'failed', reason: 'No se pudo generar una imagen comprimida.' };
        }

        const compressedFile = createCompressedFile(blob, file);
        if (compressedFile.size <= targetBytes && compressedFile.size < file.size) {
          return {
            status: 'compressed',
            file: compressedFile,
            originalSizeBytes: file.size,
            compressedSizeBytes: compressedFile.size,
            quality,
          };
        }
      }
    }

    return { status: 'failed', reason: 'No se pudo comprimir la imagen a un tamano seguro.' };
  } catch {
    return { status: 'failed', reason: 'No se pudo leer la imagen para comprimirla.' };
  }
};
