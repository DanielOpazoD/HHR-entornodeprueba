/** Read at most limit bytes, cancelling oversized upstream bodies before retaining more. */
export const readResponseWithinLimit = async (
  response: Pick<Response, 'arrayBuffer'> & Partial<Pick<Response, 'body' | 'headers'>>,
  limit: number
): Promise<Buffer | null> => {
  const declaredLength = Number(response.headers?.get('content-length'));
  if (declaredLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  // Compatibility with response doubles that expose only arrayBuffer().
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > limit ? null : bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) return null;
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    try {
      await reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
};
