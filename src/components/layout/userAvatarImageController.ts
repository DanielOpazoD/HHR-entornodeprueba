export interface AvatarSourceSize {
  width: number;
  height: number;
}

export interface AvatarCropRect {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
}

const AVATAR_OUTPUT_SIZE = 512;

export const calculateCenteredAvatarCrop = ({
  width,
  height,
}: AvatarSourceSize): AvatarCropRect => {
  const sourceSize = Math.min(width, height);
  return {
    sourceX: Math.max(0, Math.round((width - sourceSize) / 2)),
    sourceY: Math.max(0, Math.round((height - sourceSize) / 2)),
    sourceSize,
  };
};

const loadImage = async (objectUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo preparar la imagen seleccionada.'));
    image.src = objectUrl;
  });

const canvasToBlob = async (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('No se pudo recortar la imagen seleccionada.'));
      },
      type,
      0.9
    );
  });

export const createCenteredAvatarFile = async (file: File): Promise<File> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const crop = calculateCenteredAvatarCrop({
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    });
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(
      image,
      crop.sourceX,
      crop.sourceY,
      crop.sourceSize,
      crop.sourceSize,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE
    );

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, outputType);
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `avatar.${extension}`, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
