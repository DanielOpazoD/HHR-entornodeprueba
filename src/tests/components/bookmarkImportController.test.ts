import { describe, expect, it } from 'vitest';
import {
  isFileReaderTextResult,
  resolveBookmarkImportAlertMessage,
} from '@/components/bookmarks/controllers/bookmarkImportController';

describe('bookmarkImportController', () => {
  it('returns user-facing messages by outcome', () => {
    expect(resolveBookmarkImportAlertMessage('success')).toBe('Marcadores importados con éxito');
    expect(resolveBookmarkImportAlertMessage('error')).toBe('Error al importar marcadores');
  });

  it('detects when file reader result is text', () => {
    expect(isFileReaderTextResult('json-content')).toBe(true);
    expect(isFileReaderTextResult(null)).toBe(false);
    expect(isFileReaderTextResult(new ArrayBuffer(8))).toBe(false);
  });
});
