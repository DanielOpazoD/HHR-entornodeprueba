/** Normalize the selected signature locally. No patient data or signature is uploaded. */
export const readSicSignaturePng = async (url: string | null): Promise<Uint8Array | undefined> => {
  if (!url) return undefined;
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo leer la firma seleccionada.');
  const blob = await response.blob();
  if (blob.size > 500 * 1024) throw new Error('La firma supera 500 KB.');
  const localUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = localUrl;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 8_000_000
    )
      throw new Error('Las dimensiones de la firma no son válidas.');
    const scale = Math.min(1, 1200 / image.naturalWidth, 600 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no pudo preparar la firma.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        result => (result ? resolve(result) : reject(new Error('No se pudo preparar la firma.'))),
        'image/png'
      )
    );
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(localUrl);
  }
};
