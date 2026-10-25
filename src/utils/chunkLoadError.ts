const chunkLoadErrorPattern =
  /chunkloaderror|loading chunk|dynamically imported module|importing a module script failed|not a valid JavaScript MIME type/i;

export const isChunkLoadError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);
  return chunkLoadErrorPattern.test(message);
};
