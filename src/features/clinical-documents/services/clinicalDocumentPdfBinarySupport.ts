export const decodeBase64PdfBlob = (contentBase64: string, mimeType: string): Blob => {
  const clean = contentBase64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType || 'application/pdf' });
};
