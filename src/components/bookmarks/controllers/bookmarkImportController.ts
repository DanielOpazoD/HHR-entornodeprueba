export type BookmarkImportOutcome = 'success' | 'error';

export const resolveBookmarkImportAlertMessage = (outcome: BookmarkImportOutcome): string => {
  if (outcome === 'success') {
    return 'Marcadores importados con éxito';
  }

  return 'Error al importar marcadores';
};

export const isFileReaderTextResult = (result: string | ArrayBuffer | null): result is string =>
  typeof result === 'string';
