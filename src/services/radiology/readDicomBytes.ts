/** Bound speculative reads even when Content-Length is absent or inaccurate. */
export const readDicomBytes = async (
  response: Response,
  signal: AbortSignal,
  maxBytes?: number
): Promise<Uint8Array> => {
  if (maxBytes === undefined) return new Uint8Array(await response.arrayBuffer());
  const length = Number(response.headers.get('content-length') || 0);
  const overflow = () => new Error('El original supera el espacio disponible para precarga.');
  if (length > maxBytes) {
    await response.body?.cancel();
    throw overflow();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) {
        await reader.cancel();
        throw overflow();
      }
      size += value.byteLength;
      chunks.push(value);
    }
    signal.throwIfAborted();
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    reader.releaseLock();
  }
};
